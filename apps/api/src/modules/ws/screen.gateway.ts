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
  | { type: 'deleted' };

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
        // Player connected — join its own room
        void client.join(`screen:${payload.sub}`);
        client.data = { screenId: payload.sub, role: 'player' };
        this.logger.log(`Player connected: ${payload.sub}`);
      } else if (payload.type === 'user' && payload.orgId) {
        // Dashboard connected — join org room for status updates
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

  // Player can ack a command
  @SubscribeMessage('ack')
  handleAck(@ConnectedSocket() client: AppSocket, @MessageBody() data: { type: string }) {
    this.logger.log(`Player ${client.data.screenId ?? 'unknown'} acked: ${data.type}`);
  }
}
