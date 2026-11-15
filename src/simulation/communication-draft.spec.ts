import { reduce } from './domain/reduce';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from '../app.module';
import { actionSchema, stateSchema } from './contracts';
const snapshot = z.object({ state: stateSchema, revision: z.number().int() });

describe('updateCommunicationDraft integration', () => {
  let app: INestApplication<Server>;
  let directory: string;
  let sid: string;
  let current: z.infer<typeof snapshot>;
  let communicationId: string;
  const previousDirectory = process.env.SIMULATION_DATA_DIR;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'helios-draft-'));
    process.env.SIMULATION_DATA_DIR = directory;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) delete process.env.SIMULATION_DATA_DIR;
    else process.env.SIMULATION_DATA_DIR = previousDirectory;
  });
  async function act(action: unknown, status = 201, requestId = randomUUID()) {
    const response = await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send({ requestId, expectedRevision: current.revision, action })
      .expect(status);
    if (status === 201) current = snapshot.parse(response.body);
    return response;
  }
  async function unchangedAfter(action: unknown, status: number) {
    const before = structuredClone(current);
    await act(action, status);
    const response = await request(app.getHttpServer())
      .get('/api/simulation')
      .set('X-Simulation-Id', sid)
      .expect(200);
    expect(snapshot.parse(response.body)).toEqual(before);
  }
  beforeEach(async () => {
    sid = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/simulation')
      .set('X-Simulation-Id', sid)
      .send({ scenarioId: 'baseline' })
      .expect(201);
    current = snapshot.parse(response.body);
    await act({
      type: 'createCommunication',
      crewId: 'elena-torres',
      episodeId: null,
      subject: 'Original subject',
      body: 'Original fictional body',
      idempotencyKey: 'draft-fixture',
    });
    communicationId = current.state.communications.find(
      (c) => c.idempotencyKey === 'draft-fixture',
    )!.id;
  });
  const update = () => ({
    type: 'updateCommunicationDraft',
    id: communicationId,
    subject: 'Updated subject',
    body: 'Updated fictional body',
  });
  it.each(['medical', 'ops'] as const)(
    'allows %s to edit only content and adds an audit event',
    async (role) => {
      await act({ type: 'setRole', role });
      const before = current.state.communications.find(
        (c) => c.id === communicationId,
      )!;
      await act({
        ...update(),
        subject: '  Updated subject  ',
        body: '  Updated fictional body  ',
      });
      expect(
        current.state.communications.find((c) => c.id === communicationId),
      ).toEqual({
        ...before,
        subject: 'Updated subject',
        body: 'Updated fictional body',
      });
      expect(current.state.audit.at(-1)).toMatchObject({
        action: 'edit-communication-draft',
        actor: role,
        entityId: communicationId,
      });
    },
  );
  it('rejects astronaut edits without changing state or revision', async () => {
    await act({
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    await unchangedAfter(update(), 403);
  });
  it.each(['queued', 'sent', 'received'] as const)(
    'rejects editing a %s communication',
    async (target) => {
      await act({ type: 'setLink', link: 'up' });
      for (const status of ['queued', 'sent', 'received'] as const) {
        await act({
          type: 'transitionCommunication',
          id: communicationId,
          status,
        });
        if (status === target) break;
      }
      await unchangedAfter(update(), 409);
    },
  );
  it('validates lengths, fields and whitespace without mutating the session', async () => {
    for (const invalid of [
      { subject: 'ab' },
      { subject: 'x'.repeat(181) },
      { body: 'ab' },
      { body: 'x'.repeat(4001) },
      { subject: '   ' },
      { body: '   ' },
      { status: 'sent' },
    ])
      await unchangedAfter({ ...update(), ...invalid }, 400);
    expect(actionSchema.safeParse(update()).success).toBe(true);
  });
  it('retains the subject limit when the reducer is called directly', () => {
    const result = reduce(current.state, {
      ...update(),
      type: 'updateCommunicationDraft',
      subject: 'x'.repeat(181),
    });
    expect(result.communications).toEqual(current.state.communications);
    expect(result.audit).toEqual(current.state.audit);
    expect(result.notice?.tone).toBe('err');
  });
  it('returns 404 for an unknown communication', async () => {
    await unchangedAfter({ ...update(), id: 'missing-communication' }, 404);
  });
  it('keeps retries idempotent and rejects stale revisions', async () => {
    const body = {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      action: update(),
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
    expect(retry.body as unknown).toEqual(first.body as unknown);
    expect(
      snapshot
        .parse(retry.body)
        .state.audit.filter((a) => a.action === 'edit-communication-draft'),
    ).toHaveLength(1);
    await request(app.getHttpServer())
      .post('/api/simulation/actions')
      .set('X-Simulation-Id', sid)
      .send({ ...body, requestId: randomUUID() })
      .expect(409);
  });
});
