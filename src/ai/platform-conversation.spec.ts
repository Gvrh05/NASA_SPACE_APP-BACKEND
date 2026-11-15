import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformService } from '../platform/platform.service';
import { SimulationService } from '../simulation/simulation.service';
import { SpaceToolsService } from './space-tools.service';
import { SpaceConversationService } from './space-conversation.service';
import { PlatformConversationService } from './platform-conversation.service';
import { AiService } from './ai.service';
import { ProviderError } from './provider';
import type { ConversationInput, ConversationOutput } from './space-conversation.contract';
import { toolNames } from './space-conversation.contract';
import type { Profile } from '../platform/types';

const final = (text = 'A useful response.') => ({ text: JSON.stringify({ respuesta: text, nivel: 'equipo', vistaPrevia: 'Not sent', humanReviewRequired: true }), calls: [] });
const options = { modelConsent: true, historyConsent: true, dataConsent: false };
const mission = 'mission-helios-demo';
describe('specialized Gemini conversations, permissions and explicit sharing', () => {
  let directory: string;
  let platform: PlatformService;
  let tools: SpaceToolsService;
  let simulation: SimulationService;
  let owner: Profile;
  let sid: string;
  let seen: ConversationInput[];
  const oldDirectory = process.env.SIMULATION_DATA_DIR;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'helios-care-'));
    process.env.SIMULATION_DATA_DIR = directory;
    platform = new PlatformService();
    owner = profile('mateo-ruiz');
    simulation = new SimulationService(); tools = new SpaceToolsService(simulation);
    sid = randomUUID(); simulation.initialize(sid, { scenarioId: 'baseline' });
    simulation.action(sid, randomUUID(), 0, { type: 'setRole', role: 'astronaut', sessionCrewId: 'mateo-ruiz' });
    seen = [];
  });
  afterEach(() => {
    if (oldDirectory === undefined) delete process.env.SIMULATION_DATA_DIR; else process.env.SIMULATION_DATA_DIR = oldDirectory;
    rmSync(directory, { recursive: true, force: true });
  });
  function profile(id: string) { return platform.requireSession(platform.selectProfile(id).token); }
  function service(turn: (input: ConversationInput) => Promise<ConversationOutput> = async () => final()) {
    const ai = new AiService({ providerName: 'fixture', model: 'fixture', missing: [], provider: {
      name: 'fixture', model: 'fixture', complete: async () => { throw new Error('Wrong endpoint'); },
      converse: async input => { seen.push(structuredClone({ ...input, signal: undefined }) as unknown as ConversationInput); return turn(input); },
    } });
    return new PlatformConversationService(platform, ai, new SpaceConversationService(ai, tools), tools);
  }
  const signal = () => new AbortController().signal;
  function monitoring() {
    return { sessionId: sid, token: tools.issue(sid, { crewId: owner.id, pin: '1002', modelConsent: true, historyConsent: false,
      dataUse: { pulse: true, sleep: true, symptoms: true, mission: true } }).token };
  }
  it.each(['physical', 'emotional'] as const)('uses Gemini on the %s route with consent and honest provenance', async mode => {
    const conversation = platform.startConversation(owner, mission, mode);
    const result = await service().message(owner, conversation.id, { text: 'Hello', locale: 'en', ai: options }, signal());
    expect(result.messages.at(-1)).toMatchObject({ source: 'model', model: 'fixture', text: 'A useful response.' });
    expect(seen).toHaveLength(1);
    expect(seen[0].history).toHaveLength(1);
    expect(result.private).toBe(mode === 'emotional');
  });
  it('does not contact the model without opt-in, but retains local continuity', async () => {
    const s = service(); const c = platform.startConversation(owner, mission, 'physical');
    for (const text of ['me siento mal', 'fisico', 'dolor de cabeza', 'fisica']) await s.message(owner, c.id, { text }, signal());
    expect(seen).toHaveLength(0);
    const messages = platform.ownedConversation(owner, c.id).messages;
    expect(messages.at(-1)?.text).toContain('dolor de cabeza');
    expect(messages.at(-1)?.source).toBe('local');
  });
  it('bounds authorized history and never mixes modules or owners', async () => {
    const s = service(); const c = platform.startConversation(owner, mission, 'physical');
    platform.postConversationMessage(owner, platform.startConversation(owner, mission, 'emotional').id, 'OTHER-MODULE-PRIVATE');
    for (let i = 0; i < 8; i++) await s.message(owner, c.id, { text: `Turn ${i}`, ai: options }, signal());
    expect(seen.at(-1)!.history.length).toBeLessThanOrEqual(12);
    expect(Buffer.byteLength(JSON.stringify(seen.at(-1)!.history))).toBeLessThanOrEqual(12000);
    expect(JSON.stringify(seen)).not.toContain('OTHER-MODULE-PRIVATE');
    await expect(s.message(profile('elena-torres'), c.id, { text: 'Read private', ai: options }, signal())).rejects.toThrow();
    expect(seen).toHaveLength(8);
  });
  it('withholds history and stored symptoms unless separately authorized', async () => {
    platform.addSymptom(owner, mission, { description: 'PRIVATE-SYMPTOM', startedAt: null, intensity: 1, context: 'self', source: 'self_report' });
    const c = platform.startConversation(owner, mission, 'physical');
    platform.postConversationMessage(owner, c.id, 'PRIVATE-PAST');
    await service().message(owner, c.id, { text: 'Hello', ai: { ...options, historyConsent: false } }, signal());
    expect(seen[0].history).toEqual([]);
    expect(JSON.stringify(seen[0])).not.toMatch(/PRIVATE-SYMPTOM|PRIVATE-PAST/);
    expect(seen[0].tools.map(t => t.name)).toEqual(['getSupportOptions']);
  });
  it.each(['rate_limit', 'invalid_response'] as const)('uses a labeled local response on %s', async code => {
    const c = platform.startConversation(owner, mission, 'physical');
    const result = await service(async () => { throw new ProviderError(code, 'Synthetic provider failure'); })
      .message(owner, c.id, { text: 'me siento mal', ai: options }, signal());
    expect(result.messages.at(-1)?.notice).toContain(code);
    expect(result.messages.at(-1)?.source).toBe('local');
    expect(result.messages).toHaveLength(3);
  });
  it('keeps the local engine when Gemini is not configured', async () => {
    const ai = new AiService({ provider: null, model: '', providerName: 'none', missing: ['AI_API_KEY'] });
    const s = new PlatformConversationService(platform, ai, new SpaceConversationService(ai, tools), tools);
    const c = platform.startConversation(owner, mission, 'emotional');
    const result = await s.message(owner, c.id, { text: 'I feel lonely', locale: 'en', ai: options }, signal());
    expect(result.messages.at(-1)?.notice).toContain('not_configured');
  });
  it.each(toolNames)('reuses authorized %s without model writes or sharing', async name => {
    const c = platform.startConversation(owner, mission, 'physical');
    const s = service(async input => input.exchanges.length ? final('Grounded explanation for human review.') : ({ text: '', calls: [{ id: 'call', name, arguments: {} }] }));
    const before = simulation.get(sid);
    const result = await s.message(owner, c.id, { text: `Consult ${name}`, ai: { ...options, dataConsent: true, monitoring: monitoring() } }, signal());
    expect(result.messages.at(-1)?.toolsUsed).toEqual([{ name, status: 'ok' }]);
    expect(platform.listConversationSummaries(owner, mission)).toEqual([]);
    expect(simulation.get(sid)).toEqual(before);
  });
  it('uses only the owner sleep records and reports missing data rather than fabricating a reading', async () => {
    const other = profile('sofia-chen');
    platform.addSleep(other, mission, 100000, 200000, 4);
    const c = platform.startConversation(owner, mission, 'physical');
    const s = service(async input => {
      if (!input.exchanges.length) return { text: '', calls: [{ id: 'sleep', name: 'getRecentSleep', arguments: {} }] };
      expect(JSON.parse(input.exchanges[0].results[0].content).records).toEqual([]);
      return final('No own sleep records are available.');
    });
    await s.message(owner, c.id, { text: 'How was my sleep?', ai: { ...options, dataConsent: true } }, signal());
  });
  it('denies a different astronaut monitoring token before provider access', async () => {
    const c = platform.startConversation(profile('elena-torres'), mission, 'physical');
    await expect(service().message(profile('elena-torres'), c.id, { text: 'My pulse?', ai: { ...options, dataConsent: true, monitoring: monitoring() } }, signal())).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });
  it('discards a result after monitoring permission is revoked', async () => {
    const grant = monitoring(); const c = platform.startConversation(owner, mission, 'physical');
    await expect(service(async () => { tools.revoke(sid, grant.token); return final(); })
      .message(owner, c.id, { text: 'Hello', ai: { ...options, dataConsent: true, monitoring: grant } }, signal())).rejects.toThrow();
    expect(platform.ownedConversation(owner, c.id).messages).toHaveLength(1);
  });
  it('blocks concurrent turns and cancelled responses without persisting partial messages', async () => {
    const c = platform.startConversation(owner, mission, 'physical');
    let release!: () => void;
    const s = service(async () => { await new Promise<void>(r => { release = r; }); return final(); });
    const controller = new AbortController();
    const first = s.message(owner, c.id, { text: 'First', ai: options }, controller.signal);
    await expect(s.message(owner, c.id, { text: 'Second', ai: options }, signal())).rejects.toThrow();
    controller.abort(); release();
    await expect(first).rejects.toThrow();
    expect(platform.ownedConversation(owner, c.id).messages).toHaveLength(1);
  });
  it('generates a draft without sharing, then shares only edited approved text with the selected recipient', async () => {
    const c = platform.startConversation(owner, mission, 'emotional');
    platform.postConversationMessage(owner, c.id, 'PRIVATE-FULL-TEXT');
    const draft = await service().draft(owner, c.id, { locale: 'en', ai: options }, signal());
    expect(platform.listConversationSummaries(profile('alex-morgan'), mission)).toEqual([]);
    platform.approveSummary(owner, c.id, 'Edited approved summary', 'alex-morgan', draft.expectedMessages);
    const summaries = platform.listConversationSummaries(profile('alex-morgan'), mission);
    expect(summaries).toHaveLength(1);
    expect(JSON.stringify(summaries)).not.toContain('PRIVATE-FULL-TEXT');
    expect(platform.listConversationSummaries(profile('sofia-chen'), mission)).toEqual([]);
    expect(platform.listConversationSummaries(profile('elena-torres'), mission)).toEqual([]);
    expect(() => platform.ownedConversation(profile('alex-morgan'), c.id)).toThrow();
  });
  it('rejects stale approval and unauthorized recipients', async () => {
    const c = platform.startConversation(owner, mission, 'physical');
    platform.postConversationMessage(owner, c.id, 'Headache');
    expect(() => platform.approveSummary(owner, c.id, 'Summary', 'elena-torres', 3)).toThrow();
    expect(() => platform.approveSummary(owner, c.id, 'Summary', 'sofia-chen', 1)).toThrow();
    expect(platform.listConversationSummaries(owner, mission)).toEqual([]);
  });
  it('keeps existing local safety checks in control without contacting Gemini or notifying anyone', async () => {
    const c = platform.startConversation(owner, mission, 'emotional');
    const result = await service().message(owner, c.id, { text: "I can't breathe", locale: 'en', ai: options }, signal());
    expect(seen).toHaveLength(0);
    expect(result.messages.at(-1)?.text).toContain('has not notified anyone');
    expect(platform.listConversationSummaries(owner, mission)).toEqual([]);
  });
  it('explains actual authorized evidence locally on a provider 429', async () => {
    const c = platform.startConversation(owner, mission, 'physical');
    const result = await service(async () => { throw new ProviderError('rate_limit', 'Quota'); }).message(owner, c.id,
      { text: 'What is my latest heart rate?', locale: 'en', ai: { ...options, dataConsent: true, monitoring: monitoring() } }, signal());
    expect(result.messages.at(-1)).toMatchObject({ source: 'local', toolsUsed: [{ name: 'getLatestVitals', status: 'ok' }] });
    expect(result.messages.at(-1)?.text).toContain('68');
    expect(result.messages.at(-1)?.notice).toContain('rate_limit');
  });

});
