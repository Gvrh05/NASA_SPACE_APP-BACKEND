import { z } from 'zod';
import type {
  ConversationInput,
  ConversationOutput,
} from './space-conversation.contract';
export function normalizeGeminiModelId(value: string): string {
  return value.replace(/^models\//, '');
}

export class ProviderError extends Error {
  readonly code:
    | 'timeout'
    | 'rate_limit'
    | 'network'
    | 'invalid_response'
    | 'aborted'
    | 'authentication'
    | 'model_unavailable'
    | 'invalid_request';

  constructor(code: ProviderError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'ProviderError';
  }
}

export interface ModelProvider {
  name: string;
  model: string;
  converse?(input: ConversationInput): Promise<ConversationOutput>;
  complete(input: {
    jsonSchema?: Record<string, unknown>;
    system: string;
    user: string;
    signal: AbortSignal;
  }): Promise<string>;
}

export interface ResolvedProvider {
  provider: ModelProvider | null;
  missing: string[];
  providerName: string;
  model: string;
}

export function resolveProvider(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProvider {
  const providerName = env.AI_PROVIDER?.trim() || 'openai-compatible';
  const baseUrl =
    env.AI_BASE_URL?.trim() ||
    (providerName === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai'
      : 'https://api.openai.com/v1');
  const gemini =
    providerName === 'gemini' ||
    /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/?$/.test(
      baseUrl,
    );
  const model =
    env.AI_MODEL?.trim() ||
    (gemini
      ? ''
      : providerName === 'anthropic'
        ? 'claude-3-5-haiku-latest'
        : 'gpt-4o-mini');
  const missing: string[] = [];
  const key = env.AI_API_KEY?.trim() ?? '';
  if (!key || /^(TU_|YOUR_|placeholder)/i.test(key)) missing.push('AI_API_KEY');
  if (gemini && !model) missing.push('AI_MODEL');
  if (
    providerName === 'gemini' &&
    !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/?$/.test(
      baseUrl,
    )
  )
    missing.push('AI_BASE_URL');
  if (missing.length) return { provider: null, missing, providerName, model };
  const timeoutMs = Number(env.AI_TIMEOUT_MS ?? 25000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    throw new Error('Invalid AI_TIMEOUT_MS');
  const provider =
    providerName === 'anthropic'
      ? anthropicProvider(key, model, timeoutMs)
      : openAiCompatibleProvider(
          key,
          baseUrl,
          model,
          timeoutMs,
          gemini,
          env.AI_REASONING_EFFORT?.trim(),
        );
  return { provider, missing, providerName, model };
}

function openAiCompatibleProvider(
  key: string,
  baseUrl: string,
  model: string,
  timeoutMs: number,
  gemini = false,
  effort?: string,
): ModelProvider {
  if (effort && !['minimal', 'low', 'medium', 'high', 'none'].includes(effort))
    throw new Error('Invalid AI_REASONING_EFFORT');
  return {
    name: gemini ? 'gemini' : 'openai-compatible',
    model,
    converse: (input) =>
      conversationRequest(
        gemini ? 'gemini' : 'openai-compatible',
        key,
        model,
        timeoutMs,
        baseUrl,
        input,
        effort,
      ),
    async complete({ system, user, signal, jsonSchema }) {
      if (gemini) {
        const result = await conversationRequest(
          'gemini',
          key,
          model,
          timeoutMs,
          baseUrl,
          {
            system,
            user,
            signal,
            history: [],
            tools: [],
            exchanges: [],
            responseSchema: jsonSchema,
          },
          effort,
        );
        if (result.calls.length || !result.text)
          throw new ProviderError(
            'invalid_response',
            'Expected structured text',
          );
        return result.text;
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1200,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: AbortSignal.any([signal, timeout]),
        },
      ).catch((error: unknown) => {
        throw mapFetchError(error, signal);
      });
      if (response.status === 429)
        throw new ProviderError(
          'rate_limit',
          'El proveedor limitó las solicitudes.',
        );
      if (!response.ok)
        throw new ProviderError(
          'network',
          `El proveedor respondió ${response.status}.`,
        );
      const body = (await readProviderJson(response)) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content)
        throw new ProviderError(
          'invalid_response',
          'El proveedor no devolvió contenido.',
        );
      return content;
    },
  };
}

function anthropicProvider(
  key: string,
  model: string,
  timeoutMs: number,
): ModelProvider {
  return {
    name: 'anthropic',
    model,
    converse: (input) =>
      conversationRequest('anthropic', key, model, timeoutMs, '', input),
    async complete({ system, user, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.any([signal, timeout]),
      }).catch((error: unknown) => {
        throw mapFetchError(error, signal);
      });
      if (response.status === 429)
        throw new ProviderError(
          'rate_limit',
          'El proveedor limitó las solicitudes.',
        );
      if (!response.ok)
        throw new ProviderError(
          'network',
          `El proveedor respondió ${response.status}.`,
        );
      const body = (await readProviderJson(response)) as {
        content?: { text?: string }[];
      };
      const content = body.content?.map((item) => item.text ?? '').join('');
      if (!content)
        throw new ProviderError(
          'invalid_response',
          'El proveedor no devolvió contenido.',
        );
      return content;
    },
  };
}

function mapFetchError(error: unknown, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal.aborted)
    return new ProviderError('aborted', 'La solicitud fue cancelada.');
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ProviderError('timeout', 'El proveedor no respondió a tiempo.');
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderError('aborted', 'La solicitud fue cancelada.');
  }
  return new ProviderError('network', 'No se pudo contactar al proveedor.');
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/** Bounds streamed provider responses, including those without Content-Length. */
export async function readProviderJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ProviderError('invalid_response', 'Empty provider response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new ProviderError(
        'invalid_response',
        'Provider response too large.',
      );
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const callsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(100),
      name: z.string().min(1).max(80),
      arguments: z.unknown(),
    }),
  )
  .max(4);
async function conversationRequest(
  provider: string,
  key: string,
  model: string,
  timeoutMs: number,
  baseUrl: string,
  input: ConversationInput,
  effort?: string,
): Promise<ConversationOutput> {
  const signal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  let body: Record<string, unknown>;
  if (provider === 'anthropic') {
    const messages: Record<string, unknown>[] = [
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: input.user },
    ];
    for (const exchange of input.exchanges) {
      messages.push({
        role: 'assistant',
        content: [
          ...(exchange.text ? [{ type: 'text', text: exchange.text }] : []),
          ...exchange.calls.map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.name,
            input: c.arguments,
          })),
        ],
      });
      messages.push({
        role: 'user',
        content: exchange.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
        })),
      });
    }
    body = {
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: input.system,
      messages,
      tools: input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    };
  } else {
    const messages: Record<string, unknown>[] = [
      { role: 'system', content: input.system },
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: input.user },
    ];
    for (const exchange of input.exchanges) {
      messages.push(
        exchange.providerMessage
          ? { ...exchange.providerMessage, role: 'assistant' }
          : {
              role: 'assistant',
              content: exchange.text || null,
              tool_calls: exchange.calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: {
                  name: c.name,
                  arguments: JSON.stringify(c.arguments),
                },
              })),
            },
      );
      messages.push(
        ...exchange.results.map((r) => ({
          role: 'tool',
          tool_call_id: r.id,
          ...(provider === 'gemini'
            ? { name: exchange.calls.find((c) => c.id === r.id)?.name }
            : {}),
          content: r.content,
        })),
      );
    }
    body = {
      model,
      max_tokens: 1200,
      temperature: 0.2,
      messages,
      tools: input.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };
  }
  if (provider === 'gemini') {
    body.reasoning_effort =
      effort ?? (model.startsWith('gemini-2.5-flash') ? 'none' : 'low');
    if (input.responseSchema)
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'helios_response', schema: input.responseSchema },
      };
    // No-argument Gemini declarations omit the empty object schema. Nest still
    // validates every requested argument against its strict empty Zod object.
    body.tools = input.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description },
    }));
    if (input.responseSchema) {
      const schema = { ...input.responseSchema };
      delete schema.$schema;
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'helios_response', schema },
      };
    }
    if (!input.tools.length) delete body.tools;
  }
  try {
    const response = await fetch(
      provider === 'anthropic'
        ? 'https://api.anthropic.com/v1/messages'
        : `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        signal,
        headers:
          provider === 'anthropic'
            ? {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              }
            : {
                Authorization: `Bearer ${key}`,
                'content-type': 'application/json',
              },
        body: JSON.stringify(body),
      },
    );
    if (response.status === 429)
      throw new ProviderError('rate_limit', 'Provider rate limit');
    if ([401, 403].includes(response.status))
      throw new ProviderError(
        'authentication',
        'Provider credentials rejected',
      );
    if (response.status === 404)
      throw new ProviderError(
        'model_unavailable',
        'Provider model unavailable',
      );
    if (response.status === 400)
      throw new ProviderError('invalid_request', 'Provider rejected request');
    if (!response.ok)
      throw new ProviderError('network', 'Provider unavailable');
    const payload = await readProviderJson(response);
    if (provider === 'anthropic') {
      const result = z
        .object({
          content: z
            .array(
              z.discriminatedUnion('type', [
                z.object({ type: z.literal('text'), text: z.string() }),
                z.object({
                  type: z.literal('tool_use'),
                  id: z.string(),
                  name: z.string(),
                  input: z.unknown(),
                }),
              ]),
            )
            .max(8),
        })
        .parse(payload);
      return {
        text: result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(''),
        calls: callsSchema.parse(
          result.content
            .filter((c) => c.type === 'tool_use')
            .map((c) => ({ id: c.id, name: c.name, arguments: c.input })),
        ),
      };
    }
    const result = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string().nullable().optional(),
              message: z
                .object({
                  content: z.string().nullable().optional(),
                  tool_calls: z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          type: z.literal('function'),
                          function: z
                            .object({
                              name: z.string(),
                              arguments: z.string().max(4000),
                            })
                            .passthrough(),
                        })
                        .passthrough(),
                    )
                    .max(4)
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .min(1),
      })
      .parse(payload);
    const choice = result.choices[0];
    if (
      choice.finish_reason &&
      !['stop', 'tool_calls'].includes(choice.finish_reason)
    )
      throw new ProviderError(
        'invalid_response',
        'Incomplete or blocked provider response',
      );
    const message = choice.message;
    return {
      ...(provider === 'gemini' ? { providerMessage: message } : {}),
      text: message.content ?? '',
      calls: callsSchema.parse(
        (message.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: JSON.parse(c.function.arguments) as unknown,
        })),
      ),
    };
  } catch (error) {
    if (signal.aborted)
      throw new ProviderError(
        input.signal.aborted ? 'aborted' : 'timeout',
        'Conversation request interrupted',
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new ProviderError('invalid_response', 'Invalid provider response');
    throw mapFetchError(error, input.signal);
  }
}
