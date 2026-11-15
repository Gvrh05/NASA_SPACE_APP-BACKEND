import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  SimulationService,
  evaluateMonitoring,
} from '../simulation/simulation.service';
import { session } from '../simulation/session';
import { ingestLinkPacket } from '../simulation/domain/messages';
import {
  latestReliable,
  measurementsFor,
} from '../simulation/domain/selectors';
import { addAudit } from '../simulation/domain/stateOps';
import { crewById, type Baseline } from '../simulation/domain/crew';
import type {
  AppState,
  CrewId,
  Measurement,
  MeasurementKind,
} from '../simulation/shared/types';
import type {
  HistoryQuery,
  IngestInput,
  LatestQuery,
  RejectionsQuery,
  SummaryQuery,
} from './monitoring.contracts';

export const MONITORED_KINDS = [
  'heart_rate',
  'spo2',
  'temperature',
  'respiratory_rate',
  'sleep_hours',
] as const satisfies readonly MeasurementKind[];

export interface MeasurementComparison {
  min: number;
  max: number;
  deltaFromMinimum: number;
  deltaFromMaximum: number;
}

export function baselineRange(
  baseline: Baseline,
  kind: MeasurementKind,
): [number, number] {
  switch (kind) {
    case 'heart_rate':
      return [baseline.hrMin, baseline.hrMax];
    case 'spo2':
      return [baseline.spo2Min, baseline.spo2Max];
    case 'temperature':
      return [baseline.tempMin, baseline.tempMax];
    case 'respiratory_rate':
      return [baseline.respMin, baseline.respMax];
    case 'sleep_hours':
      return [baseline.sleepMin, baseline.sleepMax];
  }
}

export function compareToBaseline(
  measurement: Measurement,
  baseline: Baseline,
): MeasurementComparison {
  const [min, max] = baselineRange(baseline, measurement.kind);
  return {
    min,
    max,
    deltaFromMinimum: measurement.value - min,
    deltaFromMaximum: measurement.value - max,
  };
}

@Injectable()
export class MonitoringService {
  constructor(private readonly simulations: SimulationService) {}

  history(sid: string, query: HistoryQuery) {
    const state = this.state(sid);
    this.authorizeRead(state, query.crewId);
    const filtered = measurementsFor(state, query.crewId, query.kind).filter(
      (item) =>
        (query.from === undefined || item.measuredAt >= query.from) &&
        (query.to === undefined || item.measuredAt <= query.to) &&
        (query.integrity === undefined || item.integrity === query.integrity),
    );
    return {
      simulated: true as const,
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      humanReviewRequired: true as const,
      measurements: filtered.slice(query.offset, query.offset + query.limit),
    };
  }

  latest(sid: string, query: LatestQuery) {
    const state = this.state(sid);
    this.authorizeRead(state, query.crewId);
    const measurement = latestReliable(state, query.crewId, query.kind) ?? null;
    return {
      simulated: true as const,
      measurement,
      comparison: measurement
        ? compareToBaseline(measurement, crewById(query.crewId).baseline)
        : null,
      humanReviewRequired: true as const,
    };
  }

  summary(sid: string, query: SummaryQuery) {
    const state = this.state(sid);
    this.authorizeRead(state, query.crewId);
    const baseline = crewById(query.crewId).baseline;
    return {
      simulated: true as const,
      crewId: query.crewId,
      generatedAt: state.clock.simulatedAt,
      humanReviewRequired: true as const,
      kinds: MONITORED_KINDS.map((kind) => {
        const measurement = latestReliable(state, query.crewId, kind) ?? null;
        return {
          kind,
          measurement,
          comparison: measurement
            ? compareToBaseline(measurement, baseline)
            : null,
        };
      }),
    };
  }

  rejections(sid: string, query: RejectionsQuery) {
    const state = this.state(sid);
    if (query.crewId) this.authorizeRead(state, query.crewId);
    else this.authorizeAll(state);
    const filtered = state.rejected
      .filter(
        (item) =>
          (query.crewId === undefined || item.crewId === query.crewId) &&
          (query.reason === undefined || item.reason === query.reason) &&
          (query.from === undefined || item.at >= query.from) &&
          (query.to === undefined || item.at <= query.to),
      )
      .slice()
      .sort((a, b) => a.at - b.at);
    return {
      simulated: true as const,
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      humanReviewRequired: true as const,
      rejections: filtered.slice(query.offset, query.offset + query.limit),
    };
  }

  ingest(sid: string, input: IngestInput) {
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
          measurements: next.measurements.map((measurement) =>
            measurement.messageId === input.packet.messageId &&
            measurement.signalQuality === 0
              ? { ...measurement, integrity: 'pending' as const }
              : measurement,
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

  private state(sid: string): AppState {
    return this.simulations.get(session(sid)).state;
  }

  private authorizeRead(state: AppState, requested: CrewId) {
    if (state.role === 'astronaut' && requested !== state.sessionCrewId)
      throw new ForbiddenException('Solo lecturas propias');
  }

  private authorizeAll(state: AppState) {
    if (state.role === 'astronaut')
      throw new ForbiddenException(
        'El rol astronauta debe indicar su propio crewId',
      );
  }
}
