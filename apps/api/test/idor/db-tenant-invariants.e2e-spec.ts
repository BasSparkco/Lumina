import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@lumina/db';
import { createTestApp, createTestPrisma } from '../utils/test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';

// P9 required suite #10 (docs/tenant_isolation_and_platform_admin_plan.md, "Migration tests for
// historical cross-org AuditLog rows, unowned screens, and duplicate DesignDraft.documentId
// values") — P5a (see that section's own Goal: "make common cross-tenant references impossible
// even if a service bug is introduced") closed these three historical-data classes with
// structural DB invariants rather than application code: `Screen.organizationId NOT NULL`, 15
// hand-written Postgres triggers enforcing composite tenant references (see
// prisma/migrations/20260906215405_p5a_composite_tenant_fks and .../20260905223040_..._audit_
// targets_and_design_draft_scope), and a `(organizationId, documentId)`-scoped unique constraint
// on DesignDraft. This suite exercises those invariants directly via raw Prisma writes that
// bypass every service-layer ownership check — the exact "service bug" scenario P5a's own goal
// names — to prove the database itself, not just the API, refuses the historical bad shapes.
// (The API-level regression coverage for DesignDraft's compound key already lives in
// designs-members-playlist-items.e2e-spec.ts; this suite adds the DB-trigger layer beneath it.)
describe('P5a database-level tenant invariants (migration regression)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    fixture = await buildTwoTenantFixture(prisma, app.get(JwtService));
  });

  afterAll(async () => {
    await fixture.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('a Screen row can no longer exist without an organizationId (NOT NULL, not just a service check)', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO "Screen" (id, name, "organizationId") VALUES ('unowned-screen-test', 'Unowned', NULL)`,
    ).rejects.toThrow();
  });

  it("a Schedule cannot reference another org's Screen even via a direct, service-bypassing insert (trigger rejects it)", async () => {
    await expect(
      prisma.schedule.create({
        data: {
          organizationId: fixture.tenantA.orgId,
          name: 'Cross-tenant schedule',
          playlistId: fixture.tenantA.playlistId,
          screenId: fixture.tenantB.screenId,
          daysOfWeek: [],
        },
      }),
    ).rejects.toThrow(/does not belong to Schedule\.organizationId/);
  });

  it("a PlaylistItem cannot reference another org's (non-shared) Asset via a direct insert (trigger rejects it)", async () => {
    await expect(
      prisma.playlistItem.create({
        data: {
          organizationId: fixture.tenantA.orgId,
          playlistId: fixture.tenantA.playlistId,
          position: 99,
          durationSecs: 10,
          assetId: fixture.tenantB.assetId,
        },
      }),
    ).rejects.toThrow(/does not belong to PlaylistItem\.organizationId/);
  });

  it("a PlaylistItem CAN reference the platform-shared Asset library despite the tenant-ref trigger (shared-asset carve-out)", async () => {
    const item = await prisma.playlistItem.create({
      data: {
        organizationId: fixture.tenantA.orgId,
        playlistId: fixture.tenantA.playlistId,
        position: 98,
        durationSecs: 10,
        assetId: fixture.platform.sharedAssetId,
      },
    });
    expect(item.assetId).toBe(fixture.platform.sharedAssetId);
    await prisma.playlistItem.delete({ where: { id: item.id } });
  });

  it("an AuditLog row's userId must belong to its own organizationId, even via a direct insert (trigger rejects a cross-org actor)", async () => {
    await expect(
      prisma.auditLog.create({
        data: {
          organizationId: fixture.tenantA.orgId,
          userId: fixture.tenantB.owner.id,
          action: 'test.cross-org-actor',
          resourceType: 'test',
        },
      }),
    ).rejects.toThrow(/AuditLog\.userId .* does not belong to AuditLog\.organizationId/);
  });

  describe('DesignDraft uniqueness is scoped to (organizationId, documentId), not global', () => {
    it('the same documentId under two different orgs is not a duplicate', async () => {
      const documentId = `migration-test-doc-${Date.now()}`;
      const a = await prisma.designDraft.create({
        data: { organizationId: fixture.tenantA.orgId, documentId, userId: fixture.tenantA.owner.id, draftJson: {} },
      });
      const b = await prisma.designDraft.create({
        data: { organizationId: fixture.tenantB.orgId, documentId, userId: fixture.tenantB.owner.id, draftJson: {} },
      });
      expect(a.id).not.toBe(b.id);
    });

    it('the same documentId inserted twice within the same org IS rejected (the scoped unique constraint still holds)', async () => {
      const documentId = `migration-test-dup-${Date.now()}`;
      await prisma.designDraft.create({
        data: { organizationId: fixture.tenantA.orgId, documentId, userId: fixture.tenantA.owner.id, draftJson: {} },
      });
      await expect(
        prisma.designDraft.create({
          data: { organizationId: fixture.tenantA.orgId, documentId, userId: fixture.tenantA.owner.id, draftJson: {} },
        }),
      ).rejects.toThrow();
    });
  });
});
