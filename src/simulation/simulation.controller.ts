import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import { PlatformService } from '../platform/platform.service';
import { envelopeSchema, parse } from './contracts';
import { SimulationService } from './simulation.service';

export function session(value: unknown): string {
  return parse(z.uuid(), value);
}

@Controller('api/simulation')
export class SimulationController {
  constructor(
    private readonly simulations: SimulationService,
    private readonly platform: PlatformService,
  ) {}

  private guardMission(heliosSession?: string, missionId?: string) {
    if (!missionId) return
    const profile = this.platform.requireSession(heliosSession)
    this.platform.assertMissionAccess(profile, missionId)
  }

  private aligned(sid: string, heliosSession?: string, missionId?: string) {
    const snapshot = this.simulations.get(session(sid));
    if (!missionId) return snapshot;
    const profile = this.platform.requireSession(heliosSession);
    return this.simulations.alignWithPlatform(
      session(sid),
      this.platform.simulatorContext(profile, missionId),
    );
  }

  @Post() initialize(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
    @Body() body: unknown,
  ) {
    this.guardMission(heliosSession, missionId)
    this.simulations.initialize(session(sid), body);
    return this.aligned(sid, heliosSession, missionId);
  }
  @Get() get(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
  ) {
    this.guardMission(heliosSession, missionId)
    return this.aligned(sid, heliosSession, missionId);
  }
  @Post('actions') action(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
    @Body() body: unknown,
  ) {
    this.guardMission(heliosSession, missionId)
    const input = parse(envelopeSchema, body);
    return this.simulations.action(
      session(sid),
      input.requestId,
      input.expectedRevision,
      input.action,
    );
  }
}
