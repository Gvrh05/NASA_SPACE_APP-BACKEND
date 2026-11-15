import { configureHttp } from './security/configure-http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadBackendEnv } from './config/env';

async function bootstrap() {
  loadBackendEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureHttp(app);
  const origins = (
    process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    origin: origins,
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
}
void bootstrap();
