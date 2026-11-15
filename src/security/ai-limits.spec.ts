import { AiService } from '../ai/ai.service';
import { resolveProvider } from '../ai/provider';

const context = {
  crewId: 'elena-torres',
  crewName: 'fictional',
  simulatedAt: 1,
  freshness: 'sin_datos_recientes',
  datosPersona: { measurements: [], symptoms: [] },
  textoPersona: 'fictional note',
};
const valid = JSON.stringify({
  respuesta: 'Draft',
  nivel: 'solo_yo',
  vistaPrevia: 'Draft',
  humanReviewRequired: true,
});
function service(complete: () => Promise<string>) {
  return new AiService({
    provider: { name: 'test', model: 'test', complete },
    model: 'test',
    providerName: 'test',
    missing: [],
  });
}
describe('AI output and consumption limits', () => {
  afterEach(() => jest.restoreAllMocks());
  it('limits total requests across clients and recovers after one minute', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const complete = jest.fn(() => Promise.resolve(valid));
    const ai = service(complete);
    const signal = new AbortController().signal;
    for (let i = 0; i < 60; i++) await ai.space(context, signal);
    await expect(ai.space(context, signal)).rejects.toMatchObject({
      status: 429,
    });
    expect(complete).toHaveBeenCalledTimes(60);
    now += 60001;
    await ai.space(context, signal);
    expect(complete).toHaveBeenCalledTimes(61);
  });
  it('caps concurrent provider requests and releases slots', async () => {
    let release!: () => void;
    const pending = new Promise<string>((resolve) => {
      release = () => resolve(valid);
    });
    const complete = jest.fn(() => pending);
    const ai = service(complete);
    const signal = new AbortController().signal;
    const first = ai.space(context, signal);
    const second = ai.space(context, signal);
    await expect(ai.space(context, signal)).rejects.toMatchObject({
      status: 429,
    });
    expect(complete).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    await ai.space(context, signal);
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it('rejects oversized model text and fabricated references', async () => {
    const signal = new AbortController().signal;
    await expect(
      service(() => Promise.resolve('x'.repeat(16001))).space(context, signal),
    ).rejects.toMatchObject({ status: 422 });
    const result = {
      summary: 'Untrusted',
      evidence: [
        {
          statement: 'Fictional claim',
          refType: 'measurement',
          refId: 'invented',
        },
      ],
      missing: [],
      questions: [],
      checks: [],
      resources: [],
      humanReviewRequired: true,
      limitations: ['Demo'],
      sources: ['Demo'],
    };
    const analysis = {
      episodeId: 'demo',
      crewId: 'elena-torres',
      crewName: 'fictional',
      simulatedAt: 1,
      link: 'up',
      baseline: { heartRateLpm: '60-80', sleepHours: '7-8' },
      measurements: [],
      symptoms: [],
      alerts: [],
      resources: [],
      protocols: [],
    };
    await expect(
      service(() => Promise.resolve(JSON.stringify(result))).analyze(
        analysis,
        signal,
        false,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('keeps an unconfigured provider separate from the local simulation', async () => {
    const ai = new AiService(resolveProvider({}));
    expect(ai.health().configured).toBe(false);
    await expect(
      ai.space(context, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
  });
});
