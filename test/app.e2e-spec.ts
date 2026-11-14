import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/api/ai/health (GET) informa si el modelo está configurado', () => {
    return request(app.getHttpServer())
      .get('/api/ai/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            configured: expect.any(Boolean),
            provider: expect.any(String),
            missing: expect.any(Array),
          }),
        );
      });
  });

  it('/api/ai/space (POST) rechaza un contexto inválido', () => {
    return request(app.getHttpServer())
      .post('/api/ai/space')
      .send({ textoPersona: 'hola' })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('invalid_request');
      });
  });

  afterEach(async () => {
    await app?.close();
  });
});
