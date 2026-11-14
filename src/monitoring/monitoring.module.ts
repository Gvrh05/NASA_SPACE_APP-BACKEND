import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Post,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { SimulationModule } from '../simulation/simulation.module';
import {
  SimulationService,
  evaluateMonitoring,
} from '../simulation/simulation.service';
import { session } from '../simulation/simulation.controller';
import {
  crewId,
  kind,
  mutationSchema,
  packetSchema,
  parse,
} from '../simulation/contracts';
import { ingestLinkPacket } from '../simulation/domain/messages';
import {
  latestReliable,
  measurementsFor,
} from '../simulation/domain/selectors';
import { addAudit } from '../simulation/domain/stateOps';
import { crewById } from '../simulation/domain/crew';
const querySchema = z.object({ crewId, kind: kind.optional() }).strict();
const inputSchema = mutationSchema
  .extend({ simulated: z.literal(true), packet: packetSchema })
  .strict();
@Controller('api/monitoring')
export class MonitoringController {
  constructor(private readonly simulations: SimulationService) {}
  @Get('measurements') history(
    @Headers('x-simulation-id') sid: string,
    @Query() query: unknown,
  ) {
    const q = parse(querySchema, query);
    return {
      simulated: true,
      measurements: measurementsFor(
        this.simulations.get(session(sid)).state,
        q.crewId,
        q.kind,
      ),
    };
  }
  @Get('latest') latest(
    @Headers('x-simulation-id') sid: string,
    @Query() query: unknown,
  ) {
    const q = parse(querySchema.extend({ kind }), query);
    const state = this.simulations.get(session(sid)).state;
    const measurement = latestReliable(state, q.crewId, q.kind) ?? null;
    const baseline = crewById(q.crewId).baseline;
    const ranges = {
      heart_rate: [baseline.hrMin, baseline.hrMax],
      spo2: [baseline.spo2Min, baseline.spo2Max],
      temperature: [baseline.tempMin, baseline.tempMax],
      respiratory_rate: [baseline.respMin, baseline.respMax],
      sleep_hours: [baseline.sleepMin, baseline.sleepMax],
    };
    const [min, max] = ranges[q.kind];
    return {
      simulated: true,
      measurement,
      comparison: measurement
        ? {
            min,
            max,
            deltaFromMinimum: measurement.value - min,
            deltaFromMaximum: measurement.value - max,
          }
        : null,
      humanReviewRequired: true,
    };
  }
  @Post('measurements') create(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    const input = parse(inputSchema, body);
    return this.simulations.mutate(
      session(sid),
      input.requestId,
      input.expectedRevision,
      { type: 'ingest', packet: input.packet },
      (state) => {
        if (
          state.role === 'astronaut' &&
          input.packet.crewId !== state.sessionCrewId
        )
          throw new ForbiddenException('Solo mediciones propias');
        if (input.packet.receivedAt > state.clock.simulatedAt)
          throw new BadRequestException(
            'Fecha futura respecto al reloj simulado',
          );
        let next = ingestLinkPacket(state, input.packet);
        next = {
          ...next,
          measurements: next.measurements.map((m) =>
            m.messageId === input.packet.messageId && m.signalQuality === 0
              ? { ...m, integrity: 'pending' as const }
              : m,
          ),
        };
        next = addAudit(next, {
          actor: state.role,
          action: 'ingest-measurement',
          entityId: input.packet.messageId,
          detail:
            'Paquete simulado procesado. Consultar mediciones y rechazos para el resultado.',
        });
        return evaluateMonitoring(next);
      },
    );
  }
}
@Module({ imports: [SimulationModule], controllers: [MonitoringController] })
export class MonitoringModule {}
