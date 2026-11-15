import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppModule } from '../app.module';
import { AI_RUNTIME } from '../ai/ai.service';
import { createInitialState } from '../simulation/domain/scenarios';
import { signedPacket } from '../simulation/domain/messages';
import { stateSchema } from '../simulation/contracts';
import type { AppState } from '../simulation/shared/types';

const snapshotSchema = z.object({
  state: stateSchema,
  revision: z.number().int(),
  simulated: z.literal(true),
});

describe('API de monitoreo', () => {
  let app: INestApplication<Server>;
  let directory: string;
  let sid: string;
  let state: AppState;
  let revision: number;
  const previousDirectory = process.env.SIMULATION_DATA_DIR;

  beforeAll(async () => {
    directory = mkdtempSync(resolve(tmpdir(), 'helios-monitoring-'));
    process.env.SIMULATION_DATA_DIR = directory;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_RUNTIME)
      .useValue({
        provider: null,
        providerName: 'test',
        model: 'test',
        missing: ['AI_API_KEY'],
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (previousDirectory === undefined) delete process.env.SIMULATION_DATA_DIR;
    else process.env.SIMULATION_DATA_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sid = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/simulation')
      .set('X-Simulation-Id', sid)
      .send({ scenarioId: 'baseline' })
      .expect(201);
    const snapshot = snapshotSchema.parse(response.body);
    state = snapshot.state;
    revision = snapshot.revision;
  });

  async function action(input: unknown, expected = 201) {
    const response = await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send({
        requestId: randomUUID(),
        expectedRevision: revision,
        action: input,
      })
      .expect(expected);
    if (expected === 201) {
      const snapshot = snapshotSchema.parse(response.body);
      state = snapshot.state;
      revision = snapshot.revision;
    }
    return response;
  }

  function packet(overrides: Record<string, unknown> = {}) {
    return signedPacket({
      messageId: randomUUID(),
      sequence: state.lastInboundSequence + 1,
      crewId: 'elena-torres',
      sensorId: 'test-sensor',
      kind: 'heart_rate',
      value: 110,
      measuredAt: state.clock.simulatedAt,
      receivedAt: state.clock.simulatedAt,
      signalQuality: 95,
      context: 'routine',
      ...overrides,
    });
  }

  async function ingest(input: unknown, expected = 201) {
    const response = await request(app.getHttpServer())
      .post('/api/monitoring/measurements')
      .set('X-Simulation-Id', sid)
      .send({
        simulated: true,
        requestId: randomUUID(),
        expectedRevision: revision,
        packet: input,
      })
      .expect(expected);
    if (expected === 201) {
      const snapshot = snapshotSchema.parse(response.body);
      state = snapshot.state;
      revision = snapshot.revision;
    }
    return response;
  }

  it('pagina y filtra el historial sin perder el total', async () => {
    const first = await request(app.getHttpServer())
      .get(
        '/api/monitoring/measurements?crewId=elena-torres&kind=heart_rate&limit=3',
      )
      .set('X-Simulation-Id', sid)
      .expect(200);
    const page = first.body as {
      total: number;
      limit: number;
      offset: number;
      measurements: { id: string }[];
    };
    expect(page.total).toBeGreaterThan(3);
    expect(page.limit).toBe(3);
    expect(page.offset).toBe(0);
    expect(page.measurements).toHaveLength(3);

    const second = await request(app.getHttpServer())
      .get(
        '/api/monitoring/measurements?crewId=elena-torres&kind=heart_rate&limit=3&offset=3',
      )
      .set('X-Simulation-Id', sid)
      .expect(200);
    const next = second.body as { measurements: { id: string }[] };
    expect(next.measurements).toHaveLength(3);
    expect(next.measurements[0].id).not.toBe(page.measurements[0].id);

    const valid = await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=elena-torres&integrity=valid')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect(
      (
        valid.body as { measurements: { integrity: string }[] }
      ).measurements.every((item) => item.integrity === 'valid'),
    ).toBe(true);

    const empty = await request(app.getHttpServer())
      .get(
        '/api/monitoring/measurements?crewId=elena-torres&from=9999999999999',
      )
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect((empty.body as { total: number }).total).toBe(0);
  });

  it('rechaza intervalos y límites inválidos', async () => {
    await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=elena-torres&from=20&to=10')
      .set('X-Simulation-Id', sid)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=elena-torres&limit=0')
      .set('X-Simulation-Id', sid)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=desconocido')
      .set('X-Simulation-Id', sid)
      .expect(400);
  });

  it('resume las cinco magnitudes con su comparación', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/monitoring/summary?crewId=elena-torres')
      .set('X-Simulation-Id', sid)
      .expect(200);
    const body = response.body as {
      crewId: string;
      humanReviewRequired: boolean;
      kinds: {
        kind: string;
        measurement: { kind: string; value: number } | null;
        comparison: { max: number } | null;
      }[];
    };
    expect(body.crewId).toBe('elena-torres');
    expect(body.humanReviewRequired).toBe(true);
    expect(body.kinds).toHaveLength(5);
    const heart = body.kinds.find((item) => item.kind === 'heart_rate');
    expect(heart?.measurement).not.toBeNull();
    expect(heart?.comparison?.max).toBe(76);
  });

  it('resume sin evidencia confiable cuando falta el dato', async () => {
    await action({ type: 'setScenario', scenarioId: 'missing-data' });
    const response = await request(app.getHttpServer())
      .get('/api/monitoring/summary?crewId=elena-torres')
      .set('X-Simulation-Id', sid)
      .expect(200);
    const heart = (
      response.body as {
        kinds: {
          kind: string;
          measurement: unknown;
          comparison: unknown;
        }[];
      }
    ).kinds.find((item) => item.kind === 'heart_rate');
    expect(heart?.measurement).toBeNull();
    expect(heart?.comparison).toBeNull();
  });

  it('limita la lectura del rol astronauta a su propio tripulante', async () => {
    await action({
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    for (const path of [
      '/api/monitoring/measurements?crewId=mateo-ruiz',
      '/api/monitoring/latest?crewId=mateo-ruiz&kind=heart_rate',
      '/api/monitoring/summary?crewId=mateo-ruiz',
      '/api/monitoring/rejections?crewId=mateo-ruiz',
      '/api/monitoring/rejections',
    ])
      await request(app.getHttpServer())
        .get(path)
        .set('X-Simulation-Id', sid)
        .expect(403);
    await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=elena-torres')
      .set('X-Simulation-Id', sid)
      .expect(200);
  });

  it('permite al equipo médico leer a cualquier tripulante', async () => {
    await request(app.getHttpServer())
      .get('/api/monitoring/measurements?crewId=mateo-ruiz')
      .set('X-Simulation-Id', sid)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/monitoring/latest?crewId=mateo-ruiz&kind=heart_rate')
      .set('X-Simulation-Id', sid)
      .expect(200);
  });

  it('ingiere un paquete válido y lo expone en latest', async () => {
    await ingest(packet());
    const response = await request(app.getHttpServer())
      .get('/api/monitoring/latest?crewId=elena-torres&kind=heart_rate')
      .set('X-Simulation-Id', sid)
      .expect(200);
    const body = response.body as {
      measurement: { value: number };
      comparison: { max: number; deltaFromMaximum: number };
      humanReviewRequired: boolean;
    };
    expect(body.measurement.value).toBe(110);
    expect(body.comparison.max).toBe(76);
    expect(body.comparison.deltaFromMaximum).toBe(34);
    expect(body.humanReviewRequired).toBe(true);
  });

  it('registra rechazos con tripulante y permite filtrarlos', async () => {
    const altered = packet({ value: 111 });
    const valid = packet();
    await ingest({ ...altered, value: 112 });
    expect(state.rejected.at(-1)?.reason).toBe('altered');
    await ingest(valid);
    await ingest(valid);
    expect(state.rejected.at(-1)?.reason).toBe('duplicate');

    const response = await request(app.getHttpServer())
      .get('/api/monitoring/rejections?crewId=elena-torres')
      .set('X-Simulation-Id', sid)
      .expect(200);
    const body = response.body as {
      total: number;
      rejections: {
        reason: string;
        crewId?: string;
        claimedValue: number | null;
      }[];
    };
    expect(body.total).toBe(2);
    expect(
      body.rejections.every((item) => item.crewId === 'elena-torres'),
    ).toBe(true);

    const onlyAltered = await request(app.getHttpServer())
      .get('/api/monitoring/rejections?crewId=elena-torres&reason=altered')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect((onlyAltered.body as { total: number }).total).toBe(1);
    expect(
      (onlyAltered.body as { rejections: { claimedValue: number }[] })
        .rejections[0].claimedValue,
    ).toBe(112);

    const none = await request(app.getHttpServer())
      .get('/api/monitoring/rejections?reason=out_of_order')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect((none.body as { total: number }).total).toBe(0);
  });

  it('aplica permisos de ingesta y rechaza fechas futuras', async () => {
    await action({
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    await ingest(packet({ crewId: 'mateo-ruiz' }), 403);

    await action({ type: 'setRole', role: 'medical' });
    const now = state.clock.simulatedAt;
    await ingest(packet({ measuredAt: now + 1, receivedAt: now + 1 }), 400);
    await ingest({ ...packet(), unit: 'h' }, 400);
    await ingest({ ...packet(), campoExtra: true }, 400);
  });

  it('mantiene idempotencia del sobre de ingesta', async () => {
    const p = packet();
    const requestId = randomUUID();
    const body = {
      simulated: true,
      requestId,
      expectedRevision: revision,
      packet: p,
    };
    const first = await request(app.getHttpServer())
      .post('/api/monitoring/measurements')
      .set('X-Simulation-Id', sid)
      .send(body)
      .expect(201);
    const snapshot = snapshotSchema.parse(first.body);
    state = snapshot.state;
    revision = snapshot.revision;
    const retry = await request(app.getHttpServer())
      .post('/api/monitoring/measurements')
      .set('X-Simulation-Id', sid)
      .send(body)
      .expect(201);
    expect(retry.body).toEqual(first.body);
    expect(
      state.measurements.filter((m) => m.messageId === p.messageId),
    ).toHaveLength(1);
  });

  it('conserva el estado inicial determinista para los escenarios', () => {
    expect(createInitialState('repeated-message').rejected[0].crewId).toBe(
      'elena-torres',
    );
  });
});
