import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage } from 'node:http';
import { requestContext } from './http-security';

export function configureHttp(app: NestExpressApplication) {
  app.use(requestContext);
  const isJson = (req: IncomingMessage) =>
    /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
      req.headers['content-type'] ?? '',
    );
  const path = (req: IncomingMessage) =>
    (req.url ?? '').split('?')[0].toLowerCase().replace(/\/+$/, '');
  // Select a single parser BEFORE decoding any body. Only session initialization/import keeps 10 MB.
  app.useBodyParser('json', {
    limit: '64kb',
    inflate: false,
    type: (req) => isJson(req) && /^\/api\/ai(?:\/|$)/.test(path(req)),
  });
  app.useBodyParser('json', {
    limit: '10mb',
    inflate: false,
    type: (req) => isJson(req) && path(req) === '/api/simulation',
  });
  app.useBodyParser('json', {
    limit: '256kb',
    inflate: false,
    type: (req) =>
      isJson(req) &&
      !/^\/api\/ai(?:\/|$)/.test(path(req)) &&
      path(req) !== '/api/simulation',
  });
}
