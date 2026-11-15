import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AiService } from './ai.service';

@Controller('api/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('health')
  health() {
    return this.ai.health();
  }

  @Post('analyze')
  analyze(@Body() body: unknown, @Req() request: Request) {
    return this.ai.analyze(body, requestSignal(request), false);
  }

  @Post('chat')
  chat(@Body() body: unknown, @Req() request: Request) {
    return this.ai.analyze(body, requestSignal(request), true);
  }

  @Post('space')
  space(@Body() body: unknown, @Req() request: Request) {
    return this.ai.space(body, requestSignal(request));
  }
}

function requestSignal(request: Request): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  const response = request.res;
  const close = () => {
    if (!response?.writableFinished) controller.abort();
  };
  response?.once('close', close);
  response?.once('finish', () => {
    request.off('aborted', abort);
    response.off('close', close);
  });
  return controller.signal;
}
