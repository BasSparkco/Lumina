import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// P9 required suite #9 (docs/tenant_isolation_and_platform_admin_plan.md, "generate/check the
// exhaustive P0 inventory from the Prisma schema and declared routes/events/storage surfaces").
// This replaces the *generation* of docs/tenant-isolation/ownership-matrix.md (P0's hand-built
// snapshot — see that file's own "Keeping this current" note, which names this exact script) with
// a mechanical scan of the real source of truth: schema.prisma for models, every
// *.controller.ts for routes, screen.gateway.ts for the WebSocket surface, and
// storage.service.ts for storage key prefixes. Output is checked in
// (docs/tenant-isolation/ownership-inventory.generated.json) and CI fails the build if
// regenerating it produces a diff (someone changed a model/route/event/prefix without updating
// the classification) or if it contains any UNCLASSIFIED entry (a genuinely new shape this
// script's mechanical rules don't already know how to classify — see MODEL_CLASS_OVERRIDES
// below).
//
// Deliberately conservative: model classification only ever trusts two mechanical signals (does
// the model have a direct `organizationId` scalar column, and is it nullable) plus a small,
// explicit, reviewed override table for the models that don't fit that shape (no
// `organizationId` column at all — either genuinely platform-private, or tenant-owned only
// indirectly through a parent relation). A model that is neither mechanically TP-shaped nor in
// the override table is UNCLASSIFIED and fails the check — the plan's own "never guess ownership
// automatically" principle (P5a pre-migration audits) applied to this generator itself.

const apiRoot = join(__dirname, '..');
const schemaPath = join(apiRoot, 'prisma/schema.prisma');
const outPath = join(apiRoot, '../../docs/tenant-isolation/ownership-inventory.generated.json');
const modulesDir = join(apiRoot, 'src/modules');
const gatewayPath = join(apiRoot, 'src/modules/ws/screen.gateway.ts');
const storagePath = join(apiRoot, 'src/modules/storage/storage.service.ts');

// ── 1. Prisma models ────────────────────────────────────────────────────────────────────────

interface ModelEntry {
  name: string;
  hasDirectOrganizationId: boolean;
  organizationIdNullable: boolean;
  class: string;
  note?: string;
}

// Reviewed once per model, updated only when a model's real shape changes (see file header).
// class values: PP (platform-private, no tenant owner), N/A (not tenant data), INDIRECT (tenant-
// owned only via a parent relation, no own organizationId column), JOIN (an access-grant/join
// record between platform and tenant, not itself tenant data).
const MODEL_CLASS_OVERRIDES: Record<string, { class: string; note: string }> = {
  Organization: { class: 'PP', note: 'Tenant registry root itself; has no parent to be owned by' },
  TenantModule: { class: 'PP', note: 'Module/entitlement assignment is platform administration over a tenant' },
  PlatformAuditLog: { class: 'PP', note: 'Platform action audit trail; targetOrganizationId is nullable metadata, not ownership' },
  PairingSession: { class: 'N/A', note: 'Unclaimed player pairing ticket, not tenant data — becomes a Screen (TP) on claim' },
  AssetBinary: { class: 'INDIRECT', note: 'Via assetId -> Asset.organizationId' },
  DesignTemplate: { class: 'PP', note: 'Super-Admin-owned catalog, not tenant data' },
  DesignTemplateVersion: { class: 'PP', note: 'Via templateId -> DesignTemplate (PP)' },
  DesignTemplateTenant: { class: 'JOIN', note: 'Composite-PK access-grant record between DesignTemplate (PP) and Organization' },
  DesignAssetVersion: { class: 'INDIRECT', note: 'Via designAssetId -> DesignAsset.organizationId' },
  PoiAlias: { class: 'INDIRECT', note: 'Via poiId -> Poi -> Floor -> Building.organizationId' },
  WayfindingAiScreenConfig: { class: 'INDIRECT', note: 'Via screenId -> Screen.organizationId' },
};

// Brace-depth-aware, not a single `[^}]*}` regex — several model doc-comments in this schema
// contain their own `{`/`}` characters (e.g. a `${N}` template-literal illustration inside a
// `//` comment), which would terminate a naive non-greedy match at the wrong `}` and silently
// truncate the body before the real `organizationId` field appears (found by hand-verifying
// Asset/Playlist, both of which have such a comment, coming back UNCLASSIFIED from a naive regex
// during development of this script).
function extractModelBlocks(schema: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const startRe = /model\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(schema))) {
    const name = m[1] ?? '';
    let depth = 1;
    let i = startRe.lastIndex;
    const bodyStart = i;
    while (i < schema.length && depth > 0) {
      if (schema[i] === '{') depth++;
      else if (schema[i] === '}') depth--;
      i++;
    }
    blocks.push({ name, body: schema.slice(bodyStart, i - 1) });
    startRe.lastIndex = i;
  }
  return blocks;
}

function parseModels(schema: string): ModelEntry[] {
  const models: ModelEntry[] = [];
  for (const { name, body } of extractModelBlocks(schema)) {
    const orgIdLine = body.split('\n').find((l) => /^\s*organizationId\s/.test(l));
    const hasDirectOrganizationId = Boolean(orgIdLine);
    const organizationIdNullable = orgIdLine ? /organizationId\s+String\?/.test(orgIdLine) : false;

    let cls: string;
    let note: string | undefined;
    if (hasDirectOrganizationId) {
      cls = organizationIdNullable ? 'TP_OR_SHARED' : 'TP';
    } else {
      const override = MODEL_CLASS_OVERRIDES[name];
      if (override) {
        cls = override.class;
        note = override.note;
      } else {
        cls = 'UNCLASSIFIED';
      }
    }
    models.push({ name, hasDirectOrganizationId, organizationIdNullable, class: cls, note });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

// ── 2. Controller routes ────────────────────────────────────────────────────────────────────

interface RouteEntry {
  file: string;
  controllerPath: string;
  method: string;
  path: string;
  guards: string[];
}

const HTTP_METHOD_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
const GUARD_DECORATORS = ['UseGuards', 'Roles', 'RequireModule', 'RequireSuperAdmin', 'Throttle', 'Public'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function parseRoutes(): RouteEntry[] {
  const routes: RouteEntry[] = [];
  for (const file of walk(modulesDir)) {
    const src = readFileSync(file, 'utf8');
    const controllerMatch = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(src);
    if (!controllerMatch) continue;
    const controllerPath = controllerMatch[1] ?? '';

    const classGuards = collectGuardsInRange(src, 0, controllerMatch.index);

    // Split into per-method chunks: from one HTTP-method decorator to the next.
    const methodDecoratorRe = new RegExp(`@(${HTTP_METHOD_DECORATORS.join('|')})\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?\\s*\\)`, 'g');
    const hits: { index: number; verb: string; path: string }[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = methodDecoratorRe.exec(src))) {
      hits.push({ index: mm.index, verb: (mm[1] ?? '').toUpperCase(), path: mm[2] ?? '' });
    }
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]!;
      // Look backward from this decorator to the previous one (or a reasonable window) for
      // method-level guard decorators stacked directly above it.
      const windowStart = i === 0 ? controllerMatch.index + controllerMatch[0].length : hits[i - 1]!.index;
      const methodGuards = collectGuardsInRange(src, windowStart, hit.index);
      routes.push({
        file: relative(join(apiRoot, '..', '..'), file),
        controllerPath,
        method: hit.verb,
        path: hit.path,
        guards: [...new Set([...classGuards, ...methodGuards])],
      });
    }
  }
  return routes.sort((a, b) => (a.file + a.path).localeCompare(b.file + b.path));
}

function collectGuardsInRange(src: string, start: number, end: number): string[] {
  const slice = src.slice(Math.max(0, start), end);
  const found: string[] = [];
  for (const g of GUARD_DECORATORS) {
    const re = new RegExp(`@${g}\\(`, 'g');
    if (re.test(slice)) found.push(g);
  }
  return found;
}

// ── 3. WebSocket surface ────────────────────────────────────────────────────────────────────

function parseWsSurface(): { rooms: string[]; events: string[] } {
  const src = readFileSync(gatewayPath, 'utf8');
  const rooms = [...new Set([...src.matchAll(/\.(?:join|to|in)\(\s*`([^`]*)`/g)].map((m) => m[1] ?? ''))];
  const events = [...new Set([...src.matchAll(/@SubscribeMessage\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? ''))];
  const emitted = [...new Set([...src.matchAll(/\.emit\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? ''))];
  return { rooms, events: [...new Set([...events, ...emitted])] };
}

// ── 4. Storage key prefixes ─────────────────────────────────────────────────────────────────

function parseStoragePrefixes(): string[] {
  const src = readFileSync(storagePath, 'utf8');
  const templates = [...src.matchAll(/`([^`]*\$\{[^`]*)`/g)].map((m) => m[1] ?? '');
  return [...new Set(templates)].sort();
}

// ── Assemble and write ──────────────────────────────────────────────────────────────────────

function main() {
  const schema = readFileSync(schemaPath, 'utf8');
  const models = parseModels(schema);
  const routes = parseRoutes();
  const ws = parseWsSurface();
  const storagePrefixes = parseStoragePrefixes();

  const unclassified = models.filter((m) => m.class === 'UNCLASSIFIED');

  const inventory = {
    generatedFrom: {
      schema: 'apps/api/prisma/schema.prisma',
      controllers: 'apps/api/src/modules/**/*.controller.ts',
      gateway: 'apps/api/src/modules/ws/screen.gateway.ts',
      storage: 'apps/api/src/modules/storage/storage.service.ts',
    },
    models,
    routes,
    webSocket: ws,
    storagePrefixes,
  };

  writeFileSync(outPath, JSON.stringify(inventory, null, 2) + '\n');

  console.log(`Wrote ${models.length} models, ${routes.length} routes, ${ws.events.length} WS events, ${storagePrefixes.length} storage prefixes to ${relative(process.cwd(), outPath)}`);

  if (unclassified.length > 0) {
    console.error(`\nUNCLASSIFIED models (no direct organizationId column and no entry in MODEL_CLASS_OVERRIDES):`);
    for (const m of unclassified) console.error(`  - ${m.name}`);
    console.error('\nAdd an explicit, reviewed classification to MODEL_CLASS_OVERRIDES in this script before merging.');
    process.exitCode = 1;
  }
}

main();
