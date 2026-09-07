import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

// main.ts installs this at module load, before bootstrap() runs, so every real request path
// picks it up automatically — this test bootstrap never imports main.ts (it replicates only the
// pipe/filter/versioning setup, not the process-level polyfill), so it has to be repeated here or
// every Screen-shaped response (cacheBytes/freeStorageBytes) 500s with "Do not know how to
// serialize a BigInt" the moment a real row with those columns comes back from Postgres.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function (this: bigint) {
  return this.toString();
};

// P9 (docs/tenant_isolation_and_platform_admin_plan.md) — boots the *real* Nest HTTP layer
// (every guard/interceptor/pipe main.ts registers, not a mocked Prisma delegate) against the
// real dev Postgres, for genuine end-to-end IDOR coverage. AppModule itself loads .env on import
// (see its own top-of-file dotenv call), so no separate env bootstrapping is needed here the way
// org.service.integration.spec.ts (which never imports AppModule) has to do by hand.
//
// Deliberately omits main.ts's WebSocket/Redis adapter and Swagger setup — irrelevant to plain
// HTTP requests and would add an external dependency (Redis reachability) this suite doesn't
// need. If a future P9 WebSocket-room-isolation suite needs a live gateway, give it its own
// bootstrap rather than growing this one — HTTP IDOR coverage shouldn't start requiring Redis.
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.init();
  return app;
}

// A second, independent Prisma connection for fixture setup/teardown — same adapter/connection
// string convention as org.service.integration.spec.ts, kept separate from the app's own
// PrismaService instance (app.get(PrismaService)) so fixture cleanup can run even if a test left
// the app's own connection in a bad state.
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

export function getAppPrisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}
