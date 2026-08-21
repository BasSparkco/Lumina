import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Two distinct browser origins call this API directly: the dashboard and the player PWA
  // (physical screens, on its own subdomain). Both need to be whitelisted, or requests from
  // whichever one is missing get silently CORS-blocked in the browser. An empty list here (both
  // env vars unset — a misconfigured deploy) fails *closed*: no origin is allowed, rather than
  // silently falling back to '*' and leaving every screen/dashboard origin unrestricted. Loud on
  // purpose — this should never happen in a real deploy, so if it does, it needs to be seen.
  const allowedOrigins = [process.env.DASHBOARD_URL, process.env.PLAYER_URL].filter(
    (v): v is string => Boolean(v),
  );
  if (allowedOrigins.length === 0) {
    NestLogger.warn(
      'DASHBOARD_URL and PLAYER_URL are both unset — CORS is failing closed (no browser origin will be allowed) instead of falling back to "*". Set at least one to restore access.',
      'Bootstrap',
    );
  }

  const redisAdapter = new RedisIoAdapter(app, allowedOrigins);
  await redisAdapter.connectToRedis(process.env.REDIS_URL ?? 'redis://localhost:6381');
  app.useWebSocketAdapter(redisAdapter);

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  // Default body limit (100kb) is too small for theme saves once a paint-layer raster (a
  // base64 PNG) rides along in the elements array — bump it for both bodies Nest parses.
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });
  app.enableCors({ origin: allowedOrigins });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Lumina API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 4000;
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}

void bootstrap();
