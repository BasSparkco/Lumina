import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import type { PrismaClient } from '@lumina/db';
import { createTestPrisma } from '../utils/test-app';
import { createWsTestApp } from '../utils/ws-test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';
import { ScreenGateway } from '../../src/modules/ws/screen.gateway';
import { AuthErrorCode } from '../../src/common/auth-error-codes';

function connect(url: string, token: string): Socket {
  return io(url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
}

function waitFor<T = unknown>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function neverReceives(socket: Socket, event: string, withinMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => {
      clearTimeout(timer);
      reject(new Error(`unexpectedly received "${event}"`));
    };
    socket.once(event, handler);
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, withinMs);
  });
}

// P9 required suite #4 (docs/tenant_isolation_and_platform_admin_plan.md, "WebSocket
// room-isolation tests") — ScreenGateway (src/modules/ws/screen.gateway.ts) puts every dashboard
// connection in an `org:${orgId}` room and every player connection in a `screen:${screenId}`
// room, both keyed off a live DB lookup rather than trusting the JWT payload's own claims. This
// suite proves that room membership actually contains cross-tenant broadcasts, and that the same
// live-revocation checks P2's HTTP suite covers (tenant-isolation.e2e-spec.ts) also apply on the
// WebSocket connect path, not just REST.
describe('WebSocket room isolation', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaClient;
  let fixture: TwoTenantFixture;
  let gateway: ScreenGateway;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ({ app, url } = await createWsTestApp());
    prisma = createTestPrisma();
    fixture = await buildTwoTenantFixture(prisma, app.get(JwtService));
    gateway = app.get(ScreenGateway);
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await fixture.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  async function connectAndTrack(token: string): Promise<Socket> {
    const socket = connect(url, token);
    sockets.push(socket);
    await waitFor(socket, 'connect');
    // The client's 'connect' event fires on handshake ack — it does not wait for
    // handleConnection's own async DB lookup and room join to finish server-side, so a broadcast
    // sent immediately after this resolves can race the join. Give it a moment to settle; this is
    // a test-timing accommodation, not a product behavior under test.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return socket;
  }

  it("a broadcast to Tenant A's org room never reaches Tenant B's dashboard socket", async () => {
    const dashA = await connectAndTrack(fixture.tenantA.owner.token);
    const dashB = await connectAndTrack(fixture.tenantB.owner.token);

    const received = waitFor<{ screenId: string; status: string }>(dashA, 'screen-status');
    const neverGets = neverReceives(dashB, 'screen-status');
    gateway.sendStatusToOrg(fixture.tenantA.orgId, fixture.tenantA.screenId, 'ONLINE');

    const payload = await received;
    expect(payload.screenId).toBe(fixture.tenantA.screenId);
    await neverGets;
  });

  it("a command sent to Tenant A's screen room never reaches Tenant B's paired player socket", async () => {
    const playerA = await connectAndTrack(fixture.tenantA.screenToken);
    const playerB = await connectAndTrack(fixture.tenantB.screenToken);

    const received = waitFor<{ type: string }>(playerA, 'command');
    const neverGets = neverReceives(playerB, 'command');
    gateway.sendToScreen(fixture.tenantA.screenId, { type: 'reload' });

    const payload = await received;
    expect(payload.type).toBe('reload');
    await neverGets;
  });

  it('a screen socket presenting a revoked/stale player token is rejected, not joined to any room', async () => {
    const socket = connect(url, fixture.revokedScreenToken);
    sockets.push(socket);

    // Registered together, before either can fire — reject() emits 'auth-invalidated' and calls
    // disconnect(true) back-to-back, so listening for 'disconnect' only after the first await
    // resolves can miss it if the socket already closed by then.
    const invalidatedPromise = waitFor<{ code: AuthErrorCode }>(socket, 'auth-invalidated');
    const disconnectPromise = waitFor(socket, 'disconnect');
    const invalidated = await invalidatedPromise;
    expect(invalidated.code).toBe(AuthErrorCode.SCREEN_NOT_PAIRED);
    await disconnectPromise;
  });

  it("a dashboard socket whose session was revoked (authVersion bumped) after token issue is rejected on connect", async () => {
    const throwaway = await prisma.user.create({
      data: {
        email: `ws-throwaway-${Date.now()}@fixture.test`,
        passwordHash: 'x',
        name: 'WS Throwaway',
        role: 'VIEWER',
        organizationId: fixture.tenantA.orgId,
      },
    });
    const token = app.get(JwtService).sign({
      sub: throwaway.id,
      orgId: fixture.tenantA.orgId,
      role: 'VIEWER',
      isSuperAdmin: false,
      authVersion: throwaway.authVersion,
    });
    await prisma.user.update({ where: { id: throwaway.id }, data: { authVersion: { increment: 1 } } });

    const socket = connect(url, token);
    sockets.push(socket);
    const invalidated = await waitFor<{ code: AuthErrorCode }>(socket, 'auth-invalidated');
    expect(invalidated.code).toBe(AuthErrorCode.AUTH_VERSION_MISMATCH);

    await prisma.user.delete({ where: { id: throwaway.id } });
  });

  it("disconnectOrg only kicks the target org's dashboard sockets, leaving the other tenant connected", async () => {
    const dashA = await connectAndTrack(fixture.tenantA.owner.token);
    const dashB = await connectAndTrack(fixture.tenantB.owner.token);

    const aInvalidated = waitFor<{ code: AuthErrorCode }>(dashA, 'auth-invalidated');
    const bStaysUp = neverReceives(dashB, 'auth-invalidated', 750);

    await gateway.disconnectOrg(fixture.tenantA.orgId);

    const payload = await aInvalidated;
    expect(payload.code).toBe(AuthErrorCode.ORG_SUSPENDED);
    await bStaysUp;
    expect(dashB.connected).toBe(true);
  });
});
