import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { PlatformService } from '../platform/platform.service';
import { envelopeSchema, parse } from './contracts';
import { SimulationService } from './simulation.service';
import { session } from './session';

@Controller('api/simulation')
export class SimulationController {
  constructor(
    private readonly simulations: SimulationService,
    private readonly platform: PlatformService,
  ) {}

  private guardMission(heliosSession?: string, missionId?: string) {
    if (!missionId) return;
    const profile = this.platform.requireSession(heliosSession);
    this.platform.assertMissionAccess(profile, missionId);
  }

  @Post() initialize(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
    @Body() body: unknown,
  ) {
    this.guardMission(heliosSession, missionId);
    return this.simulations.initialize(session(sid), body);
  }

  @Get() get(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
  ) {
    this.guardMission(heliosSession, missionId);
    return this.simulations.get(session(sid));
  }

  @Post('actions') action(
    @Headers('x-simulation-id') sid: string,
    @Headers('x-helios-session') heliosSession: string | undefined,
    @Headers('x-helios-mission') missionId: string | undefined,
    @Body() body: unknown,
  ) {
    this.guardMission(heliosSession, missionId);
    const input = parse(envelopeSchema, body);
    return this.simulations.action(
      session(sid),
      input.requestId,
      input.expectedRevision,
      input.action,
    );
  }
}
