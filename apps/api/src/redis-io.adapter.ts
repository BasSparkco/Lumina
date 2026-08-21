import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplication } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  // ScreenGateway's own @WebSocketGateway({ cors: { origin: '*' } }) decorator is a static object
  // evaluated at module-import time — before main.ts has even computed the real allowlist, let
  // alone passed it here — so it can never be made to agree with the HTTP CORS config that way.
  // Overriding cors here instead, at server-creation time (well after that's all settled), is
  // what actually keeps the two in sync rather than just hoping the decorator's literal matches.
  constructor(
    private readonly app: INestApplication,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  async connectToRedis(url: string) {
    const pub = new Redis(url, { lazyConnect: true });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.allowedOrigins, credentials: true },
    }) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
