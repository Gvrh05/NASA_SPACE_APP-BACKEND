import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import { envelopeSchema, parse } from './contracts';
import { SimulationService } from './simulation.service';

export function session(value: unknown): string {
  return parse(z.uuid(), value);
}

@Controller('api/simulation')
export class SimulationController {
  constructor(private readonly simulations: SimulationService) {}
  @Post() initialize(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    return this.simulations.initialize(session(sid), body);
  }
  @Get() get(@Headers('x-simulation-id') sid: string) {
    return this.simulations.get(session(sid));
  }
  @Post('actions') action(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    const input = parse(envelopeSchema, body);
    return this.simulations.action(
      session(sid),
      input.requestId,
      input.expectedRevision,
      input.action,
    );
  }
}
