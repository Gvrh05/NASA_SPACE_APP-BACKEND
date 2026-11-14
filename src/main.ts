import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadBackendEnv } from './config/env';

async function bootstrap() {
  loadBackendEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '10mb' });
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173'
    )
      .split(',')
      .map((value) => value.trim()),
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
}
void bootstrap();
