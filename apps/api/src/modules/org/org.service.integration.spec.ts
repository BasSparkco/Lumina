import path from 'node:path';
import crypto from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import { JwtService } from '@nestjs/jwt';
import { OrgService } from './org.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScreenGateway } from '../ws/screen.gateway';

// Jest doesn't load .env on its own the way main.ts's bootstrap does — mirror app.module.ts's
// own multi-path search so this passes whether jest was invoked from apps/api directly or via
// `turbo run test` from the repo root, without requiring every contributor to export
// DATABASE_URL by hand for one file. A real DATABASE_URL from the environment (e.g. CI's
// postgres service) always wins — `override` defaults to false.
loadDotenv({
  path: [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
  ],
  quiet: true,
});

// Exercises OrgService.acceptInvite against a REAL PostgreSQL connection rather than a mocked
// Prisma delegate (org.service.spec.ts) — the concurrency guarantee added in P1/P2 (an atomic
// conditional UPDATE claimed inside a transaction, so Postgres row-locks the invite and a losing
// concurrent request re-evaluates against the now-committed row) and the transaction-rollback
// guarantee (a failed user-create must not leave the invite falsely marked accepted) both depend
// on real Postgres transaction/locking semantics that a mocked `$transaction` callback cannot
// exercise — it just invokes the callback once, with no actual row locks or rollback on throw.
//
// Requires a reachable, already-migrated Postgres at DATABASE_URL (the same one `apps/api/.env`
// points local development at, and the one CI's `postgres` service is migrated against in
// .github/workflows/ci.yml before the Test step) — this is not skipped/mocked when unreachable.
describe('OrgService.acceptInvite — real Postgres', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const gateway = { disconnectUser: jest.fn(), disconnectOrg: jest.fn() } as unknown as ScreenGateway;
  const service = new OrgService(
    prisma as unknown as PrismaService,
    new JwtService({ secret: 'integration-test-secret' }),
    new OrgScopedService(),
    gateway,
  );

  let orgId: string;
  const cleanupOrgIds: string[] = [];

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Race Co', slug: `race-co-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    orgId = org.id;
    cleanupOrgIds.push(orgId);
  });

  afterEach(async () => {
    // Organization -> User/OrgInvite cascade on delete (schema.prisma), so this alone cleans up
    // everything created within a test.
    await Promise.all(cleanupOrgIds.splice(0).map(id => prisma.organization.delete({ where: { id } }).catch(() => undefined)));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets exactly one of two concurrent accepts of the same token succeed, and creates exactly one user', async () => {
    const invite = await prisma.orgInvite.create({
      data: {
        email: `race-${Date.now()}@example.com`,
        role: 'EDITOR',
        organizationId: orgId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const outcomes = await Promise.allSettled([
      service.acceptInvite(invite.token, 'Racer A', 'password123'),
      service.acceptInvite(invite.token, 'Racer B', 'password123'),
    ]);

    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);

    const users = await prisma.user.findMany({ where: { organizationId: orgId } });
    expect(users).toHaveLength(1);

    const refreshedInvite = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(refreshedInvite.acceptedAt).not.toBeNull();
  });

  it('rolls back the invite claim when user creation fails, so the invite is not left falsely accepted', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Co', slug: `other-co-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    cleanupOrgIds.push(otherOrg.id);
    await prisma.user.create({
      data: { email, passwordHash: 'x', name: 'Existing', role: 'EDITOR', organizationId: otherOrg.id },
    });

    const invite = await prisma.orgInvite.create({
      data: { email, role: 'EDITOR', organizationId: orgId, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });

    await expect(service.acceptInvite(invite.token, 'New Name', 'password123')).rejects.toThrow('Email already in use');

    const refreshedInvite = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(refreshedInvite.acceptedAt).toBeNull();

    const usersInTargetOrg = await prisma.user.findMany({ where: { organizationId: orgId } });
    expect(usersInTargetOrg).toHaveLength(0);
  });
});
