import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AiService } from './ai.service';
import { SimulationService } from '../simulation/simulation.service';

describe('space access HTTP boundary', () => {
  let app: INestApplication<Server>;
  let directory: string;
  let sid: string;
  const old = process.env.SIMULATION_DATA_DIR;
  const complete = jest.fn(() =>
    Promise.resolve(
      JSON.stringify({
        respuesta: 'Draft',
        nivel: 'equipo',
        vistaPrevia: 'Not shared',
        humanReviewRequired: true,
      }),
    ),
  );
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'helios-access-'));
    process.env.SIMULATION_DATA_DIR = directory;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue(
        new AiService({
          provider: { name: 'mock', model: 'mock', complete },
          providerName: 'mock',
          model: 'mock',
          missing: [],
        }),
      )
      .compile();
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    if (old === undefined) delete process.env.SIMULATION_DATA_DIR;
    else process.env.SIMULATION_DATA_DIR = old;
  });
  beforeEach(() => {
    complete.mockClear();
    sid = randomUUID();
    app.get(SimulationService).initialize(sid, { scenarioId: 'baseline' });
  });
  const grant = () => ({
    crewId: 'elena-torres',
    pin: '1001',
    modelConsent: true,
    historyConsent: true,
    dataUse: { pulse: false, sleep: false, symptoms: false, mission: false },
  });
  const body = () => ({
    crewId: 'elena-torres',
    textoPersona: 'Fictional loneliness',
    selectedLevel: 'solo_yo',
    history: [],
  });
  it('rejects unauthorized requests before model calls', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/space')
      .send(body())
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/space/access')
      .set('X-Simulation-Id', sid)
      .send(grant())
      .expect(403);
    app.get(SimulationService).action(sid, randomUUID(), 0, {
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    await request(app.getHttpServer())
      .post('/api/space/access')
      .set('X-Simulation-Id', sid)
      .send({ ...grant(), modelConsent: false })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/space/access')
      .set('X-Simulation-Id', sid)
      .send({ ...grant(), pin: '9999' })
      .expect(403);
    expect(complete).not.toHaveBeenCalled();
  });
  it('issues a bound temporary token, preserves privacy and revokes access', async () => {
    app.get(SimulationService).action(sid, randomUUID(), 0, {
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    const response = await request(app.getHttpServer())
      .post('/api/space/access')
      .set('X-Simulation-Id', sid)
      .send(grant())
      .expect(201);
    const token = (response.body as { token: string }).token;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const before = app.get(SimulationService).get(sid);
    const answer = await request(app.getHttpServer())
      .post('/api/ai/space')
      .set('X-Simulation-Id', sid)
      .set('X-Space-Token', token)
      .send(body())
      .expect(201);
    expect((answer.body as { result: { nivel: string } }).result.nivel).toBe(
      'solo_yo',
    );
    expect(app.get(SimulationService).get(sid)).toEqual(before);
    await request(app.getHttpServer())
      .delete('/api/space/access')
      .set('X-Simulation-Id', sid)
      .set('X-Space-Token', token)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/ai/space')
      .set('X-Simulation-Id', sid)
      .set('X-Space-Token', token)
      .send(body())
      .expect(401);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
