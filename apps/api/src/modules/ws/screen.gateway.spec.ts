import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { ScreenGateway } from './screen.gateway';
import { AuthErrorCode } from '../../common/auth-error-codes';
import type { PrismaService } from '../../prisma/prisma.service';

function makeSocket(auth: { token?: string } = {}) {
  return {
    id: 'socket_1',
    handshake: { auth, headers: {} },
    join: jest.fn(),
    disconnect: jest.fn(),
    data: {} as Record<string, unknown>,
  } as unknown as Parameters<ScreenGateway['handleConnection']>[0];
}

function makeGateway(opts: {
  verify?: jest.Mock;
  prismaOverrides?: Record<string, unknown>;
}) {
  const emit = jest.fn();
  const server = { to: jest.fn().mockReturnValue({ emit }), in: jest.fn() };
  const jwt = { verify: opts.verify ?? jest.fn(), sign: jest.fn() } as unknown as JwtService;
  const config = {} as unknown as ConfigService;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    screen: { findUnique: jest.fn().mockResolvedValue(null) },
    ...opts.prismaOverrides,
  } as unknown as PrismaService;
  const gateway = new ScreenGateway(jwt, config, prisma);
  (gateway as unknown as { server: unknown }).server = server;
  return { gateway, server, emit, prisma };
}

// P2 (docs/tenant_isolation_and_platform_admin_plan.md task 2/5/6) — handleConnection must do a
// live database check before letting either a dashboard user or a player join a room, not just
// verify the JWT signature. These tests pin that every rejection path both emits
// 'auth-invalidated' (the WS equivalent of a REST 401 body, since there's no HTTP response for
// useScreenSocket to inspect) and actually disconnects, and that a live success join uses the
// database's current values, never the JWT payload's own copies.
describe('ScreenGateway.handleConnection', () => {
  describe('dashboard connections', () => {
    it('rejects with USER_NOT_FOUND when the user row no longer exists', async () => {
      const { gateway, server, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', authVersion: 1 }),
        prismaOverrides: { user: { findUnique: jest.fn().mockResolvedValue(null) } },
      });
      const client = makeSocket({ token: 'dashboard.token' });

      await gateway.handleConnection(client);

      expect(server.to).toHaveBeenCalledWith('socket_1');
      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.USER_NOT_FOUND });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_VERSION_MISMATCH when the JWT authVersion is stale', async () => {
      const { gateway, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', authVersion: 1 }),
        prismaOverrides: {
          user: {
            findUnique: jest.fn().mockResolvedValue({ organizationId: 'org_1', authVersion: 2, organization: { status: 'ACTIVE' } }),
          },
        },
      });
      const client = makeSocket({ token: 'dashboard.token' });

      await gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.AUTH_VERSION_MISMATCH });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects with ORG_SUSPENDED when the live organization is suspended', async () => {
      const { gateway, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', authVersion: 1 }),
        prismaOverrides: {
          user: {
            findUnique: jest.fn().mockResolvedValue({ organizationId: 'org_1', authVersion: 1, organization: { status: 'SUSPENDED' } }),
          },
        },
      });
      const client = makeSocket({ token: 'dashboard.token' });

      await gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.ORG_SUSPENDED });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('joins the live organizationId room and records userId for a valid, active, current session', async () => {
      const { gateway, prisma } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', authVersion: 1 }),
        prismaOverrides: {
          user: {
            findUnique: jest.fn().mockResolvedValue({ organizationId: 'org_1', authVersion: 1, organization: { status: 'ACTIVE' } }),
          },
        },
      });
      const client = makeSocket({ token: 'dashboard.token' });

      await gateway.handleConnection(client);

      expect((prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        select: { organizationId: true, authVersion: true, organization: { select: { status: true } } },
      });
      expect(client.join).toHaveBeenCalledWith('org:org_1');
      expect(client.data).toEqual({ orgId: 'org_1', role: 'dashboard', userId: 'user_1' });
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('player/screen connections', () => {
    it('rejects when the screen no longer exists', async () => {
      const { gateway, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'screen_1', orgId: 'org_1', type: 'screen' }),
        prismaOverrides: { screen: { findUnique: jest.fn().mockResolvedValue(null) } },
      });
      const client = makeSocket({ token: 'player.token' });

      await gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.SCREEN_NOT_PAIRED });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects when the screen is unpaired', async () => {
      const { gateway, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'screen_1', orgId: 'org_1', type: 'screen' }),
        prismaOverrides: {
          screen: { findUnique: jest.fn().mockResolvedValue({ paired: false, playerToken: null, organizationId: 'org_1' }) },
        },
      });
      const client = makeSocket({ token: 'player.token' });

      await gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.SCREEN_NOT_PAIRED });
    });

    it('rejects a stale token from a previous pairing epoch even though the screen is currently paired', async () => {
      const { gateway, emit } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'screen_1', orgId: 'org_1', type: 'screen' }),
        prismaOverrides: {
          screen: { findUnique: jest.fn().mockResolvedValue({ paired: true, playerToken: 'current.token', organizationId: 'org_1' }) },
        },
      });
      const client = makeSocket({ token: 'stale.token' });

      await gateway.handleConnection(client);

      expect(emit).toHaveBeenCalledWith('auth-invalidated', { code: AuthErrorCode.SCREEN_NOT_PAIRED });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins the screen room using the screen\'s live organizationId when the token matches', async () => {
      const { gateway } = makeGateway({
        verify: jest.fn().mockReturnValue({ sub: 'screen_1', orgId: 'stale_org_in_jwt', type: 'screen' }),
        prismaOverrides: {
          screen: { findUnique: jest.fn().mockResolvedValue({ paired: true, playerToken: 'current.token', organizationId: 'live_org' }) },
        },
      });
      const client = makeSocket({ token: 'current.token' });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('screen:screen_1');
      expect(client.data).toEqual({ screenId: 'screen_1', orgId: 'live_org', role: 'player' });
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  it('disconnects with no live check at all when the JWT fails to verify', async () => {
    const { gateway, prisma } = makeGateway({
      verify: jest.fn().mockImplementation(() => {
        throw new Error('bad signature');
      }),
    });
    const client = makeSocket({ token: 'garbage' });

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalled();
    expect((prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique).not.toHaveBeenCalled();
  });
});

describe('ScreenGateway.disconnectUser / disconnectOrg', () => {
  it('disconnectUser only kicks the matching userId, never other sockets in the same org room', async () => {
    const { gateway, server } = makeGateway({});
    const matching = { data: { userId: 'user_1' }, emit: jest.fn(), disconnect: jest.fn() };
    const other = { data: { userId: 'user_2' }, emit: jest.fn(), disconnect: jest.fn() };
    server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([matching, other]) });

    await gateway.disconnectUser('org_1', 'user_1');

    expect(server.in).toHaveBeenCalledWith('org:org_1');
    expect(matching.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
  });

  it('disconnectOrg kicks every socket in the org room', async () => {
    const { gateway, server } = makeGateway({});
    const a = { data: { userId: 'user_1' }, emit: jest.fn(), disconnect: jest.fn() };
    const b = { data: { userId: 'user_2' }, emit: jest.fn(), disconnect: jest.fn() };
    server.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([a, b]) });

    await gateway.disconnectOrg('org_1');

    expect(server.in).toHaveBeenCalledWith('org:org_1');
    expect(a.disconnect).toHaveBeenCalledWith(true);
    expect(b.disconnect).toHaveBeenCalledWith(true);
  });
});
