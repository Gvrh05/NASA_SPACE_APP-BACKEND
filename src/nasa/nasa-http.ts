import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { z } from 'zod';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export function range(
  query: unknown,
  max: number,
  defaults: { startDate: string; endDate: string },
) {
  const result = z
    .object({
      startDate: day.default(defaults.startDate),
      endDate: day.default(defaults.endDate),
      type: z.enum(['SEP', 'FLR', 'CME']).optional(),
      instrument: z.enum(['REM-Lid', 'DosTel1', 'DosTel2']).default('REM-Lid'),
    })
    .strict()
    .safeParse(query);
  if (!result.success) throw new BadRequestException('Invalid NASA query');
  const q = result.data;
  const days = (Date.parse(q.endDate) - Date.parse(q.startDate)) / 86400000;
  if (days < 0 || days > max || Date.parse(q.endDate) > Date.now())
    throw new BadRequestException(
      `Date interval must be 0–${max} days, without future dates`,
    );
  return q;
}
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : Array.isArray(value)
      ? value.filter((v) => typeof v === 'string').join('; ') || null
      : null;
export function nasaLink(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' &&
      (url.hostname.endsWith('.nasa.gov') || url.hostname === 'nasa.gov')
      ? url.href
      : null;
  } catch {
    return null;
  }
}
@Injectable()
export class NasaHttp {
  private cache = new Map<
    string,
    { expires: number; fetchedAt: string; payload: unknown }
  >();
  private pending = new Map<
    string,
    Promise<{ payload: unknown; fetchedAt: string; cached: boolean }>
  >();
  private calls: number[] = [];
  private cooldown = 0;
  async get(url: string, timeoutMs = 12000) {
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now())
      return { ...cached, cached: true };
    const pending = this.pending.get(url);
    if (pending) return pending;
    const request = this.load(url, timeoutMs);
    this.pending.set(url, request);
    try {
      return await request;
    } finally {
      this.pending.delete(url);
    }
  }
  private async load(url: string, timeoutMs: number) {
    this.calls = this.calls.filter((t) => t > Date.now() - 60000);
    if (this.calls.length >= 20 || this.cooldown > Date.now())
      throw new HttpException('NASA request limit; retry later', 429);
    this.calls.push(Date.now());
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429) this.cooldown = Date.now() + 60000;
      if (!response.ok) throw new Error('upstream unavailable');
      // Stream limit also bounds responses without Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2000000) {
          await reader.cancel();
          throw new Error('response too large');
        }
        chunks.push(part.value);
      }
      const payload: unknown = JSON.parse(
        Buffer.concat(chunks).toString('utf8'),
      );
      const fetchedAt = new Date().toISOString();
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(url, { payload, fetchedAt, expires: Date.now() + 300000 });
      return { payload, fetchedAt, cached: false };
    } catch {
      throw new ServiceUnavailableException({
        code: 'nasa_unavailable',
        message:
          'NASA unavailable or response invalid. No substitute data generated.',
      });
    }
  }
}
export function provenance(
  source: string,
  sourceUrl: string,
  response: { fetchedAt: string; cached: boolean },
  historical: boolean,
) {
  return {
    source,
    sourceUrl,
    fetchedAt: response.fetchedAt,
    cached: response.cached,
    historical,
    simulated: false,
  };
}
