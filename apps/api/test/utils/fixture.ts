import type { PrismaClient } from '@lumina/db';
import type { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md §"Build a reusable two-tenant test
// fixture") — Tenant A / Tenant B / Platform, each with the resource shapes the plan's own
// matrix names, plus paired and revoked device credentials. Built directly via Prisma (not
// through the HTTP layer) for speed and determinism — the point of this suite is authorization
// on *read/write* endpoints, not exercising every creation endpoint's own validation.
//
// Real JWTs are signed with the app's own JwtService (same secret the running app's
// JwtStrategy/PlayerJwtStrategy verify against — see test-app.ts), matching the exact payload
// shape AuthService.buildTokenResponse / ScreensService.confirmPairing sign in production
// ({sub, orgId, role, isSuperAdmin, authVersion} for a dashboard user; {sub, orgId, type:
// 'screen'} for a player, checked against Screen.playerToken) — a hand-rolled shape would test
// nothing real.

export interface TenantFixture {
  orgId: string;
  slug: string;
  owner: { id: string; token: string };
  admin: { id: string; token: string };
  editor: { id: string; token: string };
  viewer: { id: string; token: string };
  assetId: string;
  playlistId: string;
  screenId: string;
  screenToken: string;
  designAssetId: string;
  buildingId: string;
  roomId: string;
}

export interface PlatformFixture {
  superAdminOrgId: string;
  superAdminUserId: string;
  superAdminToken: string;
  sharedAssetId: string;
  globalTemplateId: string;
  selectedTenantTemplateId: string; // visible to Tenant A only
}

export interface TwoTenantFixture {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
  platform: PlatformFixture;
  // A screen credential that no longer validates — same shape as a real revoked/unpaired
  // device, for the "revoked player reuses old credential" matrix row.
  revokedScreenToken: string;
  cleanup: () => Promise<void>;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(prisma: PrismaClient, jwt: JwtService, orgId: string, role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER', isSuperAdmin = false) {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${uniqueSuffix()}@fixture.test`,
      passwordHash: 'not-a-real-hash',
      name: `${role} Fixture User`,
      role,
      isSuperAdmin,
      organizationId: orgId,
    },
  });
  const token = jwt.sign({ sub: user.id, orgId, role: user.role, isSuperAdmin: user.isSuperAdmin, authVersion: user.authVersion });
  return { id: user.id, token };
}

async function buildTenant(prisma: PrismaClient, jwt: JwtService, label: string): Promise<TenantFixture> {
  const slug = `fixture-${label.toLowerCase()}-${uniqueSuffix()}`;
  const org = await prisma.organization.create({ data: { name: `Fixture ${label}`, slug } });

  const [owner, admin, editor, viewer] = await Promise.all([
    createUser(prisma, jwt, org.id, 'OWNER'),
    createUser(prisma, jwt, org.id, 'ADMIN'),
    createUser(prisma, jwt, org.id, 'EDITOR'),
    createUser(prisma, jwt, org.id, 'VIEWER'),
  ]);

  const asset = await prisma.asset.create({
    data: {
      organizationId: org.id,
      name: `${label} Asset`,
      type: 'IMAGE',
      mimeType: 'image/png',
      storageKey: `fixture/${org.id}/asset.png`,
      sizeBytes: 1024,
      status: 'READY', // default is PROCESSING — a fixture asset should behave like a normal, usable one
    },
  });

  const playlist = await prisma.playlist.create({ data: { organizationId: org.id, name: `${label} Playlist` } });

  const building = await prisma.building.create({ data: { organizationId: org.id, name: `${label} Building` } });

  const room = await prisma.bookableRoom.create({
    data: {
      organizationId: org.id,
      name: `${label} Room`,
      normalizedName: `${label.toLowerCase()} room`,
      timezone: 'UTC',
    },
  });

  const designAsset = await prisma.designAsset.create({
    data: {
      organizationId: org.id,
      name: `${label} Design`,
      designJson: { id: randomUUID(), name: `${label} Design`, schemaVersion: 1, scenes: [] },
    },
  });

  // A real paired screen. The token can only be signed once the row (and its id) exists, then
  // written back as Screen.playerToken — PlayerJwtStrategy requires an exact match against the
  // row's *current* token, not just a valid signature (see its own comment on re-pair epochs).
  const screen = await prisma.screen.create({ data: { organizationId: org.id, name: `${label} Screen`, paired: true } });
  const screenToken = jwt.sign({ sub: screen.id, orgId: org.id, type: 'screen' });
  await prisma.screen.update({ where: { id: screen.id }, data: { playerToken: screenToken } });

  return {
    orgId: org.id,
    slug,
    owner,
    admin,
    editor,
    viewer,
    assetId: asset.id,
    playlistId: playlist.id,
    screenId: screen.id,
    screenToken,
    designAssetId: designAsset.id,
    buildingId: building.id,
    roomId: room.id,
  };
}

export async function buildTwoTenantFixture(prisma: PrismaClient, jwt: JwtService): Promise<TwoTenantFixture> {
  const [tenantA, tenantB] = await Promise.all([buildTenant(prisma, jwt, 'A'), buildTenant(prisma, jwt, 'B')]);

  // Platform: a third org whose owner is flagged isSuperAdmin — same convention as every real
  // Super Admin account (a platform-scoped flag orthogonal to their own org's role, per User's
  // schema comment), plus platform-shared content (organizationId: null) and both template
  // visibility modes the matrix names.
  const platformOrg = await prisma.organization.create({ data: { name: 'Fixture Platform', slug: `fixture-platform-${uniqueSuffix()}` } });
  const superAdmin = await createUser(prisma, jwt, platformOrg.id, 'OWNER', true);

  const sharedAsset = await prisma.asset.create({
    data: {
      organizationId: null,
      name: 'Shared Fixture Asset',
      type: 'IMAGE',
      mimeType: 'image/png',
      storageKey: `fixture/platform/shared-asset.png`,
      sizeBytes: 2048,
      status: 'READY',
    },
  });

  const templateDesignJson = { id: randomUUID(), name: 'Fixture Template', schemaVersion: 1, scenes: [{ id: randomUUID(), name: 'Scene 1', durationSecs: 10, background: { type: 'color', color: '#000000' }, elements: [] }] };

  const globalTemplate = await prisma.designTemplate.create({
    data: { name: 'Fixture Global Template', designJson: templateDesignJson, visibility: 'GLOBAL', status: 'DRAFT' },
  });
  const globalVersion = await prisma.designTemplateVersion.create({
    data: { templateId: globalTemplate.id, versionNumber: 1, designJson: templateDesignJson, schemaVersion: 1 },
  });
  await prisma.designTemplate.update({
    where: { id: globalTemplate.id },
    data: { status: 'PUBLISHED', publishedAt: new Date(), versionNumber: 1, publishedVersionId: globalVersion.id },
  });

  const selectedTemplate = await prisma.designTemplate.create({
    data: { name: 'Fixture Selected-Tenant Template', designJson: templateDesignJson, visibility: 'SELECTED_TENANTS', status: 'DRAFT' },
  });
  const selectedVersion = await prisma.designTemplateVersion.create({
    data: { templateId: selectedTemplate.id, versionNumber: 1, designJson: templateDesignJson, schemaVersion: 1 },
  });
  await prisma.designTemplate.update({
    where: { id: selectedTemplate.id },
    data: { status: 'PUBLISHED', publishedAt: new Date(), versionNumber: 1, publishedVersionId: selectedVersion.id },
  });
  await prisma.designTemplateTenant.create({ data: { templateId: selectedTemplate.id, tenantId: tenantA.orgId } });

  // A revoked credential: token signed for a screen that no longer exists (deleted) — same
  // observable effect as PlayerJwtStrategy's own check for an unpaired/deleted screen, without
  // needing a full unpair round-trip through the gateway.
  const revokedScreen = await prisma.screen.create({ data: { organizationId: tenantA.orgId, name: 'Revoked Fixture Screen', paired: true } });
  const revokedScreenToken = jwt.sign({ sub: revokedScreen.id, orgId: tenantA.orgId, type: 'screen' });
  await prisma.screen.delete({ where: { id: revokedScreen.id } });

  const platform: PlatformFixture = {
    superAdminOrgId: platformOrg.id,
    superAdminUserId: superAdmin.id,
    superAdminToken: superAdmin.token,
    sharedAssetId: sharedAsset.id,
    globalTemplateId: globalTemplate.id,
    selectedTenantTemplateId: selectedTemplate.id,
  };

  const orgIds = [tenantA.orgId, tenantB.orgId, platformOrg.id];
  // Platform content (organizationId: null, or owned by no org at all) doesn't cascade from any
  // Organization delete and must be cleaned up explicitly.
  const sharedAssetIds = [sharedAsset.id];
  const templateIds = [globalTemplate.id, selectedTemplate.id];

  return {
    tenantA,
    tenantB,
    platform,
    revokedScreenToken,
    cleanup: async () => {
      // Templates before orgs: DesignTemplateTenant rows reference tenantA.orgId, and while that
      // relation cascades fine from either side, deleting the template first keeps this in an
      // obviously-safe order rather than relying on cascade direction.
      await Promise.allSettled(templateIds.map((id) => prisma.designTemplate.delete({ where: { id } })));
      // Organization -> everything cascades (schema.prisma), so deleting the three orgs cleans
      // up every tenant-owned row created above.
      await Promise.allSettled(orgIds.map((id) => prisma.organization.delete({ where: { id } })));
      await Promise.allSettled(sharedAssetIds.map((id) => prisma.asset.delete({ where: { id } })));
    },
  };
}
