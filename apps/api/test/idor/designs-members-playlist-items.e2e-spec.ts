import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaClient } from '@lumina/db';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { createTestApp, createTestPrisma } from '../utils/test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md) — three IDOR classes the other two e2e
// files don't cover: DesignAsset (get/patch/rename), org membership/invite manipulation using a
// memberId/inviteId from a *different* org (the plan's own named test: "Tenant A receives 404
// when changing/removing Tenant B member or invite IDs"), a DesignDraft looked up by its
// client-generated documentId (P5a's compound-uniqueness fix — regression coverage for a real
// historical IDOR, not a hypothetical), and adding/mutating items on a playlist the caller
// doesn't own.
describe('Tenant isolation — designs, membership, and playlist-item IDOR', () => {
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
  const asA = () => auth(fixture.tenantA.owner.token);

  describe('DesignAsset', () => {
    it("A cannot GET/PATCH/rename B's design", async () => {
      const bId = fixture.tenantB.designAssetId;

      const getRes = await request(app.getHttpServer()).get(`/v1/designs/${bId}`).set(asA());
      expect(getRes.status).toBe(404);

      const before = await prisma.designAsset.findUniqueOrThrow({ where: { id: bId } });

      const patchRes = await request(app.getHttpServer()).patch(`/v1/designs/${bId}`).set(asA()).send({ name: 'Hijacked' });
      expect(patchRes.status).toBe(404);

      const renameRes = await request(app.getHttpServer()).put(`/v1/designs/${bId}/name`).set(asA()).send({ name: 'Hijacked' });
      expect(renameRes.status).toBe(404);

      const after = await prisma.designAsset.findUniqueOrThrow({ where: { id: bId } });
      expect(after.name).toBe(before.name);
    });
  });

  describe('DesignDraft — P5a compound-uniqueness regression coverage', () => {
    const DOCUMENT_ID = `shared-fixture-document-id-${Date.now()}`;

    it("B's draft under a documentId also used by A stays B's own row — no cross-tenant collision", async () => {
      const draftA = buildBlankDesignDocument('A Draft');
      const draftB = buildBlankDesignDocument('B Draft');

      const putA = await request(app.getHttpServer())
        .put(`/v1/design-drafts/${DOCUMENT_ID}`)
        .set(asA())
        .send({ draftJson: draftA });
      expect(putA.status).toBe(200);

      const putB = await request(app.getHttpServer())
        .put(`/v1/design-drafts/${DOCUMENT_ID}`)
        .set(auth(fixture.tenantB.owner.token))
        .send({ draftJson: draftB });
      expect(putB.status).toBe(200);

      // If these ever collided (the pre-P5a bug: documentId was globally unique, not scoped to
      // (organizationId, documentId)), A's read below would see B's write.
      const getA = await request(app.getHttpServer()).get(`/v1/design-drafts/${DOCUMENT_ID}`).set(asA());
      expect(getA.status).toBe(200);
      expect(getA.body.draftJson).toEqual(draftA);

      // Scoped to this fixture's own two orgs, not a bare `where: { documentId }` count — this
      // literal documentId is shared across every run of this suite, and previous runs' fixture
      // orgs/rows may still be present in a shared dev database this suite doesn't own exclusively.
      const rows = await prisma.designDraft.findMany({
        where: { documentId: DOCUMENT_ID, organizationId: { in: [fixture.tenantA.orgId, fixture.tenantB.orgId] } },
      });
      expect(rows).toHaveLength(2);
    });

    // Also regression coverage for the P9 removeDraft fix (designs.service.ts) — before that fix
    // this returned 200/{count:0} instead of 404 for a foreign-org documentId.
    it("A deleting a documentId that only exists under B's org: 404, B's row survives", async () => {
      const otherDocId = 'b-only-fixture-document-id';
      await prisma.designDraft.create({
        data: {
          organizationId: fixture.tenantB.orgId,
          documentId: otherDocId,
          userId: fixture.tenantB.owner.id,
          draftJson: buildBlankDesignDocument('B Only Draft'),
        },
      });

      const res = await request(app.getHttpServer()).delete(`/v1/design-drafts/${otherDocId}`).set(asA());
      expect(res.status).toBe(404);

      await expect(
        prisma.designDraft.findUniqueOrThrow({ where: { organizationId_documentId: { organizationId: fixture.tenantB.orgId, documentId: otherDocId } } }),
      ).resolves.toBeDefined();
    });
  });

  describe('Org membership/invites — a memberId/inviteId from a different org', () => {
    it("A changing B's member role: 404, B's role unchanged", async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: fixture.tenantB.viewer.id } });

      const res = await request(app.getHttpServer())
        .put(`/v1/org/members/${fixture.tenantB.viewer.id}/role`)
        .set(asA())
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(404);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: fixture.tenantB.viewer.id } });
      expect(after.role).toBe(before.role);
    });

    it("A removing B's member: 404, B's user row survives", async () => {
      const res = await request(app.getHttpServer()).delete(`/v1/org/members/${fixture.tenantB.viewer.id}`).set(asA());
      expect(res.status).toBe(404);

      await expect(prisma.user.findUniqueOrThrow({ where: { id: fixture.tenantB.viewer.id } })).resolves.toBeDefined();
    });

    it("A revoking B's pending invite: 404, invite survives", async () => {
      const invite = await prisma.orgInvite.create({
        data: {
          organizationId: fixture.tenantB.orgId,
          email: `b-pending-${Date.now()}@fixture.test`,
          role: 'EDITOR',
          token: `fixture-token-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const res = await request(app.getHttpServer()).delete(`/v1/org/invites/${invite.id}`).set(asA());
      expect(res.status).toBe(404);

      await expect(prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).resolves.toBeDefined();
    });
  });

  describe('Playlist items — mutating items on a playlist the caller does not own', () => {
    it("A cannot add an item to B's playlist: 404, no item created", async () => {
      const before = await prisma.playlistItem.count({ where: { playlistId: fixture.tenantB.playlistId } });

      const res = await request(app.getHttpServer())
        .post(`/v1/playlists/${fixture.tenantB.playlistId}/items`)
        .set(asA())
        .send({ assetId: fixture.tenantA.assetId, durationSecs: 10 });
      expect(res.status).toBe(404);

      const after = await prisma.playlistItem.count({ where: { playlistId: fixture.tenantB.playlistId } });
      expect(after).toBe(before);
    });

    it("A cannot update or remove an item that genuinely belongs to B's playlist: 404, item survives", async () => {
      const bItem = await prisma.playlistItem.create({
        data: {
          playlistId: fixture.tenantB.playlistId,
          organizationId: fixture.tenantB.orgId,
          position: 0,
          durationSecs: 10,
          assetId: fixture.tenantB.assetId,
        },
      });

      const updateRes = await request(app.getHttpServer())
        .put(`/v1/playlists/${fixture.tenantB.playlistId}/items/${bItem.id}`)
        .set(asA())
        .send({ durationSecs: 99 });
      expect(updateRes.status).toBe(404);

      const removeRes = await request(app.getHttpServer())
        .delete(`/v1/playlists/${fixture.tenantB.playlistId}/items/${bItem.id}`)
        .set(asA());
      expect(removeRes.status).toBe(404);

      const survived = await prisma.playlistItem.findUniqueOrThrow({ where: { id: bItem.id } });
      expect(survived.durationSecs).toBe(10);
    });
  });
});
