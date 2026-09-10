import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import {
  buildBlankDesignDocument,
  CONTENT_PROPS_BY_TYPE,
  DesignDocumentSchema,
  STYLE_PROPS_BY_TYPE,
  type DesignDocument,
  type DesignElement,
} from '@lumina/design-schema';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { DesignDto } from './dto/design.dto';

// M4 server-side policy enforcement — the client-side Properties panel/canvas only *hides*
// controls for a locked element; nothing stopped a forged PATCH /designs/:id request (or a bug
// in the client) from changing a Template-locked layer's content, style or geometry anyway.
// CONTENT_PROPS_BY_TYPE/STYLE_PROPS_BY_TYPE (designer_modernization_plan.md M5 — moved to
// @lumina/design-schema so the dashboard's own recreate-vs-patch and UI-gating decisions can't
// silently drift from this enforcement) partition each element type's own fields into "content"
// (what is shown) vs "style" (how it looks), matching TemplateLayerPolicy's own two axes —
// geometry (x/y/width/height/rotation) is separately gated by movable/resizable, which every
// element already carries regardless of type.

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01; // sub-pixel — tolerates editor round-trip float noise, not a real edit
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return numbersEqual(a, b);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    // Canonical (key-sorted) JSON compare — good enough for the plain adjustment/animation
    // objects these fields ever hold; key order differing is not a real content/style change.
    const canon = (v: unknown): unknown => Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, val]) => [k, canon(val)]))
        : v;
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  }
  return a === b;
}

@Injectable()
export class DesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  private validateDesignJson(designJson: unknown): DesignDocument {
    const result = DesignDocumentSchema.safeParse(designJson);
    if (!result.success) {
      const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`Invalid design: ${message}`);
    }
    return result.data;
  }

  // designer.md §20/§24 — "every referenced assetId must be authorized against current tenant
  // ownership, or platform/template-authorized shared media." Deferred here from Phase 4 (image
  // picker only ever lists tenant-scoped assets client-side, so nothing could smuggle a foreign
  // id in *through the UI* — but this is the actual persistence boundary, the one place a crafted
  // payload could still get through). Walks every assetId/posterAssetId a DesignDocument can
  // reference (Image/Video elements, Video posters, image/video scene backgrounds) and rejects if
  // any doesn't resolve to a tenant-owned or shared-library (organizationId: null) asset — same
  // shared-library convention assets.service.ts already uses. Public: TemplatesService.adminPublish
  // (P7) reuses this same walk to enforce the opposite rule — every referenced id must be shared,
  // never tenant-owned — rather than re-deriving the DesignDocument element shape a second time.
  collectAssetIds(document: DesignDocument): string[] {
    const ids = new Set<string>();
    for (const scene of document.scenes) {
      if (scene.background.type !== 'color') ids.add(scene.background.assetId);
      for (const element of scene.elements) {
        if (element.type === 'image' && element.assetId) ids.add(element.assetId);
        if (element.type === 'video') {
          if (element.assetId) ids.add(element.assetId);
          if (element.posterAssetId) ids.add(element.posterAssetId);
        }
      }
    }
    return [...ids];
  }

  private async assertAssetsOwned(orgId: string, document: DesignDocument): Promise<void> {
    const assetIds = this.collectAssetIds(document);
    if (assetIds.length === 0) return;
    const owned = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, OR: [{ organizationId: orgId }, { organizationId: null }] },
      select: { id: true },
    });
    if (owned.length !== assetIds.length) {
      const ownedIds = new Set(owned.map((a) => a.id));
      const missing = assetIds.filter((id) => !ownedIds.has(id));
      throw new BadRequestException(`Design references assets not owned by this tenant: ${missing.join(', ')}`);
    }
  }

  // designer.md §11 amendment — the *actual* enforcement point for source-Template layer
  // restrictions. `sourceDocument` is the immutable DesignTemplateVersion's own designJson
  // (authoritative — never the live, still-editable DesignTemplate row), so an admin's later
  // template edit can't retroactively tighten or loosen a design a tenant already cloned. Only
  // elements that exist in BOTH documents (by id) and were governed in the source (a
  // templatePolicy, or movable/resizable/deletable turned off) are checked; a customer's own,
  // never-template-managed elements are untouched. A customer may always make their *own*
  // capability flags stricter than the template allowed (self-restricting is harmless) but never
  // less restrictive than the template granted, and may never swap a governed element's `type`.
  private assertTemplatePolicyRespected(sourceDocument: DesignDocument, incomingDocument: DesignDocument): void {
    const sourceElements = new Map<string, DesignElement>();
    for (const scene of sourceDocument.scenes) for (const element of scene.elements) sourceElements.set(element.id, element);
    const incomingElements = new Map<string, DesignElement>();
    for (const scene of incomingDocument.scenes) for (const element of scene.elements) incomingElements.set(element.id, element);

    for (const [id, source] of sourceElements) {
      const governed = source.templatePolicy !== undefined
        || source.movable === false || source.resizable === false || source.deletable === false;
      if (!governed) continue;

      const label = `"${source.name}"`;
      const incoming = incomingElements.get(id);
      if (!incoming) {
        if (source.deletable === false) {
          throw new ForbiddenException(`Element ${label} is locked by its source Template and cannot be deleted.`);
        }
        continue; // deletable and genuinely removed — allowed
      }

      if (incoming.type !== source.type) {
        throw new ForbiddenException(`Element ${label} is locked by its source Template and cannot change type.`);
      }
      // Governance flags: only ever allowed to move *toward* stricter than the template granted.
      if (source.movable === false && incoming.movable !== false) {
        throw new ForbiddenException(`Element ${label}'s position is locked by its source Template.`);
      }
      if (source.resizable === false && incoming.resizable !== false) {
        throw new ForbiddenException(`Element ${label}'s size is locked by its source Template.`);
      }
      if (source.deletable === false && incoming.deletable !== false) {
        throw new ForbiddenException(`Element ${label} is locked by its source Template and cannot become deletable.`);
      }
      if (source.templatePolicy?.contentEditable === false && incoming.templatePolicy?.contentEditable !== false) {
        throw new ForbiddenException(`Element ${label}'s content is locked by its source Template.`);
      }
      if (source.templatePolicy?.styleEditable === false && incoming.templatePolicy?.styleEditable !== false) {
        throw new ForbiddenException(`Element ${label}'s style is locked by its source Template.`);
      }

      // Geometry
      if (source.movable === false && (!numbersEqual(source.x, incoming.x) || !numbersEqual(source.y, incoming.y))) {
        throw new ForbiddenException(`Element ${label}'s position is locked by its source Template.`);
      }
      if (source.resizable === false && (!numbersEqual(source.width, incoming.width)
        || !numbersEqual(source.height, incoming.height) || !numbersEqual(source.rotation, incoming.rotation))) {
        throw new ForbiddenException(`Element ${label}'s size is locked by its source Template.`);
      }

      // Content / style — checked against the *source* element's own field set, not incoming's,
      // so a type-narrowed field a customer might have added can't hide a real change elsewhere.
      const s = source as unknown as Record<string, unknown>;
      const i = incoming as unknown as Record<string, unknown>;
      if (source.templatePolicy?.contentEditable === false) {
        for (const field of [...CONTENT_PROPS_BY_TYPE[source.type], 'dynamicBindings']) {
          if (!valuesEqual(s[field], i[field])) {
            throw new ForbiddenException(`Element ${label}'s content is locked by its source Template.`);
          }
        }
      }
      if (source.templatePolicy?.styleEditable === false) {
        for (const field of [...STYLE_PROPS_BY_TYPE[source.type], 'opacity', 'animation']) {
          if (!valuesEqual(s[field], i[field])) {
            throw new ForbiddenException(`Element ${label}'s style is locked by its source Template.`);
          }
        }
      }
    }
  }

  async list(orgId: string) {
    return this.prisma.designAsset.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.designAsset.findFirst({ where: { id, organizationId: orgId, deletedAt: null } }),
      'Design not found',
    );
  }

  // designer.md §11's Critical Backend Rule — called by TemplatesService.createDesign only, after
  // it has already re-validated that the template is published and authorized for `orgId`.
  // `source` carries the *immutable* DesignTemplateVersion's designJson/schemaVersion/versionNumber
  // (P7, docs/tenant_isolation_and_platform_admin_plan.md) — never the live, still-editable
  // DesignTemplate row — so a later admin edit/unpublish/archive of the template can never
  // retroactively change a design a tenant already cloned from it. Not exposed as its own
  // customer-facing "clone any template id" endpoint. That designJson is already-trusted
  // Super-Admin content, not re-validated for asset ownership here — a Template's own media is
  // platform-shared rather than tenant-owned by design.
  // designer_modernization_plan.md M6 — the embedded `designJson.id` (minted once, when the
  // Template itself was authored — see buildBlankDesignDocument) used to be copied verbatim into
  // every clone. Cloning the same Template twice (same org or different orgs) produced two
  // DesignAsset rows whose `designJson.id` was byte-identical — colliding DesignDraft's own
  // `@@unique([organizationId, documentId])` key between two logically-independent designs (a
  // same-org double-clone's autosave upsert would cross-contaminate the two), and colliding their
  // `localStorage` recovery keys in the same browser. Regenerated here, on every clone, using the
  // exact same minting convention buildBlankDesignDocument uses. Deliberately only the *top-level*
  // document id, via a plain structural spread — not `validateDesignJson`, which would additionally
  // re-parse/normalize (and silently strip any field not in the current schema) the whole document;
  // this class's own existing comment on `source` is deliberate about not re-validating already-
  // trusted Super-Admin template content here, and this fix shouldn't change that. Nested
  // `scenes[].id`/`elements[].id` are never regenerated — they're never compared across documents
  // (DesignDraft's key and the localStorage key are both top-level-documentId-only; scene/element
  // ids only need to be unique within one open document), so regenerating them would be
  // unnecessary churn with no correctness benefit. No schema migration (designJson is a plain JSON
  // column) and no backfill of existing clones — only new clones going forward are affected, per
  // this effort's own "do not indiscriminately re-ID saved designs" compatibility rule.
  async createFromTemplate(
    orgId: string,
    source: { id: string; name: string; designJson: Prisma.JsonValue; schemaVersion: number; versionNumber: number },
  ) {
    const designJson = { ...(source.designJson as object), id: `design_${crypto.randomUUID()}` };
    return this.prisma.designAsset.create({
      data: {
        organizationId: orgId,
        name: source.name,
        designJson,
        schemaVersion: source.schemaVersion,
        sourceTemplateId: source.id,
        sourceTemplateVersion: source.versionNumber,
      },
    });
  }

  // designer.md Phase 10 — POST /designs. `name` required to create a row at all (same
  // TemplateDto/adminCreate convention); an omitted designJson gets a fresh blank document.
  async create(orgId: string, dto: DesignDto) {
    if (!dto.name) throw new BadRequestException('name is required');
    const designJson = this.validateDesignJson(dto.designJson ?? buildBlankDesignDocument(dto.name));
    await this.assertAssetsOwned(orgId, designJson);
    const [created] = await this.prisma.$transaction([
      this.prisma.designAsset.create({
        data: { organizationId: orgId, name: dto.name, designJson: designJson },
      }),
      // A draft may already exist for this documentId if autosave ran before the first manual
      // Save — now redundant, the DesignAsset row is the canonical copy.
      this.prisma.designDraft.deleteMany({ where: { documentId: designJson.id, organizationId: orgId } }),
    ]);
    return created;
  }

  // designer.md Phase 10 — PATCH /designs/:id, the Manual Save endpoint. `revision` is required:
  // a mismatch against the current row means someone else saved in between (another tab, another
  // device) — rejected with 409 rather than silently overwritten (Acceptance: "stale client
  // cannot silently overwrite newer server revision"). Every successful save snapshots a new
  // DesignAssetVersion — "do not create a version row for every mouse movement" is satisfied by
  // this being the *manual* save path only; autosave writes to DesignDraft instead and never
  // reaches here.
  //
  // designer_modernization_plan.md M6 — the revision check used to be an app-level compare
  // (`dto.revision !== existing.revision`) against a value read by a *separate*, earlier query,
  // followed by an unconditional `designAsset.update({where:{id}})` with no revision guard on the
  // write itself. Two concurrent PATCH requests that both read the same `existing.revision` before
  // either wrote would both pass that check and both write — `revision:{increment:1}` (a relative
  // op) silently double-incremented the row and created two DesignAssetVersion rows for what the
  // client believed were two independently-serialized saves, with no 409 to either caller. Fixed
  // by folding the revision check into the write itself (`updateMany`'s `WHERE`, which takes a row
  // lock) inside an *interactive* transaction — the array form of `$transaction` doesn't roll back
  // when `updateMany` matches zero rows (that's not an error to Prisma, just an empty result), so
  // this must be the callback form, which lets `count === 0` explicitly `throw` and roll back the
  // whole transaction (version-create and draft-delete included) before anything is written.
  async update(orgId: string, id: string, dto: DesignDto) {
    const existing = await this.findOne(orgId, id);
    if (dto.revision === undefined) throw new BadRequestException('revision is required');
    if (dto.designJson === undefined) throw new BadRequestException('designJson is required');
    const designJson = this.validateDesignJson(dto.designJson);
    await this.assertAssetsOwned(orgId, designJson);
    if (existing.sourceTemplateId && existing.sourceTemplateVersion) {
      const sourceVersion = await this.prisma.designTemplateVersion.findUnique({
        where: { templateId_versionNumber: { templateId: existing.sourceTemplateId, versionNumber: existing.sourceTemplateVersion } },
        select: { designJson: true },
      });
      // A missing source version (template/version deleted after cloning) has nothing left to
      // enforce against — fail open on the policy check specifically, not on the save itself.
      if (sourceVersion) {
        this.assertTemplatePolicyRespected(this.validateDesignJson(sourceVersion.designJson), designJson);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // The atomic guard: only matches (and only then increments) if the row's revision still
      // equals what the client last saw. A concurrent racer's transaction blocks on this row's
      // lock until this one commits or rolls back, then re-evaluates against the now-current
      // revision — so at most one of two simultaneous requests for the same stale revision can
      // ever match.
      const { count } = await tx.designAsset.updateMany({
        where: { id, organizationId: orgId, revision: dto.revision },
        data: {
          name: dto.name ?? existing.name,
          designJson: designJson,
          schemaVersion: designJson.schemaVersion,
          revision: { increment: 1 },
        },
      });
      if (count === 0) {
        throw new ConflictException('This design was saved elsewhere — reload to see the latest version.');
      }
      // Read *after* the count check, inside the same transaction — the row lock `updateMany`
      // took above means a concurrent racer's version-number read can't interleave with this one
      // and collide on DesignAssetVersion's own @@unique([designAssetId, versionNumber]).
      const lastVersion = await tx.designAssetVersion.findFirst({
        where: { designAssetId: id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      await tx.designAssetVersion.create({
        data: {
          designAssetId: id,
          versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
          designJson: designJson,
          schemaVersion: designJson.schemaVersion,
        },
      });
      await tx.designDraft.deleteMany({ where: { documentId: designJson.id, organizationId: orgId } });
      // updateMany doesn't return the updated row itself — one extra read on the success path.
      return tx.designAsset.findUniqueOrThrow({ where: { id } });
    });
  }

  // PUT /designs/:id/name — a lightweight rename, deliberately separate from update() (the manual-
  // save path): renaming a file doesn't change its content, so this never touches designJson,
  // never checks/bumps revision, and never snapshots a version row. The document's own embedded
  // `designJson.name` is left stale in the DB until the next full save — the frontend updates its
  // live document.name at the same time as this call (see designer.store.ts's renameDocument), so
  // that next save (if any) serializes the corrected name right back into designJson too.
  async rename(orgId: string, id: string, name: string) {
    await this.findOne(orgId, id);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('name is required');
    return this.prisma.designAsset.update({ where: { id }, data: { name: trimmed } });
  }

  async listVersions(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.designAssetVersion.findMany({
      where: { designAssetId: id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, createdAt: true, reason: true },
    });
  }

  // designer.md §26 "Restored version becomes a new current version rather than destroying
  // history" — loads the target version's json as current, but records that as ANOTHER new
  // version row (reason: 'restore') rather than rewriting/deleting anything. No revision check:
  // restoring is a deliberate, explicit user action against whatever the design's live content
  // currently is, not a background-sync race the way autosave-vs-manual-save PATCH is.
  async restoreVersion(orgId: string, id: string, versionId: string) {
    await this.findOne(orgId, id);
    const version = await this.orgScoped.assertOwns(
      () => this.prisma.designAssetVersion.findFirst({ where: { id: versionId, designAssetId: id } }),
      'Version not found',
    );
    const lastVersion = await this.prisma.designAssetVersion.findFirst({
      where: { designAssetId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const [updated] = await this.prisma.$transaction([
      this.prisma.designAsset.update({
        where: { id },
        data: { designJson: version.designJson as Prisma.InputJsonValue, schemaVersion: version.schemaVersion, revision: { increment: 1 } },
      }),
      this.prisma.designAssetVersion.create({
        data: {
          designAssetId: id,
          versionNumber: nextVersionNumber,
          designJson: version.designJson as Prisma.InputJsonValue,
          schemaVersion: version.schemaVersion,
          reason: 'restore',
        },
      }),
    ]);
    return updated;
  }

  // ── Autosave drafts (designer.md §19.6/§26) — never touch DesignAsset/revision/versions ──────

  async getDraft(orgId: string, documentId: string) {
    return this.prisma.designDraft.findFirst({ where: { documentId, organizationId: orgId } });
  }

  // P5a: documentId's uniqueness is now scoped to (organizationId, documentId) (see schema
  // comment) rather than global, so this upsert's own where-clause can never resolve to another
  // org's row in the first place — no separate ownership check needed the way a bare
  // `upsert({ where: { documentId } })` against a globally-unique column would have required.
  async putDraft(orgId: string, userId: string, documentId: string, draftJson: unknown) {
    const validated = this.validateDesignJson(draftJson);
    return this.prisma.designDraft.upsert({
      where: { organizationId_documentId: { organizationId: orgId, documentId } },
      create: { documentId, organizationId: orgId, userId, draftJson: validated },
      update: { draftJson: validated, userId },
    });
  }

  // P9 finding: this is the HTTP-facing DELETE /design-drafts/:documentId path (see
  // DesignDraftsController) — unlike putDraft/getDraft and the deleteMany-as-cleanup calls in
  // create()/update() above (safe no-ops by design, not user-facing 404 surfaces), a
  // caller-invoked delete of a foreign org's documentId is data-safe either way (the where-clause
  // is already org-scoped, so it can never touch another org's row) but returning 200/{count:0}
  // instead of 404 for a cross-tenant id contradicts both the plan's matrix ("A deletes B id →
  // 404") and the assertOwns-first convention every other delete method in this codebase follows.
  // Confirm the row belongs to this org before deleting so the status code matches that
  // convention.
  async removeDraft(orgId: string, documentId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.designDraft.findFirst({ where: { documentId, organizationId: orgId } }),
      'Draft not found',
    );
    await this.prisma.designDraft.deleteMany({ where: { documentId, organizationId: orgId } });
  }
}
