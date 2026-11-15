import { z } from 'zod';
import type {
  ConversationInput,
  ConversationOutput,
} from './space-conversation.contract';
import type { ModelProvider } from './provider';
import { crewById } from '../simulation/domain/crew';
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  analysisContextSchema,
  analysisResultSchema,
  buildModelMessages,
  buildSpaceMessages,
  checkAnalysisRefs,
  spaceContextSchema,
  spaceProposalSchema,
} from './contract';
import {
  extractJson,
  ProviderError,
  resolveProvider,
  type ResolvedProvider,
} from './provider';

export const AI_RUNTIME = 'AI_RUNTIME';

@Injectable()
export class AiService {
  private readonly resolved: ResolvedProvider;
  private inFlight = 0;
  private calls = 0;
  private resetAt = 0;

  constructor(@Optional() @Inject(AI_RUNTIME) resolved?: ResolvedProvider) {
    this.resolved = resolved ?? resolveProvider();
  }

  health() {
    return {
      configured: Boolean(this.resolved.provider),
      provider: this.resolved.providerName,
      model: this.resolved.model,
      missing: this.resolved.missing,
    };
  }

  async analyze(body: unknown, signal: AbortSignal, requireQuestion: boolean) {
    const parsed = analysisContextSchema.safeParse(body);
    if (!parsed.success)
      this.fail(
        400,
        'invalid_request',
        'El contexto no tiene la forma esperada.',
      );
    if (requireQuestion && !parsed.data.question?.trim()) {
      this.fail(400, 'invalid_request', 'Falta la pregunta.');
    }
    parsed.data.crewName = crewById(parsed.data.crewId).name;
    this.assertSize(parsed.data);
    const text = await this.complete(
      buildModelMessages(parsed.data),
      signal,
      z.toJSONSchema(analysisResultSchema),
    );
    const result = analysisResultSchema.safeParse(this.parseJson(text));
    if (!result.success)
      this.fail(
        422,
        'invalid_response',
        'La respuesta del modelo no cumple el esquema.',
      );
    const refs = checkAnalysisRefs(result.data, parsed.data);
    if (!refs.ok) {
      throw new HttpException(
        {
          code: 'invalid_response',
          message:
            'La respuesta cita identificadores que no están en el contexto.',
          unknown: refs.unknown,
        },
        422,
      );
    }
    return {
      source: 'model' as const,
      model: this.resolved.model,
      result: result.data,
    };
  }

  async space(body: unknown, signal: AbortSignal) {
    const parsed = spaceContextSchema.safeParse(body);
    if (!parsed.success)
      this.fail(
        400,
        'invalid_request',
        'El contexto no tiene la forma esperada.',
      );
    parsed.data.crewName = crewById(parsed.data.crewId).name;
    this.assertSize(parsed.data);
    const text = await this.complete(
      buildSpaceMessages(parsed.data),
      signal,
      z.toJSONSchema(spaceProposalSchema),
    );
    const result = spaceProposalSchema.safeParse(this.parseJson(text));
    if (!result.success)
      this.fail(
        422,
        'invalid_response',
        'La respuesta del modelo no cumple el esquema.',
      );
    return {
      source: 'model' as const,
      model: this.resolved.model,
      result: result.data,
    };
  }

  private parseJson(text: string): unknown {
    try {
      return extractJson(text);
    } catch {
      this.fail(
        422,
        'invalid_response',
        'La respuesta del modelo no es JSON válido.',
      );
    }
  }

  private assertSize(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 32_000) {
      this.fail(413, 'invalid_request', 'El contexto supera el límite.');
    }
  }

  private async complete(
    messages: { system: string; user: string },
    signal: AbortSignal,
    jsonSchema?: Record<string, unknown>,
  ): Promise<string> {
    return this.withBudget(async (provider) => {
      const text = await provider.complete({ ...messages, signal, jsonSchema });
      if (Buffer.byteLength(text, 'utf8') > 16000)
        this.fail(422, 'invalid_response', 'AI response exceeds allowed size');
      return text;
    });
  }
  async conversationTurn(
    input: ConversationInput,
  ): Promise<ConversationOutput> {
    return this.withBudget(async (provider) => {
      input.signal.throwIfAborted();
      const operation = provider.converse
        ? provider.converse(input)
        : provider
            .complete({
              system: input.system,
              user: JSON.stringify({
                ...(JSON.parse(input.user) as Record<string, unknown>),
                history: input.history,
              }),
              signal: input.signal,
            })
            .then((text) => ({ text, calls: [] }));
      const result = await interruptible(operation, input.signal);
      input.signal.throwIfAborted();
      if (
        Buffer.byteLength(JSON.stringify(result), 'utf8') > 32000 ||
        result.calls.length > 4
      )
        this.fail(422, 'invalid_response', 'AI response exceeds allowed size');
      return result;
    });
  }
  private async withBudget<T>(
    operation: (provider: ModelProvider) => Promise<T>,
  ): Promise<T> {
    if (!this.resolved.provider) {
      throw new HttpException(
        {
          code: 'not_configured',
          message: `El servicio de IA no está configurado. Falta: ${this.resolved.missing.join(', ') || 'AI_API_KEY'}.`,
          missing: this.resolved.missing,
        },
        503,
      );
    }
    const now = Date.now();
    if (now >= this.resetAt) {
      this.calls = 0;
      this.resetAt = now + 60000;
    }
    if (this.calls >= 60 || this.inFlight >= 2)
      this.fail(
        429,
        'rate_limit',
        'AI consumption limit reached. Retry later.',
      );
    this.calls += 1;
    this.inFlight += 1;
    try {
      return await operation(this.resolved.provider);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof ProviderError) {
        const status =
          error.code === 'rate_limit'
            ? 429
            : ['authentication', 'model_unavailable'].includes(error.code)
              ? 503
              : error.code === 'invalid_request'
                ? 502
                : error.code === 'invalid_response'
                  ? 422
                  : error.code === 'network'
                    ? 502
                    : 504;
        this.fail(
          status,
          error.code,
          'AI provider could not complete the request.',
        );
      }
      if (error instanceof SyntaxError)
        this.fail(
          422,
          'invalid_response',
          'La respuesta del modelo no es JSON.',
        );
      this.fail(502, 'network', 'Falló la llamada al proveedor.');
    } finally {
      this.inFlight -= 1;
    }
  }

  private fail(status: number, code: string, message: string): never {
    throw new HttpException({ code, message }, status);
  }
}

function interruptible<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const reason: unknown = signal.reason;
      const timeout =
        reason &&
        typeof reason === 'object' &&
        'name' in reason &&
        reason.name === 'TimeoutError';
      reject(
        new ProviderError(
          timeout ? 'timeout' : 'aborted',
          'Conversation interrupted',
        ),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(
          error instanceof Error
            ? error
            : new ProviderError('network', 'Provider failed'),
        );
      },
    );
  });
}
