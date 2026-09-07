import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaClient } from '@lumina/db';
import { createTestApp, createTestPrisma } from '../utils/test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §"Build a reusable two-tenant test
// fixture") — the plan's own matrix, run for real over HTTP against the actual Nest app and a
// real Postgres, not a mocked Prisma delegate. This is a first slice establishing the fixture
// and the pattern across a representative set of resources (Screens as the plain tenant-private
// case, the shared Asset library and Templates for the platform/shared-content split, an
// explicit Super Admin /admin operation, and session/credential revocation) — the plan's own
// baseline note says treat P9 as a new suite, not a small extension, so this deliberately does
// not attempt every controller in the app in one pass. Extending it to another resource is
// mechanical: reuse `fixture`/`app`, add a `describe` block following the same rows.
describe('Tenant isolation — end-to-end IDOR matrix', () => {
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('Screens — plain tenant-private resource', () => {
    it('A lists A resources: only A records, never B', async () => {
      const res = await request(app.getHttpServer()).get('/v1/screens').set(auth(fixture.tenantA.editor.token));

      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((s: { id: string }) => s.id);
      expect(ids).toContain(fixture.tenantA.screenId);
      expect(ids).not.toContain(fixture.tenantB.screenId);
    });

    it('A gets B ID: 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/screens/${fixture.tenantB.screenId}`)
        .set(auth(fixture.tenantA.editor.token));

      expect(res.status).toBe(404);
    });

    it('A updates B ID: 404, no mutation', async () => {
      const before = await prisma.screen.findUniqueOrThrow({ where: { id: fixture.tenantB.screenId } });

      const res = await request(app.getHttpServer())
        .put(`/v1/screens/${fixture.tenantB.screenId}`)
        .set(auth(fixture.tenantA.owner.token))
        .send({ name: 'Hijacked Name' });

      expect(res.status).toBe(404);
      const after = await prisma.screen.findUniqueOrThrow({ where: { id: fixture.tenantB.screenId } });
      expect(after.name).toBe(before.name);
    });

    it('A deletes B ID: 404, row survives', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/screens/${fixture.tenantB.screenId}`)
        .set(auth(fixture.tenantA.owner.token));

      expect(res.status).toBe(404);
      await expect(prisma.screen.findUniqueOrThrow({ where: { id: fixture.tenantB.screenId } })).resolves.toBeDefined();
    });
  });

  describe('Assets — tenant-private vs. platform-shared library', () => {
    it("A cannot read B's tenant-private asset: 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/assets/${fixture.tenantB.assetId}`)
        .set(auth(fixture.tenantA.editor.token));

      expect(res.status).toBe(404);
    });

    // Found while writing this suite: AssetsService.findOne() only matched
    // { id, organizationId: orgId } — no organizationId: null fallback — the one asset-visibility
    // check in the codebase inconsistent with the documented tenant-owned-or-shared-library
    // convention every other one follows (DesignsService.assertAssetsOwned, media resolution; see
    // designer.md's own "batch-checked against tenant-owned-or-shared-library assets" note).
    // Fixed in assets.service.ts (see its own comment) rather than worked around here.
    it('B can read a platform-shared asset directly by id: success', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/assets/${fixture.platform.sharedAssetId}`)
        .set(auth(fixture.tenantB.viewer.token));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fixture.platform.sharedAssetId);
    });

    it('B can list the platform-shared library and see the shared asset: success', async () => {
      const res = await request(app.getHttpServer()).get('/v1/assets/library').set(auth(fixture.tenantB.viewer.token));

      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((a: { id: string }) => a.id);
      expect(ids).toContain(fixture.platform.sharedAssetId);
    });

    it('B can copy the platform-shared asset into their own tenant: success', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/assets/library/${fixture.platform.sharedAssetId}/use`)
        .set(auth(fixture.tenantB.editor.token));

      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(fixture.tenantB.orgId);
      // toDto() doesn't serialize sourceLibraryAssetId (provenance metadata, not part of this
      // endpoint's response contract) — assert the DB row directly instead.
      const created = await prisma.asset.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(created.sourceLibraryAssetId).toBe(fixture.platform.sharedAssetId);
    });

    it('a non-Super-Admin cannot mutate the shared library source: 403, no mutation', async () => {
      const before = await prisma.asset.findUniqueOrThrow({ where: { id: fixture.platform.sharedAssetId } });

      const res = await request(app.getHttpServer())
        .put(`/v1/assets/library/${fixture.platform.sharedAssetId}`)
        .set(auth(fixture.tenantA.owner.token))
        .send({ name: 'Hijacked Shared Asset' });

      expect(res.status).toBe(403);
      const after = await prisma.asset.findUniqueOrThrow({ where: { id: fixture.platform.sharedAssetId } });
      expect(after.name).toBe(before.name);
    });
  });

  describe('Templates — GLOBAL vs. SELECTED_TENANTS visibility', () => {
    it('B (unassigned) reads a GLOBAL template: success', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/templates/${fixture.platform.globalTemplateId}`)
        .set(auth(fixture.tenantB.editor.token));

      expect(res.status).toBe(200);
    });

    it('B (unassigned) reads a SELECTED_TENANTS template scoped to A only: 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/templates/${fixture.platform.selectedTenantTemplateId}`)
        .set(auth(fixture.tenantB.editor.token));

      expect(res.status).toBe(404);
    });

    it('A (assigned) reads the same SELECTED_TENANTS template: success', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/templates/${fixture.platform.selectedTenantTemplateId}`)
        .set(auth(fixture.tenantA.editor.token));

      expect(res.status).toBe(200);
    });
  });

  describe('Super Admin — explicit /admin operation succeeds and is audited', () => {
    it('suspending a tenant succeeds and writes a PlatformAuditLog row targeting it', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v1/admin/tenants/${fixture.tenantB.orgId}/status`)
        .set(auth(fixture.platform.superAdminToken))
        .send({ status: 'SUSPENDED', reason: 'P9 fixture exercise' });

      expect(res.status).toBe(200);

      const auditRow = await prisma.platformAuditLog.findFirst({
        where: { targetOrganizationId: fixture.tenantB.orgId, action: 'tenant.status.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorUserId).toBe(fixture.platform.superAdminUserId);
      expect(auditRow?.reason).toBe('P9 fixture exercise');

      // Reactivate — this suite's fixture cleanup deletes the org regardless, but leaving a
      // suspended org mid-suite could confuse a later test in this same file if one is added.
      await request(app.getHttpServer())
        .put(`/v1/admin/tenants/${fixture.tenantB.orgId}/status`)
        .set(auth(fixture.platform.superAdminToken))
        .send({ status: 'ACTIVE' });
    });

    it('a non-Super-Admin cannot reach the same /admin operation: 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v1/admin/tenants/${fixture.tenantA.orgId}/status`)
        .set(auth(fixture.tenantA.owner.token))
        .send({ status: 'SUSPENDED', reason: 'should never land' });

      expect(res.status).toBe(403);
    });
  });

  describe('Sessions and device credentials — revocation is enforced live, not just at issue time', () => {
    it('a removed user reusing their old JWT is rejected', async () => {
      // A throwaway user, removed immediately after minting its token — the token itself never
      // expires within this test's lifetime, so only a live DB check (JwtStrategy.validate, P2)
      // can catch this.
      const throwaway = await prisma.user.create({
        data: { email: `throwaway-${Date.now()}@fixture.test`, passwordHash: 'x', name: 'Throwaway', role: 'VIEWER', organizationId: fixture.tenantA.orgId },
      });
      const token = app.get(JwtService).sign({ sub: throwaway.id, orgId: fixture.tenantA.orgId, role: 'VIEWER', isSuperAdmin: false, authVersion: throwaway.authVersion });
      await prisma.user.delete({ where: { id: throwaway.id } });

      const res = await request(app.getHttpServer()).get('/v1/screens').set(auth(token));

      expect(res.status).toBe(401);
    });

    it("a user whose sessions were revoked (authVersion bumped) can't reuse their old JWT", async () => {
      await prisma.user.update({ where: { id: fixture.tenantA.viewer.id }, data: { authVersion: { increment: 1 } } });

      const res = await request(app.getHttpServer()).get('/v1/screens').set(auth(fixture.tenantA.viewer.token));

      expect(res.status).toBe(401);
    });

    it('a revoked/deleted screen reusing its old player credential is rejected', async () => {
      const res = await request(app.getHttpServer()).get('/v1/player/state').set(auth(fixture.revokedScreenToken));

      expect([401, 404]).toContain(res.status);
    });

    it("A's still-valid player credential is accepted", async () => {
      const res = await request(app.getHttpServer()).get('/v1/player/state').set(auth(fixture.tenantA.screenToken));

      expect(res.status).toBe(200);
    });
  });
});
