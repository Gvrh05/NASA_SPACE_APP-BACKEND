import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SimulationService } from '../simulation/simulation.service';
import { latestReliable } from '../simulation/domain/selectors';
import { SpaceToolsService } from './space-tools.service';
import { SpaceConversationService, requiredEvidenceTool } from './space-conversation.service';
import { AiService } from './ai.service';
import { resolveProvider } from './provider';
import type {
  ConversationInput,
  ConversationOutput,
  DataUse,
} from './space-conversation.contract';
const proposal = {
  respuesta: 'I hear you. What would help?',
  nivel: 'equipo',
  vistaPrevia: 'Untrusted model preview',
  humanReviewRequired: true,
};
const final = () => ({ text: JSON.stringify(proposal), calls: [] });
const all = { sleep: true, pulse: true, symptoms: true, mission: true };

describe('authorized private conversation and read-only tools', () => {
  let directory: string;
  let sessions: SimulationService;
  let tools: SpaceToolsService;
  let sid: string;
  let token: string;
  const original = process.env.SIMULATION_DATA_DIR;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'helios-conversation-'));
    process.env.SIMULATION_DATA_DIR = directory;
    sessions = new SimulationService();
    tools = new SpaceToolsService(sessions);
    sid = randomUUID();
    sessions.initialize(sid, { scenarioId: 'baseline' });
    sessions.action(sid, randomUUID(), 0, {
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    token = grant();
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (original === undefined) delete process.env.SIMULATION_DATA_DIR;
    else process.env.SIMULATION_DATA_DIR = original;
    jest.restoreAllMocks();
  });
  function grant(dataUse: DataUse = all, historyConsent = true) {
    return tools.issue(sid, {
      crewId: 'elena-torres',
      pin: '1001',
      modelConsent: true,
      historyConsent,
      dataUse,
    }).token;
  }
  function conversation(
    converse: (input: ConversationInput) => Promise<ConversationOutput>,
  ) {
    const ai = new AiService({
      provider: {
        name: 'mock',
        model: 'mock',
        complete: () =>
          Promise.reject(new Error('Not the conversation endpoint')),
        converse,
      },
      providerName: 'mock',
      model: 'mock',
      missing: [],
    });
    return new SpaceConversationService(ai, tools);
  }
  const body = () => ({
    crewId: 'elena-torres',
    textoPersona: 'I feel lonely',
    locale: 'en',
    selectedLevel: 'solo_yo',
    history: [],
  });
  it.each([
    'getRecentSleep',
    'getLatestVitals',
    'getMissionContext',
    'getSupportOptions',
    'getVitalTrends',
    'getMeasurementQuality',
    'getActiveHealthAlerts',
  ])('executes %s without changing any session state', (name) => {
    const before = sessions.get(sid);
    const result = tools.execute(
      sid,
      token,
      name,
      {},
      new AbortController().signal,
    );
    expect(result).toBeDefined();
    expect(sessions.get(sid)).toEqual(before);
  });
  it('scopes new tools to consent and omits private alert reasons', () => {
    const before = sessions.get(sid);
    expect(
      tools.execute(
        sid,
        token,
        'getVitalTrends',
        {},
        new AbortController().signal,
      ),
    ).toMatchObject({ hrMin: 64, hrMax: 76, currentHr: 70 });
    expect(
      tools.execute(
        sid,
        token,
        'getMeasurementQuality',
        {},
        new AbortController().signal,
      ),
    ).toMatchObject({ status: 'valid', kind: 'heart_rate' });
    const alerts = tools.execute(
      sid,
      token,
      'getActiveHealthAlerts',
      {},
      new AbortController().signal,
    );
    expect(JSON.stringify(alerts)).not.toContain('"reason":');
    expect(sessions.get(sid)).toEqual(before);
    token = grant({
      sleep: false,
      pulse: false,
      symptoms: false,
      mission: false,
    });
    for (const name of [
      'getVitalTrends',
      'getMeasurementQuality',
      'getActiveHealthAlerts',
    ])
      expect(() =>
        tools.execute(sid, token, name, {}, new AbortController().signal),
      ).toThrow();
  });
  it.each([
    'getRecentSleep',
    'getLatestVitals',
    'getMissionContext',
    'getSupportOptions',
    'getVitalTrends',
    'getMeasurementQuality',
    'getActiveHealthAlerts',
  ])(
    'Gemini protocol executes authorized %s and never exposes signatures',
    async (name) => {
      const first = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'gemini-call',
            type: 'function',
            function: { name, arguments: '{}' },
            extra_content: {
              google: { thought_signature: 'opaque-signature' },
            },
          },
        ],
      };
      const fetcher = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: first, finish_reason: 'tool_calls' }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: JSON.stringify(proposal) },
                  finish_reason: 'stop',
                },
              ],
            }),
          ),
        );
      const runtime = resolveProvider({
        AI_PROVIDER: 'openai-compatible',
        AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        AI_MODEL: 'gemini-3.8-flash',
        AI_API_KEY: 'fixture-key',
      });
      const service = new SpaceConversationService(
        new AiService(runtime),
        tools,
      );
      const before = sessions.get(sid);
      const response = await service.respond(
        body(),
        sid,
        token,
        new AbortController().signal,
      );
      expect(response.toolsUsed).toEqual([{ name, status: 'ok' }]);
      expect(response.result.nivel).toBe('solo_yo');
      expect(JSON.stringify(response)).not.toContain('opaque-signature');
      expect(sessions.get(sid)).toEqual(before);
      const round = JSON.parse(fetcher.mock.calls[1][1]?.body as string) as {
        messages: unknown[];
      };
      expect(round.messages).toContainEqual(first);
    },
  );
  it('binds vitals to the actual owner and rejects arbitrary arguments or names', () => {
    expect(
      tools.execute(
        sid,
        token,
        'getLatestVitals',
        {},
        new AbortController().signal,
      ),
    ).toHaveProperty(
      'measurement.id',
      latestReliable(sessions.get(sid).state, 'elena-torres', 'heart_rate')?.id,
    );
    for (const [name, args] of [
      ['getLatestVitals', { crewId: 'mateo-ruiz' }],
      ['deleteAlert', {}],
      ['getSupportOptions', { command: 'rm -rf' }],
    ] as const)
      expect(() =>
        tools.execute(sid, token, name, args, new AbortController().signal),
      ).toThrow();
  });
  it('enforces data consent independently of model consent and blocks cross-session access', () => {
    token = grant(
      { sleep: false, pulse: false, symptoms: false, mission: false },
      false,
    );
    expect(tools.allowed(tools.authorize(sid, token))).toEqual([
      'getSupportOptions',
    ]);
    expect(tools.context(sid, token).symptoms).toEqual([]);
    for (const name of [
      'getRecentSleep',
      'getLatestVitals',
      'getMissionContext',
    ])
      expect(() =>
        tools.execute(sid, token, name, {}, new AbortController().signal),
      ).toThrow();
    expect(() => tools.authorize(randomUUID(), token)).toThrow();
    expect(() => tools.authorize(sid, 'forged')).toThrow();
  });
  it('checks current role, PIN, owner, revocation and expiry on the server', () => {
    expect(() =>
      tools.issue(sid, {
        crewId: 'elena-torres',
        pin: '9999',
        modelConsent: true,
        historyConsent: true,
        dataUse: all,
      }),
    ).toThrow();
    expect(() =>
      tools.issue(sid, {
        crewId: 'mateo-ruiz',
        pin: '1002',
        modelConsent: true,
        historyConsent: true,
        dataUse: all,
      }),
    ).toThrow();
    tools.revoke(sid, token);
    expect(() => tools.authorize(sid, token)).toThrow();
    token = grant();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60000);
    expect(() => tools.authorize(sid, token)).toThrow();
    jest.restoreAllMocks();
    token = grant();
    sessions.action(sid, randomUUID(), 1, { type: 'setRole', role: 'medical' });
    expect(() => tools.authorize(sid, token)).toThrow();
  });
  it('passes bounded role-preserving history without duplicating the current message or storing it', async () => {
    const provider = jest.fn(() => Promise.resolve(final()));
    const service = conversation(provider);
    const before = sessions.get(sid);
    const response = await service.respond(
      {
        ...body(),
        datosPersona: {
          measurements: [{ value: 999999 }],
          symptoms: ['forged'],
        },
        history: [
          { role: 'user', content: 'I miss home' },
          { role: 'assistant', content: 'I hear you' },
          { role: 'user', content: 'I feel lonely' },
        ],
      },
      sid,
      token,
      new AbortController().signal,
    );
    const input = (
      provider.mock.calls as unknown as [ConversationInput][]
    )[0][0];
    expect(input.history).toHaveLength(2);
    expect(input.history.map((h) => h.role)).toEqual(['user', 'assistant']);
    expect(input.user).not.toContain('999999');
    expect(input.user).not.toContain('forged');
    expect(response.result.nivel).toBe('solo_yo');
    expect(sessions.get(sid)).toEqual(before);
  });
  it('runs genuine tool exchanges and returns only tool-name provenance to the browser', async () => {
    const snapshots: ConversationInput[] = [];
    const provider = jest.fn((input: ConversationInput) => {
      snapshots.push({
        ...input,
        history: structuredClone(input.history),
        exchanges: structuredClone(input.exchanges),
      });
      return Promise.resolve(
        snapshots.length === 1
          ? {
              text: '',
              calls: [
                { id: 'sleep-call', name: 'getRecentSleep', arguments: {} },
              ],
            }
          : final(),
      );
    });
    const before = sessions.get(sid);
    const response = await conversation(provider).respond(
      body(),
      sid,
      token,
      new AbortController().signal,
    );
    expect(snapshots[1].exchanges[0].results[0]).toMatchObject({
      id: 'sleep-call',
    });
    expect(
      JSON.parse(snapshots[1].exchanges[0].results[0].content),
    ).toHaveProperty('simulated', true);
    expect(response.toolsUsed).toEqual([
      { name: 'getRecentSleep', status: 'ok' },
    ]);
    expect(sessions.get(sid)).toEqual(before);
  });
  it('denies injected tool arguments and never executes unauthorized writes', async () => {
    const provider = jest.fn((input: ConversationInput) =>
      Promise.resolve(
        input.exchanges.length
          ? final()
          : {
              text: '',
              calls: [
                {
                  id: 'bad',
                  name: 'getLatestVitals',
                  arguments: { crewId: 'mateo-ruiz' },
                },
                { id: 'write', name: 'closeAlert', arguments: {} },
              ],
            },
      ),
    );
    const before = sessions.get(sid);
    const response = await conversation(provider).respond(
      body(),
      sid,
      token,
      new AbortController().signal,
    );
    expect(response.toolsUsed.every((t) => t.status === 'denied')).toBe(true);
    expect(sessions.get(sid)).toEqual(before);
  });
  it('rejects history without consent, other owners, excessive memory and invalid model schemas', async () => {
    const provider = jest.fn(() => Promise.resolve(final()));
    const service = conversation(provider);
    token = grant(all, false);
    await expect(
      service.respond(
        { ...body(), history: [{ role: 'user', content: 'private' }] },
        sid,
        token,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.respond(
        { ...body(), crewId: 'mateo-ruiz' },
        sid,
        token,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.respond(
        {
          ...body(),
          history: Array.from({ length: 13 }, () => ({
            role: 'user',
            content: 'x',
          })),
        },
        sid,
        token,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider).not.toHaveBeenCalled();
    await expect(
      conversation(() =>
        Promise.resolve({
          text: '{"action":"delete"}',
          calls: [],
        }),
      ).respond(body(), sid, token, new AbortController().signal),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('caps calls and rounds and rejects duplicate tool-call IDs', async () => {
    const spy = jest.spyOn(tools, 'execute');
    await expect(
      conversation(() =>
        Promise.resolve({
          text: '',
          calls: Array.from({ length: 5 }, (_, i) => ({
            id: String(i),
            name: 'getSupportOptions',
            arguments: {},
          })),
        }),
      ).respond(body(), sid, token, new AbortController().signal),
    ).rejects.toMatchObject({ status: 422 });
    expect(spy).not.toHaveBeenCalled();
    await expect(
      conversation(() =>
        Promise.resolve({
          text: '',
          calls: [{ id: 'repeat', name: 'getSupportOptions', arguments: {} }],
        }),
      ).respond(body(), sid, token, new AbortController().signal),
    ).rejects.toMatchObject({ status: 422 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('cancels before provider access and blocks a late result after consent revocation', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const provider = jest.fn(() => Promise.resolve(final()));
    await expect(
      conversation(provider).respond(body(), sid, token, aborted.signal),
    ).rejects.toMatchObject({ status: 504 });
    expect(provider).not.toHaveBeenCalled();
    let finish!: (value: ConversationOutput) => void;
    const pending = new Promise<ConversationOutput>((resolve) => {
      finish = resolve;
    });
    const response = conversation(() => pending).respond(
      body(),
      sid,
      token,
      new AbortController().signal,
    );
    tools.revoke(sid, token);
    finish(final());
    await expect(response).rejects.toMatchObject({ status: 401 });
  });
  it('cancels a provider that ignores the abort signal', async () => {
    const ai = new AiService({
      provider: {
        name: 'mock',
        model: 'mock',
        complete: () => new Promise<string>(() => undefined),
      },
      providerName: 'mock',
      model: 'mock',
      missing: [],
    });
    const controller = new AbortController();
    const service = new SpaceConversationService(ai, tools);
    const pending = service.respond(body(), sid, token, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 504 });
  });
  it('returns controlled unconfigured-provider errors without persisting conversation', async () => {
    const service = new SpaceConversationService(
      new AiService(resolveProvider({})),
      tools,
    );
    const before = sessions.get(sid);
    await expect(
      service.respond(body(), sid, token, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    expect(sessions.get(sid)).toEqual(before);
  });
  it('makes actual tool availability explicit without inventing disabled permissions', async () => {
    token = grant({ sleep: false, pulse: false, symptoms: false, mission: false });
    const service = conversation(async (input) => {
      const authorization = input.system.split('SERVER AUTHORIZATION FOR THIS TURN:')[1];
      expect(authorization).toContain('getSupportOptions');
      expect(authorization).not.toContain('getLatestVitals');
      expect(input.tools.map((t) => t.name)).toEqual(['getSupportOptions']);
      return final();
    });
    await service.respond(body(), sid, token, new AbortController().signal);
  });

});

it('plans evidence only for permitted concrete requests, not definitions or emotions', () => {
  expect(requiredEvidenceTool('What is my latest heart rate?', ['getLatestVitals'])).toBe('getLatestVitals');
  expect(requiredEvidenceTool('What is my latest heart rate?', ['getSupportOptions'])).toBeUndefined();
  expect(requiredEvidenceTool('?Qu? es una alerta?', ['getActiveHealthAlerts'])).toBeUndefined();
  expect(requiredEvidenceTool('I feel lonely', ['getLatestVitals', 'getSupportOptions'])).toBeUndefined();
  expect(requiredEvidenceTool('How can I improve my quality of life?', ['getMeasurementQuality'])).toBeUndefined();
  expect(requiredEvidenceTool('What support options are available?', ['getSupportOptions'])).toBe('getSupportOptions');
});
