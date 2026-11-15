import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  parse,
  stateSchema,
  actionSchema,
  initializeSchema,
} from './contracts';
import { reduce, type Action } from './domain/reduce';
import { createInitialState } from './domain/scenarios';
import { addAudit } from './domain/stateOps';
import { crewPosture, latestReliable } from './domain/selectors';
import { simulatorStage, type SimulatorMissionContext } from '../platform/missionLink';
import { DEMO_PROTOCOL_IDS } from './shared/protocols';
import { CREW } from './domain/crew';
import { ensureAlert } from './domain/messages';
import type { AppState, CrewId } from './shared/types';

export interface SessionSnapshot {
  state: AppState;
  revision: number;
  simulated: true;
}
interface StoredSession {
  version: 1;
  state: AppState;
  revision: number;
  requests: Record<string, string>;
}
const storedSchema = z
  .object({
    version: z.literal(1),
    state: stateSchema,
    revision: z.number().int().nonnegative(),
    requests: z.record(z.uuid(), z.string()),
  })
  .strict();

@Injectable()
export class SimulationService {
  private readonly directory = resolve(
    process.env.SIMULATION_DATA_DIR || './data/sessions',
  );

  initialize(sessionId: string, input: unknown): SessionSnapshot {
    const body = parse(initializeSchema, input);
    if (existsSync(this.file(sessionId))) return this.get(sessionId);
    const stored: StoredSession = {
      version: 1,
      state: body.initialState ?? createInitialState(body.scenarioId),
      revision: 0,
      requests: {},
    };
    this.save(sessionId, stored);
    return this.snapshot(stored);
  }

  /** Copia nombre, etapa y tripulación de la plataforma solo cuando difieren. */
  alignWithPlatform(sessionId: string, context: SimulatorMissionContext): SessionSnapshot {
    const stored = this.read(sessionId);
    const stage = simulatorStage(context.stage);
    const mission = stored.state.mission;
    const activities = context.activities.slice(0, 40).map((item) => item.slice(0, 200));
    const same =
      mission.id === context.id &&
      mission.name === context.name.slice(0, 4000) &&
      mission.destination === context.destination.slice(0, 4000) &&
      mission.stage === stage &&
      mission.durationDays === context.durationDays &&
      mission.crewCount === context.crewCount &&
      JSON.stringify(mission.activities) === JSON.stringify(activities);
    if (same) return this.snapshot(stored);
    return this.mutate(
      sessionId,
      randomUUID(),
      stored.revision,
      { type: 'align-platform-mission', missionId: context.id },
      (state) => {
        const next = {
          ...state,
          mission: {
            ...state.mission,
            id: context.id.slice(0, 3000),
            name: context.name.slice(0, 4000),
            destination: context.destination.slice(0, 4000),
            stage,
            durationDays: context.durationDays,
            crewCount: context.crewCount,
            activities,
            stageChangedAt: state.mission.stage === stage ? state.mission.stageChangedAt : state.clock.simulatedAt,
          },
        };
        return addAudit(next, {
          actor: state.role,
          action: 'align-platform-mission',
          entityId: context.id.slice(0, 3000),
          detail: stage,
        });
      },
    );
  }

  get(sessionId: string): SessionSnapshot {
    return this.snapshot(this.read(sessionId));
  }

  action(
    sessionId: string,
    requestId: string,
    revision: number,
    input: unknown,
  ): SessionSnapshot {
    const action = parse(actionSchema, input) as Action;
    return this.mutate(sessionId, requestId, revision, action, (state) => {
      this.authorize(state, action);
      const next = reduce(state, action);
      return action.type === 'tick' || action.type === 'setLink'
        ? evaluateMonitoring(next)
        : next;
    });
  }

  mutate(
    sessionId: string,
    requestId: string,
    revision: number,
    operation: unknown,
    change: (state: AppState) => AppState,
  ): SessionSnapshot {
    parse(z.uuid(), requestId);
    parse(z.number().int().nonnegative(), revision);
    const stored = this.read(sessionId);
    const hash = createHash('sha256')
      .update(JSON.stringify(operation))
      .digest('hex');
    const previous = stored.requests[requestId];
    if (previous) {
      if (previous !== hash)
        throw new ConflictException('requestId reutilizado con otro contenido');
      return this.snapshot(stored);
    }
    if (stored.revision !== revision)
      throw new ConflictException({
        code: 'revision_conflict',
        message: 'La sesión cambió. Recupera el estado antes de reintentar.',
      });
    const state = change(structuredClone(stored.state));
    const next: StoredSession = {
      ...stored,
      state: parse(stateSchema, state),
      revision: stored.revision + 1,
      requests: { ...stored.requests, [requestId]: hash },
    };
    this.save(sessionId, next);
    return this.snapshot(next);
  }

  private authorize(state: AppState, action: Action) {
    if (action.type === 'recordAnalysis' || action.type === 'appendChat') {
      const episodeId =
        action.type === 'recordAnalysis'
          ? action.record.episodeId
          : action.message.episodeId;
      const episode = state.episodes.find((e) => e.id === episodeId);
      if (!episode) throw new NotFoundException('Episodio desconocido');
      if (state.role === 'astronaut' && episode.crewId !== state.sessionCrewId)
        throw new ForbiddenException('Solo registros propios');
      const result =
        action.type === 'recordAnalysis'
          ? action.record.result
          : action.message.result;
      if (
        action.type === 'recordAnalysis' &&
        action.record.crewId !== episode.crewId
      )
        throw new BadRequestException('Astronauta incompatible con episodio');
      if (result) {
        const refs = {
          measurement: new Set(
            state.measurements
              .filter((m) => m.crewId === episode.crewId)
              .map((m) => m.id),
          ),
          symptom: new Set(
            state.symptoms
              .filter((m) => m.episodeId === episodeId)
              .map((m) => m.id),
          ),
          alert: new Set(
            state.alerts
              .filter((m) => m.crewId === episode.crewId)
              .map((m) => m.id),
          ),
          protocol: new Set(DEMO_PROTOCOL_IDS),
        };
        const resources = new Set(state.resources.map((r) => r.id));
        if (
          result.evidence.some((e) => !refs[e.refType].has(e.refId)) ||
          result.checks.some((c) => !refs.protocol.has(c.protocolId)) ||
          result.resources.some((r) => !resources.has(r.resourceId))
        )
          throw new BadRequestException(
            'El análisis cita referencias desconocidas',
          );
      }
    }
    if (
      action.type === 'selectEpisode' &&
      action.episodeId !== null &&
      !state.episodes.some((e) => e.id === action.episodeId)
    )
      throw new NotFoundException('Episodio desconocido');
    if (
      action.type === 'createCommunication' &&
      action.episodeId !== null &&
      !state.episodes.some(
        (e) => e.id === action.episodeId && e.crewId === action.crewId,
      )
    )
      throw new BadRequestException('Episodio incompatible con astronauta');

    if (
      'crewId' in action &&
      state.role === 'astronaut' &&
      action.crewId !== state.sessionCrewId &&
      action.type !== 'selectCrew'
    ) {
      throw new ForbiddenException(
        'El astronauta solo puede modificar sus propios registros',
      );
    }
    if (action.type === 'ackAlert') {
      const alert = state.alerts.find((a) => a.id === action.alertId);
      if (
        state.role === 'ops' ||
        (state.role === 'astronaut' && alert?.crewId !== state.sessionCrewId)
      )
        throw new ForbiddenException(
          'Reconocimiento no permitido para este rol simulado',
        );
    }
    if (
      action.type === 'setAlertStatus' ||
      action.type === 'resolveSensorAlert'
    ) {
      const alert = state.alerts.find((a) => a.id === action.alertId);
      if (!alert) throw new NotFoundException('Alerta desconocida');
      const sensor = ['quality', 'repeated', 'altered'].includes(alert.type);
      if (state.role !== 'medical' && !(sensor && state.role === 'ops'))
        throw new ForbiddenException('Gestión de alerta no permitida');
    }
    if (
      [
        'createCommunication',
        'updateCommunicationDraft',
        'transitionCommunication',
        'deliverQueued',
        'confirmReceived',
        'useResource',
        'adjustResource',
        'createResource',
        'updateResource',
      ].includes(action.type) &&
      state.role === 'astronaut'
    )
      throw new ForbiddenException('Se requiere rol médico u operaciones');
    if (action.type === 'updateCommunicationDraft') {
      const current = state.communications.find(
        (item) => item.id === action.id,
      );
      if (!current) throw new NotFoundException('Communication not found');
      if (current.status !== 'draft')
        throw new ConflictException('Only drafts can be edited');
      if (action.subject.trim().length < 3 || action.body.trim().length < 3) {
        throw new BadRequestException(
          'Subject and body must contain at least three non-padding characters',
        );
      }
    }
    if (action.type === 'addSymptom' && state.role === 'ops')
      throw new ForbiddenException('Operaciones no puede registrar síntomas');
  }

  private file(sessionId: string) {
    return resolve(this.directory, `${parse(z.uuid(), sessionId)}.json`);
  }
  private read(sessionId: string): StoredSession {
    const file = this.file(sessionId);
    if (!existsSync(file))
      throw new NotFoundException('Inicializa la sesión de simulación');
    // Un archivo dañado genera un error y se conserva para recuperación.
    return storedSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  }
  private save(sessionId: string, stored: StoredSession) {
    mkdirSync(this.directory, { recursive: true });
    const file = this.file(sessionId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(stored), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  private snapshot(stored: StoredSession): SessionSnapshot {
    return { state: stored.state, revision: stored.revision, simulated: true };
  }
}

export function evaluateMonitoring(state: AppState): AppState {
  let next = state;
  const now = state.clock.simulatedAt;
  for (const crew of CREW) {
    const posture = crewPosture(next, crew.id);
    const reliable = latestReliable(next, crew.id, 'heart_rate');
    if (!reliable)
      next = monitorAlert(
        next,
        crew.id,
        'missing',
        'Sin medición confiable reciente',
        posture.summary,
      );
    if (reliable && reliable.value > crew.baseline.hrMax)
      next = monitorAlert(
        next,
        crew.id,
        'change',
        'Cambio respecto a línea base',
        `${reliable.id}: ${posture.summary}`,
      );
  }
  if (state.link === 'down') {
    next = ensureAlert(next, {
      id: 'alert-comms-link',
      type: 'comms',
      status: 'active',
      crewId: null,
      sensorId: null,
      episodeId: null,
      title: 'Enlace con Tierra interrumpido',
      reason: 'Los mensajes en cola siguen pendientes. Comunicación simulada.',
      openedAt: now,
      updatedAt: now,
      astronautAck: false,
      source: 'system',
    });
  }
  return next;
}

function monitorAlert(
  state: AppState,
  crewId: CrewId,
  type: 'missing' | 'change',
  title: string,
  reason: string,
) {
  const now = state.clock.simulatedAt;
  const id = `alert-${type}-${crewId}`;
  if (state.alerts.some((a) => a.id === id && a.status !== 'closed'))
    return state;
  const previous = state.alerts.find((a) => a.id === id);
  const alert = {
    id,
    type,
    status: 'active' as const,
    crewId,
    sensorId: null,
    episodeId: null,
    title,
    reason,
    openedAt: now,
    updatedAt: now,
    astronautAck: false,
    source: 'system' as const,
  };
  const next = previous
    ? { ...state, alerts: state.alerts.map((a) => (a.id === id ? alert : a)) }
    : ensureAlert(state, alert);
  return addAudit(next, {
    actor: state.role,
    action: 'monitoring-alert',
    entityId: id,
    detail: reason,
  });
}
