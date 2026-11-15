import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

function setting(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 10000)
    throw new Error(`Invalid security setting: ${name}`);
  return Number(raw);
}
@Injectable()
export class RequestRateGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly aiLimit = setting('AI_RATE_LIMIT_PER_MINUTE', 20);
  private readonly writeLimit = setting('WRITE_RATE_LIMIT_PER_MINUTE', 240);
  private readonly importLimit = setting('SESSION_RATE_LIMIT_PER_MINUTE', 20);
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const ai = /^\/api\/ai(?:\/|$)/.test(path);
    const imported = path === '/api/simulation';
    const group = ai ? 'ai' : imported ? 'session' : 'write';
    const limit = ai
      ? this.aiLimit
      : imported
        ? this.importLimit
        : this.writeLimit;
    // Express trusts no proxy by default. Never use caller-supplied session IDs or X-Forwarded-For here.
    const identity = createHash('sha256')
      .update(req.ip || req.socket.remoteAddress || 'unknown')
      .digest('hex');
    const key = `${group}:${identity}`;
    const now = Date.now();
    for (const [entry, window] of this.windows)
      if (window.resetAt <= now) this.windows.delete(entry);
    let window = this.windows.get(key);
    if (!window) {
      // Fail closed rather than evicting active clients and allowing quota resets.
      if (this.windows.size >= 10000) {
        res.setHeader('Retry-After', '60');
        throw new HttpException({ code: 'rate_limit' }, 429);
      }
      window = { count: 0, resetAt: now + 60000 };
      this.windows.set(key, window);
    }
    if (window.count >= limit) {
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))),
      );
      throw new HttpException({ code: 'rate_limit' }, 429);
    }
    window.count += 1;
    return true;
  }
}
