import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { SimulationService } from '../simulation/simulation.service';
import { simulatedPinMatches } from '../simulation/domain/spaceAccess';
import {
  latestReliable,
  vitalTrends,
  measurementQuality,
  activeHealthAlerts,
} from '../simulation/domain/selectors';
import { crewById } from '../simulation/domain/crew';
import {
  accessSchema,
  DataUse,
  ToolName,
  toolArgumentsSchema,
  toolNames,
} from './space-conversation.contract';
interface Grant {
  sessionId: string;
  crewId: ReturnType<typeof accessSchema.parse>['crewId'];
  dataUse: DataUse;
  historyConsent: boolean;
  expires: number;
}
@Injectable()
export class SpaceToolsService {
  private readonly grants = new Map<string, Grant>();
  constructor(private readonly simulations: SimulationService) {}
  private key(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private state(sessionId: string) {
    if (!z.uuid().safeParse(sessionId).success)
      throw new UnauthorizedException();
    return this.simulations.get(sessionId).state;
  }
  issue(sessionId: string, body: unknown) {
    const parsed = accessSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const q = parsed.data;
    const state = this.state(sessionId);
    if (
      state.role !== 'astronaut' ||
      state.sessionCrewId !== q.crewId ||
      !simulatedPinMatches(q.crewId, q.pin)
    )
      throw new ForbiddenException();
    for (const [key, value] of this.grants)
      if (value.expires <= Date.now() || value.sessionId === sessionId)
        this.grants.delete(key);
    if (this.grants.size >= 2000) throw new ForbiddenException();
    const token = randomBytes(32).toString('hex');
    const grant: Grant = {
      sessionId,
      crewId: q.crewId,
      dataUse: q.dataUse,
      historyConsent: q.historyConsent,
      expires: Date.now() + 15 * 60000,
    };
    this.grants.set(this.key(token), grant);
    return { token, expiresAt: grant.expires, simulated: true };
  }
  authorize(sessionId: string, token: string) {
    const grant = this.grants.get(this.key(token || ''));
    if (!grant || grant.expires <= Date.now() || grant.sessionId !== sessionId)
      throw new UnauthorizedException();
    const state = this.state(sessionId);
    if (state.role !== 'astronaut' || state.sessionCrewId !== grant.crewId)
      throw new ForbiddenException();
    return { ...grant, dataUse: { ...grant.dataUse } };
  }
  revoke(sessionId: string, token: string) {
    this.authorize(sessionId, token);
    this.grants.delete(this.key(token));
    return { revoked: true };
  }
  allowed(grant: Grant) {
    return toolNames.filter(
      (n) =>
        n === 'getSupportOptions' ||
        (n === 'getRecentSleep' && grant.dataUse.sleep) ||
        ([
          'getLatestVitals',
          'getVitalTrends',
          'getMeasurementQuality',
        ].includes(n) &&
          grant.dataUse.pulse) ||
        (n === 'getActiveHealthAlerts' &&
          (grant.dataUse.pulse || grant.dataUse.symptoms)) ||
        (n === 'getMissionContext' && grant.dataUse.mission),
    );
  }
  context(sessionId: string, token: string) {
    const grant = this.authorize(sessionId, token);
    const state = this.state(sessionId);
    return {
      crewId: grant.crewId,
      crewName: crewById(grant.crewId).name,
      simulated: true,
      symptoms: grant.dataUse.symptoms
        ? state.symptoms
            .filter((s) => s.crewId === grant.crewId)
            .slice(-4)
            .map((s) => ({ id: s.id, symptoms: s.symptoms }))
        : [],
    };
  }
  execute(
    sessionId: string,
    token: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const grant = this.authorize(sessionId, token);
    if (!this.allowed(grant).includes(name as ToolName))
      throw new ForbiddenException();
    if (!toolArgumentsSchema.safeParse(args).success)
      throw new BadRequestException();
    const state = this.state(sessionId);
    signal.throwIfAborted();
    if (name === 'getVitalTrends')
      return { simulated: true, ...vitalTrends(state, grant.crewId) };
    if (name === 'getMeasurementQuality')
      return { simulated: true, ...measurementQuality(state, grant.crewId) };
    if (name === 'getActiveHealthAlerts')
      return {
        simulated: true,
        alerts: activeHealthAlerts(state, grant.crewId)
          .filter((a) =>
            a.type === 'change' ? grant.dataUse.pulse : grant.dataUse.symptoms,
          )
          .map((a) => ({
            id: a.id,
            type: a.type,
            status: a.status,
            openedAt: a.openedAt,
            updatedAt: a.updatedAt,
          })),
        note: 'Simulated findings; not diagnoses. Private text and reasons are omitted.',
      };
    if (name === 'getSupportOptions')
      return {
        simulated: true,
        options: ['Flight medical team', 'Trusted crew member'],
        notified: false,
      };
    if (name === 'getMissionContext')
      return {
        simulated: true,
        name: state.mission.name.slice(0, 120),
        stage: state.mission.stage,
        destination: state.mission.destination.slice(0, 120),
        link: state.link,
      };
    const kind = name === 'getRecentSleep' ? 'sleep_hours' : 'heart_rate';
    const m = latestReliable(state, grant.crewId, kind);
    return {
      simulated: true,
      measurement: m
        ? {
            id: m.id,
            kind: m.kind,
            value: m.value,
            unit: m.unit,
            measuredAt: m.measuredAt,
            integrity: m.integrity,
          }
        : null,
      note: 'Historical simulated evidence; not a diagnosis',
    };
  }
}
