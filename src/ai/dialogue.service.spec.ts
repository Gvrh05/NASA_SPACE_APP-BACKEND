import { randomUUID } from 'node:crypto';
import { DialogueService } from './dialogue.service';
import { AiService } from './ai.service';
import { SimulationService } from '../simulation/simulation.service';
import { createInitialState } from '../simulation/domain/scenarios';
import { dialogueContextKey } from './dialogue.contract';
import type { ConversationInput } from './space-conversation.contract';

describe('general dialogue and private evidence boundaries', () => {
  const sid = randomUUID();
  let state: ReturnType<typeof createInitialState>;
  let service: DialogueService;
  let seen: ConversationInput[];
  let reply: { text: string; referenceIds: string[] };
  beforeEach(() => {
    state = createInitialState('baseline');
    state.role = 'astronaut';
    state.sessionCrewId = 'elena-torres';
    state.selectedCrewId = 'sofia-chen';
    state.selectedEpisodeId = null;
    seen = [];
    reply = { text: 'An alert flags a change worth reviewing.', referenceIds: [] };
    const ai = new AiService({ providerName: 'test', model: 'test', missing: [], provider: {
      name: 'test', model: 'test', complete: async () => { throw new Error('Wrong route'); },
      converse: async (input) => { seen.push(input); return { text: JSON.stringify(reply), calls: [] }; },
    }});
    service = new DialogueService(ai, { get: () => ({ state }) } as unknown as SimulationService);
  });
  const signal = () => new AbortController().signal;
  function request(mode = 'public', dataConsent = false) {
    return { mode, question: 'What is an alert?', locale: 'en', modelConsent: true,
      historyConsent: true, history: [], dataConsent,
      ...(mode === 'dashboard' ? { contextKey: dialogueContextKey(state) } : {}) };
  }
  it('answers general health concepts in public without session records', async () => {
    await service.respond(request(), '', signal());
    const facts = JSON.parse(seen[0].user).facts;
    expect(facts.map((f: {id: string}) => f.id)).not.toContain('indicators');
    expect(seen[0].tools).toEqual([]);
    expect(seen[0].user).not.toContain('elena-torres');
  });
  it('allows dashboard questions with no episode and no personal data consent', async () => {
    await service.respond(request('dashboard'), sid, signal());
    const facts = JSON.parse(seen[0].user).facts;
    expect(facts.some((f: {id: string}) => f.id === 'mission')).toBe(true);
    expect(facts.some((f: {id: string}) => f.id === 'indicators')).toBe(false);
  });
  it('binds consented indicators to the astronaut owner, not selected crew', async () => {
    await service.respond(request('dashboard', true), sid, signal());
    const indicators = JSON.parse(seen[0].user).facts.find((f: {id: string}) => f.id === 'indicators');
    expect(indicators.data.crewName).toBe('Elena Torres');
    expect(indicators.data).not.toHaveProperty('symptoms');
    expect(indicators.data).not.toHaveProperty('notes');
  });
  it('keeps operations roles from receiving personal indicators even with consent', async () => {
    state.role = 'ops';
    await service.respond(request('dashboard', true), sid, signal());
    expect(JSON.parse(seen[0].user).facts.some((f: {id: string}) => f.id === 'indicators')).toBe(false);
  });
  it.each(['es', 'en'])('forwards a follow-up history without requiring personal records (%s)', async (locale) => {
    const q = { ...request(), locale };
    await service.respond(q, '', signal());
    const result = reply.text;
    await service.respond({ ...q, question: locale === 'es' ? '?Y eso por qu??' : 'Why?', history: [
      { role: 'user', content: q.question }, { role: 'assistant', content: result },
    ] }, '', signal());
    expect(seen[1].history).toHaveLength(2);
    expect(seen[1].tools).toEqual([]);
  });
  it('rejects history without consent and private context in public mode', async () => {
    await expect(service.respond({ ...request(), historyConsent: false, history: [{ role: 'user', content: 'private' }] }, '', signal())).rejects.toThrow();
    await expect(service.respond({ ...request(), dataConsent: true }, '', signal())).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });
  it('rejects a stale scope and fabricated evidence references', async () => {
    await expect(service.respond({ ...request('dashboard'), contextKey: 'old' }, sid, signal())).rejects.toThrow();
    reply.referenceIds = ['fabricated-reading'];
    await expect(service.respond(request(), '', signal())).rejects.toThrow();
  });
  it('keeps consent enforcement server-side without priming general replies with permission flags', async () => {
    await service.respond({ ...request('dashboard'), question: 'me siento mal' }, sid, signal());
    const payload = JSON.parse(seen[0].user);
    expect(payload).not.toHaveProperty('dataConsent');
    expect(payload.facts.find((f: { id: string }) => f.id === 'mission').data).not.toHaveProperty('dataConsent');
    expect(payload.facts.some((f: { id: string }) => f.id === 'indicators')).toBe(false);
    expect(seen[0].system).toContain('open conversation');
    expect(seen[0].system).toContain('Mi espacio');
  });

});
