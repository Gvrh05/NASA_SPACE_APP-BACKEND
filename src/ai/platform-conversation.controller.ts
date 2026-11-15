import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from '../platform/platform.service';
import { PlatformConversationService } from './platform-conversation.service';
import { requestSignal } from './ai.controller';
@Controller('api/platform/quiron')
export class PlatformConversationController {
  constructor(private readonly platform: PlatformService, private readonly conversation: PlatformConversationService) {}
  @Post(':conversationId/message')
  message(@Headers('x-helios-session') token: string, @Param('conversationId') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.conversation.message(this.platform.requireSession(token), id, body, requestSignal(req));
  }
  @Post(':conversationId/summary/draft')
  draft(@Headers('x-helios-session') token: string, @Param('conversationId') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.conversation.draft(this.platform.requireSession(token), id, body, requestSignal(req));
  }
}
