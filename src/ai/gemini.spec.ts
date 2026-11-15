import { resolveProvider, normalizeGeminiModelId } from './provider';
import type { ConversationInput } from './space-conversation.contract';
const env = {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  AI_MODEL: 'gemini-3.8-flash',
  AI_API_KEY: 'fixture-not-a-real-key',
};
const input = (): ConversationInput => ({
  system: 'Return JSON',
  user: 'Synthetic demo',
  history: [
    { role: 'user', content: 'Earlier' },
    { role: 'assistant', content: 'Reply' },
  ],
  tools: [
    {
      name: 'getRecentSleep',
      description: 'Read authorized synthetic sleep',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  exchanges: [],
  signal: new AbortController().signal,
  responseSchema: {
    type: 'object',
    properties: { respuesta: { type: 'string' } },
  },
});
const packet = (message: unknown, finish_reason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message, finish_reason }] }));
afterEach(() => jest.restoreAllMocks());
it('detects Google compatibility and requires an explicit model and real credential', () => {
  expect(resolveProvider(env).provider?.name).toBe('gemini');
  expect(resolveProvider({ ...env, AI_MODEL: '' }).missing).toContain(
    'AI_MODEL',
  );
  expect(
    resolveProvider({ ...env, AI_API_KEY: 'TU_GEMINI_API_KEY' }).provider,
  ).toBeNull();
  expect(
    resolveProvider({
      AI_PROVIDER: 'gemini',
      AI_MODEL: 'gemini-3.8-flash',
      AI_API_KEY: 'fixture',
    }).provider?.name,
  ).toBe('gemini');
});
it('preserves opaque call and message metadata through consecutive tool rounds', async () => {
  const calls = (id: string) => [
    {
      id,
      type: 'function',
      function: { name: 'getRecentSleep', arguments: '{}' },
      extra_content: { google: { thought_signature: 'opaque-' + id } },
    },
  ];
  const first = {
    role: 'assistant',
    content: null,
    extra_content: { google: { thought_signature: 'message-signature' } },
    tool_calls: calls('first'),
  };
  const second = {
    role: 'assistant',
    content: null,
    tool_calls: calls('second'),
  };
  const fetcher = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(packet(first, 'tool_calls'))
    .mockResolvedValueOnce(packet(second, 'tool_calls'))
    .mockResolvedValueOnce(packet({ content: '{"respuesta":"Final"}' }));
  const p = resolveProvider(env).provider!;
  const q = input();
  for (let i = 0; i < 2; i++) {
    const reply = await p.converse!(q);
    q.exchanges.push({
      text: reply.text,
      calls: reply.calls,
      providerMessage: reply.providerMessage,
      results: reply.calls.map((c) => ({
        id: c.id,
        content: '{"measurement":null}',
      })),
    });
  }
  const result = await p.converse!(q);
  expect(result.calls).toEqual([]);
  const body = JSON.parse(fetcher.mock.calls[2][1]?.body as string) as {
    messages: Record<string, unknown>[];
    response_format: unknown;
    reasoning_effort: string;
  };
  expect(body.messages).toEqual(expect.arrayContaining([first, second]));
  expect(body.reasoning_effort).toBe('low');
  expect(body.response_format).toMatchObject({ type: 'json_schema' });
  expect(body.messages.filter((m) => m.role === 'tool')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'getRecentSleep',
        tool_call_id: 'first',
      }),
    ]),
  );
  expect(JSON.stringify(body)).not.toContain(env.AI_API_KEY);
});
it('supports structured completion without tools', async () => {
  const fetcher = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(packet({ content: '{"respuesta":"ok"}' }));
  await resolveProvider(env).provider!.complete({
    system: 'JSON',
    user: 'Synthetic',
    signal: input().signal,
    jsonSchema: { type: 'object' },
  });
  const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string) as Record<
    string,
    unknown
  >;
  expect(body.tools).toBeUndefined();
  expect(body.response_format).toBeDefined();
  expect(body.max_tokens).toBe(1200);
});
it.each([
  [429, 'rate_limit'],
  [401, 'authentication'],
  [403, 'authentication'],
  [404, 'model_unavailable'],
  [400, 'invalid_request'],
  [503, 'network'],
])('maps HTTP %s without forwarding provider secrets', async (status, code) => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(
      new Response('upstream-sensitive-body', { status: Number(status) }),
    );
  await expect(
    resolveProvider(env).provider!.converse!(input()),
  ).rejects.toMatchObject({ code });
});
it.each(['length', 'content_filter'])(
  'rejects incomplete or blocked %s',
  async (reason) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        packet({ content: '{"respuesta":"partial"}' }, reason),
      );
    await expect(
      resolveProvider(env).provider!.converse!(input()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  },
);

it.each(['models/gemini-3.8-flash', 'gemini-3.8-flash'])(
  'normalizes Google model-list id %s',
  (value) => {
    expect(normalizeGeminiModelId(value)).toBe('gemini-3.8-flash');
  },
);
