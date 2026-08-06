import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis(process.env.REDIS_URL ?? 'redis://localhost:6381');
  app.useWebSocketAdapter(redisAdapter);

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  // Two distinct browser origins call this API directly: the dashboard and the player PWA
  // (physical screens, on its own subdomain). Both need to be whitelisted, or requests from
  // whichever one is missing get silently CORS-blocked in the browser.
  const allowedOrigins = [process.env.DASHBOARD_URL, process.env.PLAYER_URL].filter(
    (v): v is string => Boolean(v),
  );
  app.enableCors({ origin: allowedOrigins.length ? allowedOrigins : '*' });
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
