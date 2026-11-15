import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { SimulationModule } from '../simulation/simulation.module';
import { SimulationService } from '../simulation/simulation.service';
import { session } from '../simulation/session';
import { crewId, mutationSchema, parse } from '../simulation/contracts';
@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly simulations: SimulationService) {}
  @Get() list(
    @Headers('x-simulation-id') sid: string,
    @Query() query: unknown,
  ) {
    const q = parse(
      z
        .object({
          crewId: crewId.optional(),
          status: z.enum(['active', 'following', 'closed']).optional(),
        })
        .strict(),
      query,
    );
    const state = this.simulations.get(session(sid)).state;
    return {
      simulated: true,
      alerts: state.alerts
        .filter(
          (a) =>
            (!q.crewId || a.crewId === q.crewId) &&
            (!q.status || a.status === q.status),
        )
        .map((alert) => ({
          ...alert,
          createdAt: alert.openedAt,
          evidence: {
            description: alert.reason,
            measurementIds: state.measurements
              .filter(
                (m) =>
                  m.crewId === alert.crewId &&
                  (!alert.sensorId || m.sensorId === alert.sensorId) &&
                  m.measuredAt <= alert.updatedAt,
              )
              .slice(-5)
              .map((m) => m.id),
            rejectedPacketIds: state.rejected
              .filter(
                (p) => p.sensorId === alert.sensorId && p.at <= alert.updatedAt,
              )
              .slice(-5)
              .map((p) => p.id),
          },
        })),
    };
  }
  @Post(':id/acknowledge') ack(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const q = parse(mutationSchema.strict(), body);
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      { type: 'ackAlert', alertId: id },
    );
  }
  @Post(':id/status') status(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const q = parse(
      mutationSchema
        .extend({ status: z.enum(['active', 'following', 'closed']) })
        .strict(),
      body,
    );
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      { type: 'setAlertStatus', alertId: id, status: q.status },
    );
  }
}
@Module({ imports: [SimulationModule], controllers: [AlertsController] })
export class AlertsModule {}
