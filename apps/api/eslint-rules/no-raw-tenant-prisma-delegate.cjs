const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Plain CommonJS (not .mjs) deliberately — this lets both eslint.config.mjs (via ESM default-
// export interop on a `module.exports = {...}` object) and the RuleTester spec under test/ (via a
// plain `require()`, no dynamic import) load it without needing Jest's
// --experimental-vm-modules flag, which a .mjs module would have forced on the RuleTester spec.

// P9 required suite #9 (docs/tenant_isolation_and_platform_admin_plan.md, "implement a custom
// ESLint rule (for example `no-raw-tenant-prisma-delegate`) that flags direct tenant-root Prisma
// delegate access outside allow-listed tenant/platform repositories"). This codebase has no
// separate repository layer (services call `this.prisma.<model>.<method>()` directly, guarded by
// OrgScopedService.assertOwns or an equivalent inline where-clause — see that file's own
// comment), so "allow-listed repositories" here means allow-listed *files*
// (eslint.config.mjs scopes this rule off for those), and the rule itself checks the one thing
// that actually matters for tenant isolation: does the `where` clause of a risky Prisma call on a
// tenant-owned model actually scope by organizationId, in any of the shapes this codebase uses
// (a plain `organizationId` key, a compound-unique key whose name contains it, or an `OR` array
// where every branch does — the shared-library convention).
//
// Deliberately does NOT require type information (no need for this to run through
// typescript-eslint's `projectService`) — it is pure syntax matching on `this.prisma.X.method(...)`
// / `prisma.X.method(...)` call shapes, so it stays fast and has no risk of misclassifying due to
// type inference gaps.

const schemaPath = join(__dirname, '../prisma/schema.prisma');

function loadDirectOrgIdModels() {
  const schema = readFileSync(schemaPath, 'utf8');
  const models = new Set();
  const startRe = /model\s+(\w+)\s*\{/g;
  let m;
  while ((m = startRe.exec(schema))) {
    const name = m[1];
    let depth = 1;
    let i = startRe.lastIndex;
    const bodyStart = i;
    while (i < schema.length && depth > 0) {
      if (schema[i] === '{') depth++;
      else if (schema[i] === '}') depth--;
      i++;
    }
    const body = schema.slice(bodyStart, i - 1);
    if (body.split('\n').some((l) => /^\s*organizationId\s/.test(l))) {
      models.add(name.charAt(0).toLowerCase() + name.slice(1));
    }
    startRe.lastIndex = i;
  }
  return models;
}

const TENANT_DELEGATES = loadDirectOrgIdModels();

// Mutation methods only. A first pass covering every read method too (findUnique/findMany/count)
// produced ~180 hits dominated by two legitimate, codebase-wide patterns a pure syntax rule can't
// safely distinguish from a real bug: (1) identity resolution by bare `id` before any tenant is
// known yet (JwtStrategy/PlayerJwtStrategy/SuperAdminGuard resolving `payload.sub`), and (2) the
// established `assertOwns()`-then-mutate-by-id convention (OrgScopedService runs the one
// organizationId-scoped lookup, and the mutation immediately after it correctly trusts that
// already-verified id without repeating the scope in its own where clause). Mutations are both
// the higher-consequence surface and where an *ownership check entirely skipped* is
// distinguishable from that pattern (see FUNCTION_HAS_PRIOR_OWNERSHIP_CHECK below).
const RISKY_METHODS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

// Textual, not full data-flow — matches this codebase's consistent style (verified by reading
// dozens of services this session): an ownership check runs once per method, near the top
// (`this.orgScoped.assertOwns(...)`, or a same-delegate find call whose own where clause already
// carries organizationId), and every mutation later in that same method trusts whichever
// already-verified identifier it resolved (a bare `id`, or another unique FK like a KioskLocation
// row's `screenId` after `this.findOne(orgId, screenId)` already confirmed that screen is this
// org's) rather than re-deriving organizationId at each call site. That shape immediately after
// such a check is the codebase's blessed convention, not a gap; the same shape with no prior
// check anywhere in the same function is the actual bug class this rule exists to catch.
const OWNERSHIP_CHECK_PATTERN = /\.assertOwns\(|organizationId\s*[:,]/;

// Anything simpler than an OR/AND-combined where clause is eligible for the prior-ownership-check
// bypass below — objectHasOrgScopeKey has already ruled out this exact clause being org-scoped
// itself by the time this runs, so the only question left is whether *some* org-scoped check ran
// earlier in the same function, not what field this particular clause happens to key off.
function isSimpleWhere(whereValue) {
  if (!whereValue || whereValue.type !== 'ObjectExpression') return false;
  return !whereValue.properties.some((p) => p.type === 'Property' && p.key.type === 'Identifier' && (p.key.name === 'OR' || p.key.name === 'AND'));
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// Outermost, not nearest: a risky call is routinely nested inside a `.map()`/`.forEach()`/
// `$transaction()` callback (a bulk reorder, a batch update) whose own tiny arrow body obviously
// never repeats an ownership check already done once in the enclosing class method, a few lines
// above the callback. Walking up to the outermost function (typically that class method, not the
// inner callback) is what lets OWNERSHIP_CHECK_PATTERN / functionUsesOrgIdParamBeforeCall below
// actually see that earlier check.
function findOutermostEnclosingFunction(node) {
  let cur = node.parent;
  let outermost = null;
  while (cur) {
    if (FUNCTION_TYPES.has(cur.type)) outermost = cur;
    cur = cur.parent;
  }
  return outermost;
}

// A second, broader signal alongside OWNERSHIP_CHECK_PATTERN: this codebase's ownership checks
// are very often expressed as a call to another same-class method (`this.findOne(orgId, id)`,
// `this.assertX(orgId, ...)`) rather than a literal `assertOwns(`/`organizationId:` text in the
// same function — a purely textual same-function scan can't see through that indirection without
// resolving the callee. What it *can* still observe: if this function accepts an org-id-shaped
// parameter and that parameter is referenced again (passed somewhere, compared, etc.) before this
// mutation — not just declared in the signature — that's a strong, low-noise proxy for "some
// org-scoped resolution already happened here," matching the codebase's real style, without
// needing to resolve what the other method actually does.
function functionUsesOrgIdParamBeforeCall(fn, sourceCode, callStart) {
  const orgParam = fn.params.find((p) => p.type === 'Identifier' && /^(orgId|organizationId)$/i.test(p.name));
  if (!orgParam) return false;
  const bodyStart = fn.body ? fn.body.range[0] : fn.range[0];
  const textBeforeCall = sourceCode.getText().slice(bodyStart, callStart);
  const occurrences = textBeforeCall.split(new RegExp(`\\b${orgParam.name}\\b`)).length - 1;
  return occurrences >= 1;
}

function isPrismaRoot(node) {
  if (!node) return false;
  if (node.type === 'MemberExpression') {
    return node.object.type === 'ThisExpression' && node.property.type === 'Identifier' && node.property.name === 'prisma';
  }
  return node.type === 'Identifier' && node.name === 'prisma';
}

function objectHasOrgScopeKey(objExpr) {
  if (!objExpr || objExpr.type !== 'ObjectExpression') return false;
  for (const prop of objExpr.properties) {
    if (prop.type !== 'Property') continue;
    const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'Literal' ? String(prop.key.value) : null;
    if (!keyName) continue;
    if (keyName.toLowerCase().includes('organizationid')) return true;
    if ((keyName === 'OR' || keyName === 'AND') && prop.value.type === 'ArrayExpression') {
      const elements = prop.value.elements.filter(Boolean);
      if (elements.length === 0) continue;
      if (keyName === 'OR' && elements.every((el) => objectHasOrgScopeKey(el))) return true;
      if (keyName === 'AND' && elements.some((el) => objectHasOrgScopeKey(el))) return true;
    }
  }
  return false;
}

module.exports = {
  rules: {
    'no-raw-tenant-prisma-delegate': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require org-scoped where clauses on raw Prisma delegate access to tenant-owned models.',
        },
        schema: [],
        messages: {
          unscoped:
            "'{{delegate}}.{{method}}()' accesses tenant-owned model '{{delegate}}' without an organizationId-scoped where clause. Every read/write against a tenant-private model must scope by organizationId (directly, via a compound key, or via an OR array where every branch does) — see OrgScopedService.assertOwns and docs/tenant_isolation_and_platform_admin_plan.md. If this call is intentionally cross-tenant (a Super Admin platform operation, a migration/audit script, or a test), scope it out in eslint.config.mjs instead of suppressing this line.",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== 'MemberExpression') return;
            const method = callee.property.type === 'Identifier' ? callee.property.name : null;
            if (!method || !RISKY_METHODS.has(method)) return;

            const delegateExpr = callee.object;
            if (delegateExpr.type !== 'MemberExpression') return;
            const delegateName = delegateExpr.property.type === 'Identifier' ? delegateExpr.property.name : null;
            if (!delegateName || !TENANT_DELEGATES.has(delegateName)) return;
            if (!isPrismaRoot(delegateExpr.object)) return;

            const optionsArg = node.arguments[0];
            const whereProp =
              optionsArg && optionsArg.type === 'ObjectExpression'
                ? optionsArg.properties.find((p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where')
                : undefined;
            const whereValue = whereProp && whereProp.type === 'Property' ? whereProp.value : undefined;

            if (objectHasOrgScopeKey(whereValue)) return;

            if (isSimpleWhere(whereValue)) {
              const fn = findOutermostEnclosingFunction(node);
              if (fn) {
                const fnText = sourceCode.getText().slice(fn.range[0], node.range[0]);
                if (OWNERSHIP_CHECK_PATTERN.test(fnText)) return;
                if (functionUsesOrgIdParamBeforeCall(fn, sourceCode, node.range[0])) return;
              }
            }

            context.report({ node, messageId: 'unscoped', data: { delegate: delegateName, method } });
          },
        };
      },
    },
  },
};
