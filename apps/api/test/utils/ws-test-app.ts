import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module';

declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function (this: bigint) {
  return this.toString();
};

// P9 WebSocket room-isolation suite — a separate bootstrap from test-app.ts's createTestApp() on
// purpose (see that file's own comment): this one actually listens on a real ephemeral TCP port
// (app.listen(0)) so socket.io-client can open a genuine transport, which HTTP-only supertest
// coverage never needs. Deliberately still skips main.ts's RedisIoAdapter — that adapter only
// matters for pub/sub fan-out across multiple Node processes; ScreenGateway's own room-membership
// logic (the thing under test here) runs identically on Nest's default single-process Socket.IO
// adapter, and skipping it keeps this suite from depending on Redis reachability.
export async function createWsTestApp(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const httpServer = app.getHttpServer() as Server;
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, url: `http://127.0.0.1:${port}` };
}
