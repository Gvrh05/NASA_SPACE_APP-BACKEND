import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import {
  historyQuerySchema,
  ingestSchema,
  latestQuerySchema,
  parseBody,
  parseQuery,
  rejectionsQuerySchema,
  summaryQuerySchema,
} from './monitoring.contracts';
import { MonitoringService } from './monitoring.service';

@Controller('api/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('measurements')
  history(@Headers('x-simulation-id') sid: string, @Query() query: unknown) {
    return this.monitoring.history(sid, parseQuery(historyQuerySchema, query));
  }

  @Get('latest')
  latest(@Headers('x-simulation-id') sid: string, @Query() query: unknown) {
    return this.monitoring.latest(sid, parseQuery(latestQuerySchema, query));
  }

  @Get('summary')
  summary(@Headers('x-simulation-id') sid: string, @Query() query: unknown) {
    return this.monitoring.summary(sid, parseQuery(summaryQuerySchema, query));
  }

  @Get('rejections')
  rejections(@Headers('x-simulation-id') sid: string, @Query() query: unknown) {
    return this.monitoring.rejections(
      sid,
      parseQuery(rejectionsQuerySchema, query),
    );
  }

  @Post('measurements')
  create(@Headers('x-simulation-id') sid: string, @Body() body: unknown) {
    return this.monitoring.ingest(sid, parseBody(ingestSchema, body));
  }
}
