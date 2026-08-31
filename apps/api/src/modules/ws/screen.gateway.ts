import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';

export type PlayerCommand =
  | { type: 'publish' }
  | { type: 'reload' }
  | { type: 'clear-cache' }
  | { type: 'capture-screenshot' }
  | { type: 'unpair'; pairingCode: string }
  | { type: 'deleted' }
  // Custom Player (appsroadmap.md Phase 9) — remote control of whatever video is currently
  // playing. The player decides whether the active content is controllable (see Phase 10); a
  // command arriving with nothing controllable on screen is just a no-op.
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'seek'; toSeconds: number }
  | { type: 'setSpeed'; rate: number };

// Emitted by the player (not the dashboard) roughly once a second while a controllable video is
// playing, so the dashboard's Custom Player panel can show a live, scrubbable position without
// polling.
export interface PlaybackProgress {
  screenId: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  rate: number;
}

interface ScreenSocketData {
  screenId?: string;
  orgId?: string;
  role?: 'player' | 'dashboard';
}

type AppSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, ScreenSocketData>;

// cors is deliberately omitted here — this decorator's options are evaluated at module-import
// time, before main.ts has computed the real DASHBOARD_URL/PLAYER_URL allowlist, so a static
// value here can only ever be wrong or stale. RedisIoAdapter.createIOServer overrides cors with
// that allowlist at actual server-creation time instead; see its comment for why.
@WebSocketGateway({
  transports: ['websocket', 'polling'],
})
export class ScreenGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ScreenGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: AppSocket) {
    const token =
      (client.handshake.auth.token as string | undefined) ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwt.verify<{ sub: string; type: string; orgId?: string }>(token);

      if (payload.type === 'screen') {
        // Player connected — join its own room. orgId is stored too (not just screenId) so
        // handlePlaybackProgress below can forward to the right dashboard org room without an
        // extra DB lookup on every ~1s tick.
        void client.join(`screen:${payload.sub}`);
        client.data = { screenId: payload.sub, orgId: payload.orgId, role: 'player' };
        this.logger.log(`Player connected: ${payload.sub}`);
      } else if (payload.type !== 'screen' && payload.orgId) {
        // Dashboard connected — join org room for status updates. The real dashboard access
        // token (AuthService.sign) never actually carries a `type` field — only screen tokens
        // do (see JwtStrategy, which rejects `type === 'screen'` on REST routes the same way) —
        // so "not a screen token" is the correct user check, not an equality match on 'user'
        // (which no token ever sets; that check silently dropped every dashboard connection).
        void client.join(`org:${payload.orgId}`);
        client.data = { orgId: payload.orgId, role: 'dashboard' };
        this.logger.log(`Dashboard connected: org ${payload.orgId}`);
      } else {
        client.disconnect();
      }
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AppSocket) {
    if (client.data.screenId) {
      this.logger.log(`Player disconnected: ${client.data.screenId}`);
    }
  }

  // Push a command to a specific screen
  sendToScreen(screenId: string, cmd: PlayerCommand) {
    this.server.to(`screen:${screenId}`).emit('command', cmd);
  }

  // Push a status update to all dashboard clients in an org
  sendStatusToOrg(orgId: string, screenId: string, status: 'ONLINE' | 'OFFLINE') {
    this.server.to(`org:${orgId}`).emit('screen-status', { screenId, status });
  }

  // Push a live "this screen just left the paired fleet" nudge to every dashboard client in the
  // org — not just the tab that clicked Unpair (a second admin's open Screens tab otherwise only
  // finds out on its next manual refresh), and the *only* signal at all when the unpair was
  // initiated from the device itself, since that path has no dashboard mutation to invalidate off.
  sendUnpairedToOrg(orgId: string, screenId: string) {
    this.server.to(`org:${orgId}`).emit('screen-unpaired', { screenId });
  }

  // Player can ack a command
  @SubscribeMessage('ack')
  handleAck(@ConnectedSocket() client: AppSocket, @MessageBody() data: { type: string }) {
    this.logger.log(`Player ${client.data.screenId ?? 'unknown'} acked: ${data.type}`);
  }

  // Player reports its current playback position — forwarded as-is to every dashboard client
  // watching this org (the same room screen-status already uses), so a Custom Player panel can
  // track it live. Only ever sent by a 'player'-role socket; a dashboard client has no orgId-less
  // screenId to report progress for, so client.data.screenId being unset here is impossible in
  // practice, but the guard keeps a malformed/rogue emit from broadcasting under someone else's org.
  @SubscribeMessage('playback-progress')
  handlePlaybackProgress(@ConnectedSocket() client: AppSocket, @MessageBody() data: Omit<PlaybackProgress, 'screenId'>) {
    if (!client.data.screenId || !client.data.orgId) return;
    this.server.to(`org:${client.data.orgId}`).emit('playback-progress', { screenId: client.data.screenId, ...data });
  }
}
