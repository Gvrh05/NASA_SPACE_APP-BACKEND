import type { Server } from 'node:http';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { AI_RUNTIME } from '../ai/ai.service';
import { SimulationService } from './simulation.service';
import { createInitialState } from './domain/scenarios';
import { crewPosture, latestReliable } from './domain/selectors';
import { signedPacket } from './domain/messages';
import { SCENARIO_IDS, type AppState } from './shared/types';
import { stateSchema } from './contracts';

const snapshotSchema = z.object({
  state: stateSchema,
  revision: z.number().int(),
  simulated: z.literal(true),
});

const sibling = resolve(__dirname, '../../../astrodeepspacenasa');
const files = [
  'analysis',
  'selectors',
  'messages',
  'reduce',
  'scenarios',
  'access',
  'symptoms',
  'shell',
  'spacePreview',
  'spaceAccess',
  'inventory',
  'format',
  'clock',
  'stateOps',
  'hash',
  'constants',
  'crew',
];
(existsSync(sibling) ? describe : describe.skip)(
  'paridad con simulador React',
  () => {
    it.each(files)('%s conserva las reglas existentes', (name) => {
      const expected = readFileSync(
        resolve(sibling, `src/domain/${name}.ts`),
        'utf8',
      )
        .replaceAll('../../shared/', '../shared/')
        .replace(
          "import type { SpaceShareLevel } from '../persistence/space'",
          "type SpaceShareLevel = 'solo_yo' | 'generica' | 'medico' | 'equipo'",
        );
      expect(
        readFileSync(
          resolve(__dirname, `domain/${name}.ts`),
          'utf8',
        ).replaceAll('\r\n', '\n'),
      ).toBe(expected.replaceAll('\r\n', '\n'));
    });
    it.each(['types', 'mac', 'protocols'])('contrato compartido %s', (name) => {
      expect(
        readFileSync(
          resolve(__dirname, `shared/${name}.ts`),
          'utf8',
        ).replaceAll('\r\n', '\n'),
      ).toBe(
        readFileSync(resolve(sibling, `shared/${name}.ts`), 'utf8').replaceAll(
          '\r\n',
          '\n',
        ),
      );
    });
  },
);

describe('escenarios preservados', () => {
  it.each(SCENARIO_IDS)(
    '%s tiene un estado válido y determinista',
    (scenarioId) => {
      const state = createInitialState(scenarioId);
      expect(stateSchema.safeParse(state).success).toBe(true);
      expect(state).toEqual(createInitialState(scenarioId));
    },
  );
  it.each(['missing-data', 'stale-normal', 'frozen-sensor'] as const)(
    '%s no se interpreta como estable',
    (scenarioId) => {
      expect(
        crewPosture(createInitialState(scenarioId), 'elena-torres').observed,
      ).toBe('no_recent_evaluation');
    },
  );
  it('mantiene los escenarios de duplicación, alteración y cambio', () => {
    expect(createInitialState('repeated-message').rejected[0].reason).toBe(
      'duplicate',
    );
    expect(createInitialState('altered-message').rejected[0].reason).toBe(
      'altered',
    );
    expect(
      crewPosture(createInitialState('gradual-fatigue'), 'elena-torres')
        .observed,
    ).toBe('change');
  });
});

describe('API de simulación integrada', () => {
  let app: INestApplication<Server>;
  let directory: string;
  let sid: string;
  let state: AppState;
  let revision: number;
  const previousDirectory = process.env.SIMULATION_DATA_DIR;
  beforeAll(async () => {
    directory = mkdtempSync(resolve(tmpdir(), 'vitalink-test-'));
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
    app = module.createNestApplication<INestApplication<Server>>();
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
    state = snapshotSchema.parse(response.body).state;
    revision = snapshotSchema.parse(response.body).revision;
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
      state = snapshotSchema.parse(response.body).state;
      revision = snapshotSchema.parse(response.body).revision;
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
  async function ingest(p: unknown, expected = 201) {
    const response = await request(app.getHttpServer())
      .post('/api/monitoring/measurements')
      .set('X-Simulation-Id', sid)
      .send({
        simulated: true,
        requestId: randomUUID(),
        expectedRevision: revision,
        packet: p,
      })
      .expect(expected);
    if (expected === 201) {
      state = snapshotSchema.parse(response.body).state;
      revision = snapshotSchema.parse(response.body).revision;
    }
    return response;
  }
  it('bloquea Completed y conserva In Flight si hay episodios abiertos', async () => {
    await action({
      type: 'addSymptom',
      crewId: 'elena-torres',
      symptoms: ['mareo'],
      note: '',
      idempotencyKey: 'stage-with-open-episode',
    });
    const stageBefore = state.mission.stage;
    await action({ type: 'setMissionStage', stage: 'posmision' });
    expect(state.mission.stage).toBe(stageBefore);
    expect(state.episodes.some((episode) => episode.status !== 'closed')).toBe(
      true,
    );
    expect(state.notice?.tone).toBe('err');
  });
  it('recupera misiones guardadas como Completed con episodios abiertos', () => {
    const legacyId = randomUUID();
    const legacyState = createInitialState('gradual-fatigue');
    const invalidState = {
      ...legacyState,
      mission: { ...legacyState.mission, stage: 'posmision' as const },
    };
    writeFileSync(
      resolve(directory, `${legacyId}.json`),
      JSON.stringify({
        version: 1,
        state: invalidState,
        revision: 0,
        requests: {},
      }),
    );
    const restored = new SimulationService().get(legacyId);
    expect(restored.state.mission.stage).toBe('a_bordo');
    expect(
      restored.state.episodes.some((episode) => episode.status !== 'closed'),
    ).toBe(true);
    expect(restored.revision).toBe(1);
  });
  it('recibe medición y genera alerta con evidencia sin IA', async () => {
    const p = packet();
    await ingest(p);
    expect(latestReliable(state, 'elena-torres', 'heart_rate')?.value).toBe(
      110,
    );
    expect(
      state.alerts.some(
        (a) => a.type === 'change' && a.reason.includes(`meas-${p.messageId}`),
      ),
    ).toBe(true);
    const freshService = new SimulationService();
    expect(freshService.get(sid).state.measurements).toEqual(
      state.measurements,
    );
    const response = await request(app.getHttpServer())
      .get('/api/monitoring/latest?crewId=elena-torres&kind=heart_rate')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect(
      (response.body as { comparison: { max: number } }).comparison.max,
    ).toBe(76);
  });
  it('rechaza unidades, fechas futuras y campos desconocidos', async () => {
    await ingest({ ...packet(), unit: 'h' }, 400);
    await ingest(
      packet({
        measuredAt: state.clock.simulatedAt + 1,
        receivedAt: state.clock.simulatedAt + 1,
      }),
      400,
    );
    await action({ type: 'tick', realDeltaMs: -1 }, 400);
    await action({ type: 'setRole', role: 'admin' }, 400);
    const invalid = { ...state, measurements: [{ id: 'invalid' }] };
    await request(app.getHttpServer())
      .post('/api/simulation')
      .set('X-Simulation-Id', randomUUID())
      .send({ initialState: invalid })
      .expect(400);
  });
  it('rechaza alteración y duplicados sin duplicar mediciones', async () => {
    const p = packet();
    const before = state.measurements.length;
    await ingest({ ...p, value: 111 });
    expect(state.measurements).toHaveLength(before);
    expect(state.rejected.at(-1)?.reason).toBe('altered');
    const valid = packet();
    await ingest(valid);
    await ingest(valid);
    expect(
      state.measurements.filter((m) => m.messageId === valid.messageId),
    ).toHaveLength(1);
    expect(state.rejected.at(-1)?.reason).toBe('duplicate');
  });
  it.each(['crewId', 'signalQuality', 'receivedAt', 'context'] as const)(
    'verifica integridad de %s',
    async (field) => {
      const values = {
        crewId: 'mateo-ruiz',
        signalQuality: 1,
        receivedAt: state.clock.simulatedAt - 1,
        context: 'exercise',
      };
      const p = packet(
        field === 'receivedAt'
          ? { measuredAt: state.clock.simulatedAt - 2 }
          : {},
      );
      await ingest({ ...p, [field]: values[field] });
      expect(state.rejected.at(-1)?.reason).toBe('altered');
    },
  );
  it('marca datos antiguos y calidad cero como evidencia pendiente', async () => {
    const stale = packet({ measuredAt: state.clock.simulatedAt - 60 * 60000 });
    await ingest(stale);
    expect(state.measurements.at(-1)?.integrity).toBe('stale');
    await ingest(packet({ signalQuality: 0 }));
    expect(state.measurements.at(-1)?.integrity).toBe('pending');
    expect(latestReliable(state, 'elena-torres', 'heart_rate')?.value).toBe(70);
  });
  it('detecta tres lecturas idénticas sin confundirlas con certeza clínica', async () => {
    await ingest(packet());
    await ingest(packet());
    await ingest(packet());
    expect(
      state.measurements.slice(-3).every((m) => m.integrity === 'pending'),
    ).toBe(true);
    expect(state.alerts.some((a) => a.type === 'quality')).toBe(true);
  });
  it('detecta ausencia por envejecimiento del reloj', async () => {
    await action({ type: 'setScenario', scenarioId: 'link-down' });
    await action({ type: 'setRunning', running: true });
    await action({ type: 'setSpeed', speed: 10 });
    await action({ type: 'tick', realDeltaMs: 300000 });
    expect(crewPosture(state, 'elena-torres').observed).toBe(
      'no_recent_evaluation',
    );
    expect(state.alerts.some((a) => a.type === 'missing')).toBe(true);
  });
  it('hace idempotente un request y detecta conflictos de revisión', async () => {
    const body = {
      requestId: randomUUID(),
      expectedRevision: revision,
      action: {
        type: 'addSymptom',
        crewId: 'elena-torres',
        symptoms: ['mareo'],
        note: '',
        idempotencyKey: 'symptom-once',
      },
    };
    const first = await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send(body)
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send(body)
      .expect(201);
    expect(retry.body).toEqual(first.body);
    await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send({ ...body, action: { type: 'setRunning', running: true } })
      .expect(409);
    await action({ type: 'setRunning', running: true }, 409);
  });
  it('conserva reportes que contienen solo una nota', async () => {
    await action({
      type: 'addSymptom',
      crewId: 'elena-torres',
      symptoms: [],
      note: 'Reporte sin categoría',
      idempotencyKey: 'note-only',
    });
    expect(state.symptoms.at(-1)?.note).toBe('Reporte sin categoría');
  });
  it('serializa dos peticiones concurrentes sobre la misma revisión', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/api/simulation/actions')
        .set('X-Simulation-Id', sid)
        .send({
          requestId: randomUUID(),
          expectedRevision: revision,
          action: { type: 'setRunning', running: true },
        });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('simula los permisos del servidor', async () => {
    await action({
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    await action(
      {
        type: 'addSymptom',
        crewId: 'mateo-ruiz',
        symptoms: ['mareo'],
        note: '',
        idempotencyKey: 'denied',
      },
      403,
    );
    await action(
      {
        type: 'createCommunication',
        crewId: 'elena-torres',
        episodeId: null,
        subject: 'Revisión',
        body: 'Solicito revisión humana',
        idempotencyKey: 'denied',
      },
      403,
    );
  });
  it('conserva borrador, cola, envío y recepción como estados diferentes', async () => {
    await action({
      type: 'createCommunication',
      crewId: 'elena-torres',
      episodeId: null,
      subject: 'Revisión',
      body: 'Solicito revisión humana',
      idempotencyKey: 'comm',
    });
    const id = state.communications[0].id;
    await action({ type: 'transitionCommunication', id, status: 'queued' });
    await action({ type: 'setLink', link: 'down' });
    await action({ type: 'transitionCommunication', id, status: 'sent' });
    expect(state.communications[0].status).toBe('queued');
    await action({ type: 'setLink', link: 'up' });
    await action({ type: 'transitionCommunication', id, status: 'sent' });
    expect(state.communications[0].receivedAt).toBeNull();
    await action({ type: 'transitionCommunication', id, status: 'received' });
    expect(state.communications[0].receivedAt).not.toBeNull();
  });
  it('crea episodio, análisis local y resumen filtrable sin proveedor de IA', async () => {
    await action({
      type: 'addSymptom',
      crewId: 'elena-torres',
      symptoms: ['mareo'],
      note: 'Autorreporte',
      idempotencyKey: 'symptom-analysis',
    });
    const episode = state.episodes[0];
    const response = await request(app.getHttpServer())
      .get(`/api/medical/episodes/${episode.id}/analysis`)
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect((response.body as { source: string }).source).toBe('local_engine');
    expect(
      (response.body as { result: { humanReviewRequired: boolean } }).result
        .humanReviewRequired,
    ).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/medical/episodes/${episode.id}/analysis`)
      .set('X-Simulation-Id', sid)
      .send({ requestId: randomUUID(), expectedRevision: revision })
      .expect(201);
    const history = await request(app.getHttpServer())
      .get('/api/history?crewId=elena-torres&type=analysis')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect((history.body as { events: unknown[] }).events).toHaveLength(1);
    await request(app.getHttpServer())
      .get('/api/history?from=20&to=10')
      .set('X-Simulation-Id', sid)
      .expect(400);
  });
});
