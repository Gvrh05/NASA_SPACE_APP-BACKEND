import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type SecurityRequest = Request & {
  securityRequestId?: string;
  securityLogging?: boolean;
};
const logger = new Logger('HttpSecurity');
export function requestContext(
  req: SecurityRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.securityRequestId) req.securityRequestId = randomUUID();
  res.setHeader('X-Request-Id', req.securityRequestId);
  if (!req.securityLogging) {
    req.securityLogging = true;
    res.once('finish', () => {
      const route = req.route as unknown;
      const path =
        route &&
        typeof route === 'object' &&
        'path' in route &&
        typeof route.path === 'string'
          ? route.path
          : '/unmatched';
      const status = res.statusCode;
      const category =
        status === 429
          ? 'rate_limit'
          : status === 403
            ? 'access_denied'
            : status >= 500
              ? 'service_error'
              : status >= 400
                ? 'request_rejected'
                : 'request';
      const event = JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId: req.securityRequestId,
        method: req.method,
        route: path,
        status,
        category,
      });
      if (status === 429 || status === 403 || status >= 500) logger.warn(event);
      else logger.log(event);
    });
  }
  next();
}
const codes = new Set([
  'invalid_request',
  'invalid_response',
  'not_configured',
  'revision_conflict',
  'rate_limit',
  'timeout',
  'network',
  'aborted',
  'unknown_study',
  'nasa_unavailable',
  'osdr_unreachable',
]);
const statusCodes: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'revision_conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'invalid_response',
  429: 'rate_limit',
};
const messages: Record<number, string> = {
  400: 'Invalid request.',
  401: 'Authentication required.',
  403: 'Operation not permitted.',
  404: 'Resource not found.',
  409: 'State changed or request conflicts. Reload before retrying.',
  413: 'Request body exceeds the allowed size.',
  415: 'JSON content required.',
  422: 'The response could not be validated.',
  429: 'Request limit reached. Retry later.',
  500: 'Internal service error.',
  502: 'External service unavailable.',
  503: 'Service unavailable.',
  504: 'External service timed out.',
};
@Catch()
@Injectable()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<SecurityRequest>();
    const res = http.getResponse<Response>();
    if (!req.securityRequestId) requestContext(req, res, () => undefined);
    const parserType =
      exception && typeof exception === 'object' && 'type' in exception
        ? exception.type
        : null;
    const parserStatus =
      parserType === 'entity.too.large'
        ? 413
        : parserType === 'encoding.unsupported'
          ? 415
          : parserType === 'entity.parse.failed'
            ? 400
            : 500;
    const status =
      exception instanceof HttpException ? exception.getStatus() : parserStatus;
    const payload: unknown =
      exception instanceof HttpException ? exception.getResponse() : null;
    const candidate =
      payload && typeof payload === 'object' && 'code' in payload
        ? payload.code
        : null;
    const code =
      typeof candidate === 'string' && codes.has(candidate)
        ? candidate
        : (statusCodes[status] ??
          (status >= 500 ? 'service_error' : 'invalid_request'));
    if (!res.headersSent)
      res.status(status).json({
        statusCode: status,
        code,
        message: messages[status] ?? 'Request could not be completed.',
        requestId: req.securityRequestId,
      });
  }
}
