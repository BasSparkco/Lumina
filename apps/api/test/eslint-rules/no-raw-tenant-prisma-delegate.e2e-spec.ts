import { RuleTester } from 'eslint';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §P9 task 9) — locks in the custom
// no-raw-tenant-prisma-delegate rule's behavior (eslint-rules/no-raw-tenant-prisma-delegate.cjs)
// so a future change to it can't silently regress into either extreme: flagging the codebase's
// established, safe `assertOwns()`-then-mutate-by-id convention (the ~180-hit false-positive
// state the rule went through during development, before the ownership-check heuristics were
// added — see that file's own comments), or missing a genuinely unscoped tenant-model mutation.
//
// RuleTester registers its own describe/it blocks against the ambient test-framework globals it
// detects (Jest's, here) — it has to run at module scope, not nested inside an `it()`, or Jest
// rejects the nested describe/it it creates.
// The rule module is plain CommonJS on purpose (see its own file header), specifically so it can
// be loaded here with a synchronous require() rather than needing Jest's --experimental-vm-modules
// for a dynamic import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('../../eslint-rules/no-raw-tenant-prisma-delegate.cjs') as { rules: Record<string, unknown> };
const rule = mod.rules['no-raw-tenant-prisma-delegate'];

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-raw-tenant-prisma-delegate', rule as never, {
  valid: [
    // Directly organizationId-scoped.
    `class S { async f(orgId) { return this.prisma.screen.update({ where: { id, organizationId: orgId }, data: {} }); } }`,
    // Compound-unique key containing organizationId.
    `class S { async f(orgId, documentId) { return this.prisma.designDraft.deleteMany({ where: { organizationId_documentId: { organizationId: orgId, documentId } } }); } }`,
    // Shared-library OR convention: every branch org-scoped.
    `class S { async f(orgId) { return this.prisma.asset.update({ where: { id, OR: [{ organizationId: orgId }, { organizationId: null }] }, data: {} }); } }`,
    // Established assertOwns()-then-mutate-by-id convention.
    `class S { async f(orgId, id) { await this.orgScoped.assertOwns(() => this.prisma.screen.findFirst({ where: { id, organizationId: orgId } }), 'x'); return this.prisma.screen.update({ where: { id }, data: {} }); } }`,
    // assertOwns via a same-class wrapper method (this.findOne), not a literal assertOwns( call.
    `class S { async f(orgId, id) { await this.findOne(orgId, id); return this.prisma.screen.update({ where: { id }, data: {} }); } }`,
    // Nested inside a .map() callback — the ownership check is in the outer method, not the callback.
    `class S { async f(orgId, ids) { const n = await this.prisma.screen.count({ where: { id: { in: ids }, organizationId: orgId } }); if (n !== ids.length) throw 1; await this.prisma.$transaction(ids.map((id, i) => this.prisma.screen.update({ where: { id }, data: { sortOrder: i } }))); } }`,
    // A non-tenant (platform) model is never flagged regardless of scoping.
    `class S { async f() { return this.prisma.designTemplate.update({ where: { id }, data: {} }); } }`,
    // Read methods are out of scope for this rule (mutation-only, see file header).
    `class S { async f(id) { return this.prisma.screen.findUnique({ where: { id } }); } }`,
    // create() is out of scope (no where clause to check).
    `class S { async f(orgId) { return this.prisma.screen.create({ data: { organizationId: orgId } }); } }`,
  ],
  invalid: [
    {
      code: `class S { async f(id) { return this.prisma.screen.update({ where: { id }, data: { name: 'x' } }); } }`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: `class S { async f(orgId, id) { return this.prisma.screen.update({ where: { id }, data: {} }); } }`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: `class S { async f() { return this.prisma.playlistItem.deleteMany({ where: { assetId: 'x' } }); } }`,
      errors: [{ messageId: 'unscoped' }],
    },
  ],
});
