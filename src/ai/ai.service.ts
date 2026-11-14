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
    this.assertSize(parsed.data);
    const text = await this.complete(buildModelMessages(parsed.data), signal);
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
    this.assertSize(parsed.data);
    const text = await this.complete(buildSpaceMessages(parsed.data), signal);
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
    if (JSON.stringify(value).length > 32_000) {
      this.fail(413, 'invalid_request', 'El contexto supera el límite.');
    }
  }

  private async complete(
    messages: { system: string; user: string },
    signal: AbortSignal,
  ): Promise<string> {
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
    try {
      return await this.resolved.provider.complete({ ...messages, signal });
    } catch (error) {
      if (error instanceof ProviderError) {
        const status =
          error.code === 'rate_limit'
            ? 429
            : error.code === 'invalid_response'
              ? 422
              : error.code === 'network'
                ? 502
                : 504;
        this.fail(status, error.code, error.message);
      }
      if (error instanceof SyntaxError)
        this.fail(
          422,
          'invalid_response',
          'La respuesta del modelo no es JSON.',
        );
      this.fail(502, 'network', 'Falló la llamada al proveedor.');
    }
  }

  private fail(status: number, code: string, message: string): never {
    throw new HttpException({ code, message }, status);
  }
}
