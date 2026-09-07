import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaClient } from '@lumina/db';
import { createTestApp, createTestPrisma } from '../utils/test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';
import { MediaTokenService } from '../../src/modules/storage/media-token.service';

// P9 required suite #5 (docs/tenant_isolation_and_platform_admin_plan.md, "Media URL/download
// authorization tests") — MediaController (src/modules/assets/media.controller.ts) is
// deliberately unauthenticated in the JwtAuthGuard sense (an <img>/<video> tag can't send a
// Bearer header): the short-lived signed token minted by MediaTokenService *is* the entire
// authorization decision, frozen at mint time by whichever caller already ran a real
// ownership/visibility check. That means the actual cross-tenant boundary to verify isn't "does
// tenant A's asset row 404 for tenant B" (tenant-isolation.e2e-spec.ts already covers that, and
// it's what stops B from ever being handed a token for A's asset in the first place) — it's
// whether the token verification itself is airtight: resource-id-bound, kind-bound, and
// time-bound, so a forged, reused, expired, or resource-swapped token can never substitute for a
// real mint-time authorization check.
describe('Media/download authorization', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: TwoTenantFixture;
  let mediaTokens: MediaTokenService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    fixture = await buildTwoTenantFixture(prisma, app.get(JwtService));
    mediaTokens = app.get(MediaTokenService);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function fetchOwnAssetToken(assetToken: string, assetId: string): Promise<string> {
    const res = await request(app.getHttpServer()).get(`/v1/assets/${assetId}`).set(auth(assetToken));
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();
    return token!;
  }

  it("A's genuinely minted token for their own asset passes MediaController's auth check", async () => {
    const token = await fetchOwnAssetToken(fixture.tenantA.owner.token, fixture.tenantA.assetId);

    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}?token=${token}`);

    // No object was actually uploaded to storage for this fixture asset, so this can legitimately
    // 404 at the storage layer — the point of this assertion is that it gets *past* the token
    // check (never 401) to reach that storage lookup at all.
    expect(res.status).not.toBe(401);
  });

  it('a request with no token at all is rejected: 401', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}`);
    expect(res.status).toBe(401);
  });

  it("a token minted for Tenant B's asset cannot be replayed against Tenant A's assetId in the URL", async () => {
    const bToken = await fetchOwnAssetToken(fixture.tenantB.owner.token, fixture.tenantB.assetId);

    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}?token=${bToken}`);

    expect(res.status).toBe(401);
  });

  it('a tampered token (flipped signature byte) is rejected: 401', async () => {
    const token = await fetchOwnAssetToken(fixture.tenantA.owner.token, fixture.tenantA.assetId);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}?token=${tampered}`);

    expect(res.status).toBe(401);
  });

  it('an expired token is rejected: 401', async () => {
    const expired = mediaTokens.sign('asset', fixture.tenantA.assetId, -1);

    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}?token=${expired}`);

    expect(res.status).toBe(401);
  });

  it("a thumbnail-kind token cannot be reused against the full-file asset route: 401", async () => {
    const thumbToken = mediaTokens.sign('asset-thumb', fixture.tenantA.assetId, 60);

    const res = await request(app.getHttpServer()).get(`/v1/media/assets/${fixture.tenantA.assetId}?token=${thumbToken}`);

    expect(res.status).toBe(401);
  });

  it("a screenshot token cannot be reused against a different screenId in the URL", async () => {
    const screenshotTokenForA = mediaTokens.sign('screenshot', fixture.tenantA.screenId, 60);

    const res = await request(app.getHttpServer())
      .get(`/v1/media/screens/${fixture.tenantB.screenId}/screenshot?token=${screenshotTokenForA}`);

    expect(res.status).toBe(401);
  });
});
