import type { ExecutionContext } from '@nestjs/common';
import { RequestRateGuard } from './request-rate.guard';

describe('AI request quota', () => {
  it('applies the AI budget to /api/ai and platform Quirón routes', () => {
    const previous = process.env.AI_RATE_LIMIT_PER_MINUTE;
    process.env.AI_RATE_LIMIT_PER_MINUTE = '2';
    try {
      const guard = new RequestRateGuard();
      const response = { setHeader: jest.fn() };
      const req = {
        method: 'POST',
        path: '/api/ai/analyze',
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(context)).toBe(true);
      req.path = '/api/platform/missions/mission-helios-demo/quiron';
      expect(guard.canActivate(context)).toBe(true);
      req.path = '/api/platform/quiron/conv-1/message';
      expect(() => guard.canActivate(context)).toThrow();
      expect(response.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(String),
      );
      // Role/profile select stays on the write budget, not the AI budget.
      req.path = '/api/platform/auth/select';
      expect(guard.canActivate(context)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AI_RATE_LIMIT_PER_MINUTE;
      else process.env.AI_RATE_LIMIT_PER_MINUTE = previous;
    }
  });
});

describe('write request quota', () => {
  it('protects monitoring and simulation writes with a shared client budget while retaining reads', () => {
    const previous = process.env.WRITE_RATE_LIMIT_PER_MINUTE;
    process.env.WRITE_RATE_LIMIT_PER_MINUTE = '2';
    try {
      const guard = new RequestRateGuard();
      const response = { setHeader: jest.fn() };
      const req = {
        method: 'POST',
        path: '/api/monitoring/measurements',
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(context)).toBe(true);
      req.path = '/api/simulation/actions';
      expect(guard.canActivate(context)).toBe(true);
      expect(() => guard.canActivate(context)).toThrow();
      expect(response.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(String),
      );
      req.method = 'GET';
      expect(guard.canActivate(context)).toBe(true);
    } finally {
      if (previous === undefined)
        delete process.env.WRITE_RATE_LIMIT_PER_MINUTE;
      else process.env.WRITE_RATE_LIMIT_PER_MINUTE = previous;
    }
  });
});
