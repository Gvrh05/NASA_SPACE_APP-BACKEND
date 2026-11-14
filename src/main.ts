import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadBackendEnv } from './config/env';

async function bootstrap() {
  loadBackendEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
}
void bootstrap();
