import { Controller, Get, Headers, Module, Query } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module';
import { SimulationService } from '../simulation/simulation.service';
import { session } from '../simulation/simulation.controller';
import { historyQuerySchema, parse } from '../simulation/contracts';
import type { CrewId } from '../simulation/shared/types';
@Controller('api/history')
export class HistoryController {
  constructor(private readonly simulations: SimulationService) {}
  @Get() list(
    @Headers('x-simulation-id') sid: string,
    @Query() query: unknown,
  ) {
    const q = parse(historyQuerySchema, query);
    const state = this.simulations.get(session(sid)).state;
    const owners = new Map<string, CrewId | null>();
    for (const item of [
      ...state.measurements,
      ...state.symptoms,
      ...state.alerts,
      ...state.episodes,
      ...state.analyses,
      ...state.communications,
    ])
      owners.set(item.id, item.crewId);
    for (const item of state.measurements)
      owners.set(item.messageId, item.crewId);
    const events = [
      ...state.measurements.map((data) => ({
        type: 'measurement',
        at: data.measuredAt,
        crewId: data.crewId,
        data,
      })),
      ...state.symptoms.map((data) => ({
        type: 'symptom',
        at: data.reportedAt,
        crewId: data.crewId,
        data,
      })),
      ...state.alerts.map((data) => ({
        type: 'alert',
        at: data.updatedAt,
        crewId: data.crewId,
        data,
      })),
      ...state.analyses.map((data) => ({
        type: 'analysis',
        at: data.createdAt,
        crewId: data.crewId,
        data,
      })),
      ...state.communications.map((data) => ({
        type: 'communication',
        at: data.receivedAt ?? data.sentAt ?? data.queuedAt ?? data.createdAt,
        crewId: data.crewId,
        data,
      })),
      ...state.audit.map((data) => ({
        type: 'audit',
        at: data.at,
        crewId: owners.get(data.entityId) ?? null,
        data,
      })),
      ...state.rejected.map((data) => ({
        type: 'rejected',
        at: data.at,
        crewId: owners.get(data.messageId) ?? null,
        data,
      })),
    ]
      .filter(
        (e) =>
          (!q.crewId || e.crewId === q.crewId) &&
          (q.from === undefined || e.at >= q.from) &&
          (q.to === undefined || e.at <= q.to) &&
          (!q.type || e.type === q.type),
      )
      .sort((a, b) => a.at - b.at);
    return { simulated: true, events };
  }
}
@Module({ imports: [SimulationModule], controllers: [HistoryController] })
export class HistoryModule {}
