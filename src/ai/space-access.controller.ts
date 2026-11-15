import { Body, Controller, Delete, Headers, Post } from '@nestjs/common';
import { SpaceToolsService } from './space-tools.service';
@Controller('api/space')
export class SpaceAccessController {
  constructor(private readonly tools: SpaceToolsService) {}
  @Post('access') issue(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    return this.tools.issue(sid, body);
  }
  @Delete('access') revoke(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-space-token') token: string,
  ) {
    return this.tools.revoke(sid, token);
  }
}
