import { resolveProvider } from './provider';
import type { ConversationInput } from './space-conversation.contract';
const input = (): ConversationInput => ({
  system: 'System rules',
  user: 'Current message',
  history: [
    { role: 'user', content: 'I miss home' },
    { role: 'assistant', content: 'I hear you' },
  ],
  tools: [
    {
      name: 'getSupportOptions',
      description: 'Read only',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  exchanges: [],
  signal: new AbortController().signal,
});
describe('native conversation protocols', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['openai-compatible', 'anthropic'])(
    'preserves history and tool exchange IDs for %s',
    async (name) => {
      const first =
        name === 'anthropic'
          ? {
              content: [
                {
                  type: 'tool_use',
                  id: 'call-1',
                  name: 'getSupportOptions',
                  input: {},
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'getSupportOptions',
                          arguments: '{}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
      const last =
        name === 'anthropic'
          ? { content: [{ type: 'text', text: '{"respuesta":"Draft"}' }] }
          : { choices: [{ message: { content: '{"respuesta":"Draft"}' } }] };
      const fetcher = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(first)))
        .mockResolvedValueOnce(new Response(JSON.stringify(last)));
      const provider = resolveProvider({
        AI_PROVIDER: name,
        AI_API_KEY: 'fixture-private-key',
        AI_BASE_URL: 'https://example.test/v1',
        AI_MODEL: 'fixture',
      }).provider!;
      const request = input();
      const reply = await provider.converse!(request);
      expect(reply.calls).toEqual([
        { id: 'call-1', name: 'getSupportOptions', arguments: {} },
      ]);
      const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string) as {
        messages: { role: string; content: unknown }[];
      };
      expect(body.messages.filter((m) => m.role === 'assistant')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: 'I hear you' }),
        ]),
      );
      expect(JSON.stringify(body)).not.toContain('fixture-private-key');
      const result = await provider.converse!({
        ...request,
        exchanges: [
          {
            text: '',
            calls: reply.calls,
            results: [{ id: 'call-1', content: '{"notified":false}' }],
          },
        ],
      });
      expect(result.calls).toEqual([]);
      const follow = JSON.parse(fetcher.mock.calls[1][1]?.body as string) as {
        messages: Record<string, unknown>[];
      };
      if (name === 'anthropic')
        expect(follow.messages.at(-1)).toEqual({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: '{"notified":false}',
            },
          ],
        });
      else
        expect(follow.messages.at(-1)).toEqual({
          role: 'tool',
          tool_call_id: 'call-1',
          content: '{"notified":false}',
        });
    },
  );
  it('rejects malformed tool arguments and excessive call lists', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'x',
                    type: 'function',
                    function: {
                      name: 'getSupportOptions',
                      arguments: 'not JSON',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const provider = resolveProvider({ AI_API_KEY: 'fixture-key' }).provider!;
    await expect(provider.converse!(input())).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('maps timeout and cancellation without returning provider internals', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted)
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('Aborted'),
            );
          else
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Aborted'),
                ),
              {
                once: true,
              },
            );
        }),
    );
    const provider = resolveProvider({
      AI_API_KEY: 'fixture',
      AI_TIMEOUT_MS: '100',
    }).provider!;
    await expect(provider.converse!(input())).rejects.toMatchObject({
      code: 'timeout',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.converse!({ ...input(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
