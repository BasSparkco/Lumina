import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';

function makeService(overrides: { prismaOverrides?: Record<string, unknown> } = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({
        organization: { create: jest.fn().mockResolvedValue({ id: 'org_1' }) },
        user: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 'user_1', organizationId: 'org_1', role: 'OWNER', name: 'x', email: 'x@example.com' }),
        },
      }),
    ),
    ...overrides.prismaOverrides,
  } as unknown as PrismaService;
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;

  return { service: new AuthService(prisma, jwt), prisma };
}

// Regression coverage for the ADR's "the production business flow is Super-Admin-provisioned
// tenants" decision — public self-registration cannot bypass that once disabled. Also covers a
// real bug this feature hit: ConfigService.get() can return the raw, untransformed env string
// here (see AuthService's own comment), so the flag is deliberately read straight from
// process.env, not through ConfigService — these tests exercise the real process.env path.
describe('AuthService.register — ALLOW_SELF_REGISTRATION gate', () => {
  const originalEnv = process.env.ALLOW_SELF_REGISTRATION;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ALLOW_SELF_REGISTRATION;
    else process.env.ALLOW_SELF_REGISTRATION = originalEnv;
  });

  it('rejects registration outright when the flag is disabled, creating no records', async () => {
    process.env.ALLOW_SELF_REGISTRATION = 'false';
    const { service, prisma } = makeService();

    await expect(
      service.register({ orgName: 'Acme', email: 'a@example.com', password: 'password123', name: 'A' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects registration when the flag is unset entirely — defaults closed', async () => {
    delete process.env.ALLOW_SELF_REGISTRATION;
    const { service, prisma } = makeService();

    await expect(
      service.register({ orgName: 'Acme', email: 'a@example.com', password: 'password123', name: 'A' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('proceeds normally when the flag is the literal string "true"', async () => {
    process.env.ALLOW_SELF_REGISTRATION = 'true';
    const { service } = makeService();

    const result = await service.register({
      orgName: 'Acme',
      email: 'a@example.com',
      password: 'password123',
      name: 'A',
    });

    expect(result.token).toBe('signed.jwt.token');
  });

  it('rejects a duplicate email even when self-registration is enabled', async () => {
    process.env.ALLOW_SELF_REGISTRATION = 'true';
    const { service } = makeService({
      prismaOverrides: { user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) } },
    });

    await expect(
      service.register({ orgName: 'Acme', email: 'a@example.com', password: 'password123', name: 'A' }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates the organization and owner user inside a single transaction, not two sequential writes', async () => {
    process.env.ALLOW_SELF_REGISTRATION = 'true';
    const { service, prisma } = makeService();

    await service.register({ orgName: 'Acme', email: 'a@example.com', password: 'password123', name: 'A' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.login — suspended-organization rejection', () => {
  it('rejects login for a user whose organization is currently SUSPENDED, even with correct credentials', async () => {
    const passwordHash = await hash('password123', 4); // low cost factor — this is a test fixture, not a real secret
    const { service } = makeService({
      prismaOverrides: {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user_1',
            organizationId: 'org_1',
            role: 'OWNER',
            name: 'A',
            email: 'a@example.com',
            isSuperAdmin: false,
            passwordHash,
            organization: { status: 'SUSPENDED' },
          }),
        },
      },
    });

    await expect(service.login({ email: 'a@example.com', password: 'password123' })).rejects.toThrow(
      new UnauthorizedException('This organization has been suspended'),
    );
  });

  it('rejects invalid credentials before ever checking organization status', async () => {
    const passwordHash = await hash('the-real-password', 4);
    const { service, prisma } = makeService({
      prismaOverrides: {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user_1',
            organizationId: 'org_1',
            role: 'OWNER',
            name: 'A',
            email: 'a@example.com',
            isSuperAdmin: false,
            passwordHash,
            organization: { status: 'ACTIVE' },
          }),
        },
      },
    });

    await expect(service.login({ email: 'a@example.com', password: 'wrong-guess' })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@example.com' } }),
    );
  });
});
