import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException, ConflictException, type OnModuleInit } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { buildMissionPrepChecklist } from './prepPlan'
import { computePrepPercent, nid } from './seed'
import { applyAdministrativeClose, applyStart, evaluateStartOn } from './missionTransitions'
import { buildMissionReview, canSeeAppointment, presentAppointment } from './review'
import { parsePainBody, symptomSummary } from './pain-map'
import { stageAllows, stageDeniedMessage, type StageAction } from './stagePolicy'
import { type SimulatorMissionContext } from './missionLink'
import { PlatformStore } from './platform.store'
import { localCareReply } from './quiron-local'
import type {
  Appointment,
  Conversation,
  DemoRole,
  HealthGrant,
  HealthIndicatorReading,
  PainFollowUp,
  PainMapReport,
  Mission,
  MissionEnvironment,
  MissionStage,
  PrepItem,
  PrepStatus,
  Profile,
  SleepEpisode,
  SymptomReport,
  WakeCheck,
  UserMemory,
} from './types'

const SESSION_MS = 1000 * 60 * 60 * 12

const INDICATOR_KINDS: HealthIndicatorReading['kind'][] = [
  'heart_rate',
  'blood_pressure',
  'spo2',
  'glucose',
  'temperature',
  'respiratory_rate',
  'sleep_hours',
  'mood',
]

function normalizeEnvironment(value?: string | null): MissionEnvironment {
  const allowed: MissionEnvironment[] = ['spacecraft', 'space_station', 'rover', 'surface_base', 'training']
  if (value && allowed.includes(value as MissionEnvironment)) return value as MissionEnvironment
  return 'space_station'
}

function indicatorDefaults(kind: HealthIndicatorReading['kind']): {
  unit: string
  staleAfterMs: number
  bodyRegion: string | null
} {
  switch (kind) {
    case 'heart_rate':
      return { unit: 'bpm', staleAfterMs: 6 * 60 * 60 * 1000, bodyRegion: 'chest' }
    case 'blood_pressure':
      return { unit: 'mmHg', staleAfterMs: 12 * 60 * 60 * 1000, bodyRegion: 'arm' }
    case 'spo2':
      return { unit: '%', staleAfterMs: 6 * 60 * 60 * 1000, bodyRegion: 'hand' }
    case 'glucose':
      return { unit: 'mg/dL', staleAfterMs: 12 * 60 * 60 * 1000, bodyRegion: null }
    case 'temperature':
      return { unit: '°C', staleAfterMs: 12 * 60 * 60 * 1000, bodyRegion: null }
    case 'respiratory_rate':
      return { unit: 'rpm', staleAfterMs: 6 * 60 * 60 * 1000, bodyRegion: 'chest' }
    case 'sleep_hours':
      return { unit: 'h', staleAfterMs: 24 * 60 * 60 * 1000, bodyRegion: null }
    case 'mood':
      return { unit: 'mood_1_5', staleAfterMs: 24 * 60 * 60 * 1000, bodyRegion: null }
    default:
      return { unit: 'u', staleAfterMs: 24 * 60 * 60 * 1000, bodyRegion: null }
  }
}

@Injectable()
export class PlatformService implements OnModuleInit {
  private store = new PlatformStore()

  async onModuleInit() {
    await this.store.hydrateRemote()
  }

  storageStatus() {
    return this.store.status()
  }

  restoreDamaged(profile: Profile, name: string) {
    if (profile.demoRole !== 'chief') throw new ForbiddenException('Solo la jefatura puede restaurar la base')
    try {
      this.store.restoreDamaged(name)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'No se pudo restaurar')
    }
    return this.store.status()
  }

  simulatorContext(profile: Profile, missionId: string): SimulatorMissionContext {
    this.requireMembership(profile, missionId)
    const mission = this.store.get().missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    const crewCount = this.store.get().memberships.filter(
      (item) => item.missionId === missionId && item.status === 'active' && item.role !== 'ops',
    ).length
    return {
      id: mission.id,
      name: mission.name,
      destination: mission.destination,
      stage: mission.stage,
      durationDays: Math.max(1, mission.durationDays || 1),
      crewCount: Math.max(1, crewCount || mission.plannedCrewCount || 1),
      activities: (mission.activities || []).slice(0, 40),
    }
  }

  longitudinalUserLines(conversation: Conversation): string[] {
    const lines: string[] = []
    for (const other of this.store.get().conversations) {
      if (other.id === conversation.id || other.profileId !== conversation.profileId) continue
      if (other.missionId !== conversation.missionId || other.mode !== conversation.mode) continue
      for (const message of other.messages) {
        if (message.role !== 'user') continue
        const text = message.text.replace(/\s+/g, ' ').trim().slice(0, 180)
        if (text) lines.push(text)
      }
    }
    return lines.slice(-6)
  }

  listProfiles(): Profile[] {
    return this.store.get().profiles
  }

  selectProfile(profileId: string) {
    const profile = this.store.get().profiles.find((item) => item.id === profileId)
    if (!profile) throw new NotFoundException('Demo profile not found')
    const token = randomBytes(24).toString('hex')
    const now = Date.now()
    this.store.mutate((db) => {
      db.sessions = db.sessions.filter((session) => session.expiresAt > now)
      db.sessions.push({ token, profileId, createdAt: now, expiresAt: now + SESSION_MS })
      db.accessAudit.push({ id: nid(), missionId: null, actorProfileId: profileId, action: 'demo-select', detail: profile.displayName, createdAt: now })
    })
    return { token, profile, expiresAt: now + SESSION_MS }
  }

  requireSession(token: string | undefined): Profile {
    if (!token) throw new UnauthorizedException('Select a demo profile')
    const now = Date.now()
    const session = this.store.get().sessions.find((item) => item.token === token && item.expiresAt > now)
    if (!session) {
      const profileById = this.store.get().profiles.find((p) => p.id === token)
      if (profileById) return profileById

      const pastSession = this.store.get().sessions.find((item) => item.token === token)
      if (pastSession) {
        const p = this.store.get().profiles.find((item) => item.id === pastSession.profileId)
        if (p) {
          pastSession.expiresAt = now + SESSION_MS
          return p
        }
      }
      throw new UnauthorizedException('Demo session expired')
    }
    const profile = this.store.get().profiles.find((item) => item.id === session.profileId)
    if (!profile) throw new UnauthorizedException('Invalid profile')
    return profile
  }

  listMissionsFor(profile: Profile) {
    const db = this.store.get()
    const mine = db.memberships.filter((item) => item.profileId === profile.id && item.status === 'active')
    return mine.map((membership) => {
      const mission = db.missions.find((item) => item.id === membership.missionId)
      if (!mission) return null
      return { mission, membership }
    }).filter(Boolean)
  }

  getMission(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    const mission = db.missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    const members = db.memberships.filter((item) => item.missionId === missionId)
    const prepItems = db.prepItems.filter((item) => item.missionId === missionId)
    return { mission, members, prepItems, prepPercent: computePrepPercent(prepItems) }
  }

  createMission(profile: Profile, input: {
    name: string
    destination?: string
    environment?: Mission['environment']
    plannedStart?: string | null
    durationDays?: number
    plannedCrewCount?: number
    timezone?: string
    activities?: string[]
    commsNotes?: string
    storageNotes?: string
  }) {
    const now = Date.now()
    const id = `mission-${nid()}`
    const code = `H-${nid().slice(0, 6).toUpperCase()}`
    const environment = normalizeEnvironment(input.environment)
    const mission: Mission = {
      id,
      code,
      name: input.name.trim() || 'New mission',
      destination: input.destination?.trim() || '',
      environment,
      stage: 'draft',
      plannedStart: input.plannedStart ?? null,
      actualStart: null,
      actualReturn: null,
      durationDays: input.durationDays ?? 30,
      plannedCrewCount: Math.max(1, input.plannedCrewCount ?? 4),
      timezone: input.timezone || 'UTC',
      wakeHourUtc: 6,
      activities: input.activities ?? [],
      commsNotes: input.commsNotes ?? '',
      storageNotes: input.storageNotes ?? '',
      prepPercent: 0,
      rosterLocked: false,
      analysisStale: true,
      demoKey: null,
      simulated: false,
      closedAt: null,
      closedBy: null,
      createdBy: profile.id,
      createdAt: now,
      updatedAt: now,
    }
    this.store.mutate((db) => {
      db.missions.push(mission)
      db.memberships.push({ id: nid(), missionId: id, profileId: profile.id, role: 'chief', status: 'active', createdAt: now })
      db.invitations.push({ id: nid(), missionId: id, code, invitedRole: 'crew', requestedBy: null, status: 'open', createdAt: now })
      db.accessAudit.push({ id: nid(), missionId: id, actorProfileId: profile.id, action: 'mission-create', detail: mission.name, createdAt: now })
    })
    return this.getMission(profile, id)
  }

  private crewAddsBlocked(mission: Mission): string | null {
    if (mission.stage === 'aboard' || mission.stage === 'postmission' || mission.stage === 'archived' || mission.stage === 'cancelled') {
      return 'La misión ya desplegó. No se pueden agregar más astronautas.'
    }
    if (mission.rosterLocked) {
      return 'La tripulación está bloqueada. No se pueden agregar personas.'
    }
    return null
  }

  /** Checklist edits only while preparation is open. */
  private assertChecklistOpen(mission: Mission) {
    this.requireAction(mission, 'prep_write')
  }

  private requireAction(mission: Mission, action: StageAction) {
    if (!stageAllows(mission.stage, action)) {
      throw new BadRequestException(stageDeniedMessage(action, mission.stage))
    }
  }

  private missionIn(db: { missions: Mission[] }, missionId: string) {
    const mission = db.missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    return mission
  }

  private isDeployedStage(stage: MissionStage) {
    return (
      stage === 'aboard' ||
      stage === 'postmission' ||
      stage === 'archived' ||
      stage === 'cancelled'
    )
  }

  requestJoin(profile: Profile, code: string, requestedRole: Exclude<DemoRole, 'chief'> = 'crew') {
    const normalized = code.trim().toUpperCase()
    if (!normalized) throw new BadRequestException('Code required')
    const db = this.store.get()
    const mission = db.missions.find((item) => item.code.toUpperCase() === normalized)
    if (!mission) throw new NotFoundException('No mission matches that code. The code does not reveal health data.')
    const blocked = this.crewAddsBlocked(mission)
    if (blocked) throw new BadRequestException(blocked)
    const existing = db.memberships.find((item) => item.missionId === mission.id && item.profileId === profile.id)
    if (existing?.status === 'active') {
      return { missionId: mission.id, status: 'already_member' as const, membershipId: existing.id }
    }
    const now = Date.now()
    let membershipId = existing?.id || ''
    this.store.mutate((store) => {
      if (existing) {
        existing.status = 'pending'
        existing.role = requestedRole
        membershipId = existing.id
      } else {
        membershipId = nid()
        store.memberships.push({
          id: membershipId,
          missionId: mission.id,
          profileId: profile.id,
          role: requestedRole,
          status: 'pending',
          createdAt: now,
        })
      }
      store.invitations.push({
        id: nid(),
        missionId: mission.id,
        code: mission.code,
        invitedRole: requestedRole,
        requestedBy: profile.id,
        status: 'pending',
        createdAt: now,
      })
      store.accessAudit.push({
        id: nid(),
        missionId: mission.id,
        actorProfileId: profile.id,
        action: 'join-request',
        detail: requestedRole,
        createdAt: now,
      })
    })
    return {
      missionId: mission.id,
      membershipId,
      status: 'pending' as const,
      note: 'Request sent. Knowing the code does not grant access to health data or privileged roles.',
    }
  }

  decideJoin(chief: Profile, missionId: string, membershipId: string, accept: boolean) {
    this.requireRole(chief, missionId, ['chief'])
    const mission = this.store.get().missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    if (accept) {
      const blocked = this.crewAddsBlocked(mission)
      if (blocked) throw new BadRequestException(blocked)
    }
    const now = Date.now()
    this.store.mutate((db) => {
      const current = db.missions.find((item) => item.id === missionId)
      const membership = db.memberships.find((item) => item.id === membershipId && item.missionId === missionId)
      if (!membership) throw new NotFoundException('Request not found')
      membership.status = accept ? 'active' : 'left'
      if (accept && current && (current.stage === 'draft' || current.stage === 'preflight')) {
        current.analysisStale = true
        current.updatedAt = now
      }
      db.accessAudit.push({
        id: nid(),
        missionId,
        actorProfileId: chief.id,
        action: accept ? 'join-accept' : 'join-reject',
        detail: membership.profileId,
        createdAt: now,
      })
    })
    return this.getMission(chief, missionId)
  }

  updateMissionDraft(profile: Profile, missionId: string, patch: Partial<Mission>) {
    this.requireRole(profile, missionId, ['chief', 'ops'])
    this.store.mutate((db) => {
      const mission = db.missions.find((item) => item.id === missionId)
      if (!mission) throw new NotFoundException('Mission not found')
      this.requireAction(mission, 'configure')
      const nextDays = patch.durationDays ?? mission.durationDays
      const nextCrew = patch.plannedCrewCount ?? mission.plannedCrewCount
      const planChanged = nextDays !== mission.durationDays || nextCrew !== mission.plannedCrewCount
      const now = Date.now()
      Object.assign(mission, {
        name: patch.name ?? mission.name,
        destination: patch.destination ?? mission.destination,
        environment: patch.environment ? normalizeEnvironment(patch.environment) : mission.environment,
        plannedStart: patch.plannedStart ?? mission.plannedStart,
        durationDays: nextDays,
        plannedCrewCount: nextCrew,
        timezone: patch.timezone ?? mission.timezone,
        activities: patch.activities ?? mission.activities,
        commsNotes: patch.commsNotes ?? mission.commsNotes,
        storageNotes: patch.storageNotes ?? mission.storageNotes,
        analysisStale: planChanged ? true : mission.analysisStale,
        updatedAt: now,
      })
      // Si cambian días/personas: se mantiene lo que “tengo”, pero se desmarca verificación
      // (el % baja solo si el requerido sube y ya no alcanza).
      if (planChanged) {
        for (const item of db.prepItems) {
          if (item.missionId !== missionId) continue
          if (item.qtyRequired == null) continue
          if (item.status !== 'cargado_verificado') continue
          item.status = 'pendiente_revision'
          item.verifiedBy = null
          item.verifiedAt = null
          item.updatedAt = now
        }
        mission.prepPercent = computePrepPercent(
          db.prepItems.filter((row) => row.missionId === missionId),
        )
      }
    })
    return this.getMission(profile, missionId)
  }

  listPrep(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const items = this.store.get().prepItems.filter((item) => item.missionId === missionId)
    return { items, percent: computePrepPercent(items), canStart: this.evaluateStart(missionId).ok }
  }

  upsertPrep(profile: Profile, missionId: string, item: Partial<PrepItem> & { id?: string; title: string; category: string }) {
    this.requireRole(profile, missionId, ['chief', 'ops', 'medic'])
    const missionGate = this.store.get().missions.find((row) => row.id === missionId)
    if (!missionGate) throw new NotFoundException('Mission not found')
    this.assertChecklistOpen(missionGate)
    const now = Date.now()
    return this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'prep_write')
      const existing = item.id ? db.prepItems.find((row) => row.id === item.id && row.missionId === missionId) : undefined
      if (existing) {
        if (existing.critical && item.critical === false) {
          throw new BadRequestException('Criticality cannot be reduced without a versioned justification in this prototype')
        }
        Object.assign(existing, {
          title: item.title,
          category: item.category,
          description: item.description ?? existing.description,
          source: item.source ?? existing.source,
          status: item.status ?? existing.status,
          evidence: item.evidence ?? existing.evidence,
          applies: item.applies ?? existing.applies,
          qtyRequired: item.qtyRequired ?? existing.qtyRequired,
          qtyAvailable: item.qtyAvailable ?? existing.qtyAvailable,
          updatedAt: now,
        })
        if (item.qtyAvailable !== undefined) {
          existing.qtyAvailable = item.qtyAvailable
        }
        if (existing.qtyRequired != null && existing.qtyRequired > 0) {
          const have = Math.max(0, Number(existing.qtyAvailable ?? 0))
          if (have >= existing.qtyRequired) {
            existing.status = 'cargado_verificado'
            existing.qtyAvailable = existing.qtyRequired
            existing.verifiedBy = profile.id
            existing.verifiedAt = now
          } else {
            existing.status = 'pendiente_revision'
            existing.verifiedBy = null
            existing.verifiedAt = null
          }
        } else if (item.status === 'cargado_verificado') {
          existing.verifiedBy = profile.id
          existing.verifiedAt = now
        } else if (item.status) {
          existing.verifiedBy = null
          existing.verifiedAt = null
        }
      } else {
        db.prepItems.push({
          id: item.id || `${missionId}-${nid()}`,
          missionId,
          category: item.category,
          title: item.title,
          description: item.description ?? '',
          source: item.source ?? 'HELIOS planning',
          ownerProfileId: profile.id,
          qtyRequired: item.qtyRequired ?? null,
          qtyAvailable: item.qtyAvailable ?? null,
          critical: Boolean(item.critical),
          status: (item.status as PrepStatus) || 'propuesto',
          evidence: item.evidence ?? '',
          verifiedBy: null,
          verifiedAt: null,
          applies: item.applies ?? true,
          updatedAt: now,
        })
      }
      const mission = db.missions.find((row) => row.id === missionId)
      if (mission) {
        mission.prepPercent = computePrepPercent(db.prepItems.filter((row) => row.missionId === missionId))
        mission.updatedAt = now
      }
      return this.listPrep(profile, missionId)
    })
  }

  suggestPrep(profile: Profile, missionId: string) {
    this.requireRole(profile, missionId, ['chief', 'ops'])
    const mission = this.store.get().missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    if (mission.stage !== 'draft' && mission.stage !== 'preflight') {
      throw new BadRequestException('AI checklist analysis is only available before deployment (Draft or Preflight).')
    }
    const plan = buildMissionPrepChecklist(
      mission.plannedCrewCount,
      mission.durationDays,
    )
    const suggestions = plan.map((item) => ({
      key: item.key,
      title: item.title,
      category: item.category,
      reason: item.description,
      source: item.source,
      qty: item.qtyRequired,
      qtyLabel: item.qtyLabel,
      critical: item.critical,
      assumptions: item.qtyLabel
        ? `Cantidad planificada: ${item.qtyLabel}.`
        : 'Sin cantidad numérica; verificar procedimiento.',
    }))
    return {
      missionId,
      note: 'Checklist HELIOS según personas y días del plan. No son obligaciones NASA ni tratamientos.',
      rosterLocked: Boolean(mission.rosterLocked),
      analysisStale: Boolean(mission.analysisStale),
      stage: mission.stage,
      warning:
        'Si cambiás personas, días o tripulación después de analizar, tenés que volver a analizar antes de despegar. Podés marcar ítems en cualquier momento; el despliegue exige análisis al día y 80%+. Al despegar ya no se pueden agregar astronautas.',
      suggestions,
    }
  }

  /** Rebuilds checklist quantities from the plan and clears analysisStale. */
  commitAiPrep(profile: Profile, missionId: string, titles?: string[]) {
    this.requireRole(profile, missionId, ['chief', 'ops'])
    const mission = this.store.get().missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Mission not found')
    if (mission.stage !== 'draft' && mission.stage !== 'preflight') {
      throw new BadRequestException('Solo se puede analizar antes del despliegue.')
    }
    const { suggestions, note, warning } = this.suggestPrep(profile, missionId)
    const selected = titles?.length
      ? suggestions.filter((item) => titles.includes(item.title))
      : suggestions
    if (!selected.length) throw new BadRequestException('There are no checklist items to save')
    const now = Date.now()
    this.store.mutate((db) => {
      const current = db.missions.find((item) => item.id === missionId)
      if (!current) throw new NotFoundException('Mission not found')
      this.requireAction(current, 'begin_prep')
      const keepIds = new Set<string>()
      for (const item of selected) {
        const stableId = `${missionId}-plan-${item.key}`
        const existing =
          db.prepItems.find((row) => row.id === stableId) ||
          db.prepItems.find(
            (row) => row.missionId === missionId && row.title === item.title,
          )
        if (existing) {
          const prevQty = existing.qtyRequired
          const qtyChanged = prevQty !== item.qty
          existing.id = stableId
          existing.title = item.title
          existing.category = item.category
          existing.qtyRequired = item.qty
          existing.description = `${item.reason} ${item.assumptions}`.trim()
          existing.source = item.source
          existing.critical = item.critical
          existing.applies = true
          existing.updatedAt = now
          // Cantidad requerida distinta: conservar “tengo”, revalidar estado según alcance.
          if (qtyChanged) {
            const have = existing.qtyAvailable ?? 0
            if (item.qty != null && have >= item.qty) {
              existing.status = 'cargado_verificado'
              existing.qtyAvailable = item.qty
              existing.verifiedBy = profile.id
              existing.verifiedAt = now
            } else {
              existing.status = 'pendiente_revision'
              existing.verifiedBy = null
              existing.verifiedAt = null
            }
          }
          keepIds.add(existing.id)
          continue
        }
        db.prepItems.push({
          id: stableId,
          missionId,
          category: item.category,
          title: item.title,
          description: `${item.reason} ${item.assumptions}`.trim(),
          source: item.source,
          ownerProfileId: profile.id,
          qtyRequired: item.qty,
          qtyAvailable: null,
          critical: item.critical,
          status: 'pendiente_revision',
          evidence: '',
          verifiedBy: null,
          verifiedAt: null,
          applies: true,
          updatedAt: now,
        })
        keepIds.add(stableId)
      }
      // Drop duplicate/legacy prep rows for this mission so the list stays coherent.
      db.prepItems = db.prepItems.filter(
        (row) => row.missionId !== missionId || keepIds.has(row.id),
      )
      current.analysisStale = false
      if (current.stage === 'draft') current.stage = 'preflight'
      current.prepPercent = computePrepPercent(
        db.prepItems.filter((row) => row.missionId === missionId),
      )
      current.updatedAt = now
      db.accessAudit.push({
        id: nid(),
        missionId,
        actorProfileId: profile.id,
        action: 'ai-prep-commit',
        detail: `${selected.length} items; analysis fresh`,
        createdAt: now,
      })
    })
    return {
      ...this.listPrep(profile, missionId),
      mission: this.getMission(profile, missionId).mission,
      note,
      warning,
      locked: false,
    }
  }

  evaluateStart(missionId: string) {
    return evaluateStartOn(this.store.get(), missionId)
  }

  startSimulatedMission(profile: Profile, missionId: string, confirm: boolean) {
    this.requireRole(profile, missionId, ['chief'])
    if (!confirm) throw new BadRequestException('The Mission Commander must confirm the start')
    const evaluation = this.store.mutate((db) => applyStart(db, missionId, profile.id, Date.now()))
    return { ...this.getMission(profile, missionId), evaluation }
  }

  setStage(profile: Profile, missionId: string, stage: MissionStage) {
    const isDemoMission = missionId.startsWith('mission-demo-') || missionId.includes('demo')
    if (!isDemoMission) {
      this.requireRole(profile, missionId, ['chief', 'ops'])
      if (stage === 'aboard') throw new BadRequestException('Usá startSimulatedMission para pasar a bordo')
    }
    this.store.mutate((db) => {
      const mission = db.missions.find((item) => item.id === missionId)
      if (!mission) throw new NotFoundException('Mission not found')
      if (isDemoMission) {
        mission.stage = stage
        if (stage === 'aboard' || stage === 'postmission' || stage === 'archived') {
          mission.rosterLocked = true
        } else {
          mission.rosterLocked = false
        }
        if (stage === 'postmission') {
          applyAdministrativeClose(db, missionId, profile.id, Date.now())
        }
        mission.updatedAt = Date.now()
        return
      }
      if (stage === 'postmission') {
        this.requireAction(mission, 'close_mission')
        applyAdministrativeClose(db, missionId, profile.id, Date.now())
        return
      }
      const order: MissionStage[] = [
        'draft',
        'preflight',
        'aboard',
        'postmission',
        'archived',
        'cancelled',
      ]
      const from = order.indexOf(mission.stage)
      const to = order.indexOf(stage)
      if (to < 0) throw new BadRequestException('Etapa inválida')
      if (this.isDeployedStage(mission.stage) && (stage === 'draft' || stage === 'preflight')) {
        throw new BadRequestException(
          'Checklist cerrado de forma definitiva. No se puede volver a preembarque ni reabrir la preparación.',
        )
      }
      if (
        from >= 0 &&
        to < from &&
        mission.stage !== 'cancelled' &&
        stage !== 'cancelled'
      ) {
        throw new BadRequestException(
          'No se puede retroceder de etapa. El proceso de misión es solo hacia adelante.',
        )
      }
      mission.stage = stage
      if (this.isDeployedStage(stage)) {
        mission.rosterLocked = true
        mission.analysisStale = false
      }
      mission.updatedAt = Date.now()
    })
    return this.getMission(profile, missionId)
  }

  // --- Health daily ---
  getOrCreateWakeCheck(profile: Profile, missionId: string, justWoke = false) {
    this.requireMembership(profile, missionId)
    const periodKey = new Date().toISOString().slice(0, 10)
    const db = this.store.get()
    const mission = this.missionIn(db, missionId)
    let check = db.wakeChecks.find((item) => item.missionId === missionId && item.profileId === profile.id && item.periodKey === periodKey)
    const writable = stageAllows(mission.stage, 'clinical_write')
    if (!check && writable) {
      const now = Date.now()
      check = {
        id: nid(),
        missionId,
        profileId: profile.id,
        periodKey,
        status: 'pending',
        payload: {},
        createdAt: now,
      }
      this.store.mutate((store) => {
        const current = this.missionIn(store, missionId)
        this.requireAction(current, 'clinical_write')
        const already = store.wakeChecks.find((item) => item.missionId === missionId && item.profileId === profile.id && item.periodKey === periodKey)
        if (!already) store.wakeChecks.push(check as WakeCheck)
      })
    }
    const hour = new Date().getUTCHours()
    const prompt = writable && check?.status === 'pending' && (justWoke || hour >= (mission.wakeHourUtc ?? 6))
    return {
      check: check || null,
      justWoke,
      readOnly: !writable,
      prompt,
      note: !check ? 'read_only' : check.status === 'pending' ? 'Incomplete' : check.status,
    }
  }

  completeWakeCheck(profile: Profile, missionId: string, payload: Record<string, unknown>) {
    this.requireMembership(profile, missionId)
    const periodKey = new Date().toISOString().slice(0, 10)
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      let check = db.wakeChecks.find((item) => item.missionId === missionId && item.profileId === profile.id && item.periodKey === periodKey)
      if (!check) {
        check = { id: nid(), missionId, profileId: profile.id, periodKey, status: 'completed', payload, createdAt: Date.now() }
        db.wakeChecks.push(check)
      } else {
        check.status = 'completed'
        check.payload = payload
      }
    })
    return this.getOrCreateWakeCheck(profile, missionId)
  }

  /** Crew wake / daily check-ins for chief & care roles (aboard awareness). */
  listCrewWakeChecks(profile: Profile, missionId: string) {
    this.requireRole(profile, missionId, ['chief', 'medic', 'psychologist', 'ops'])
    const periodKey = new Date().toISOString().slice(0, 10)
    const db = this.store.get()
    const members = db.memberships.filter((item) => item.missionId === missionId && item.status === 'active')
    return {
      periodKey,
      items: members.map((member) => {
        const check = db.wakeChecks.find(
          (item) => item.missionId === missionId && item.profileId === member.profileId && item.periodKey === periodKey,
        )
        const person = db.profiles.find((row) => row.id === member.profileId)
        return {
          profileId: member.profileId,
          displayName: person?.displayName || member.profileId,
          role: member.role,
          status: check?.status || 'pending',
          payload: check?.payload || {},
          updatedAt: check?.createdAt || null,
        }
      }),
    }
  }

  addSleep(profile: Profile, missionId: string, startAt: number, endAt: number, quality: number | null, kind = 'nap') {
    this.requireMembership(profile, missionId)
    if (!(endAt > startAt)) throw new BadRequestException('Invalid interval')
    const episode: SleepEpisode = {
      id: nid(),
      missionId,
      profileId: profile.id,
      startAt,
      endAt,
      quality,
      kind,
      createdAt: Date.now(),
    }
    this.store.mutate((store) => {
      this.requireAction(this.missionIn(store, missionId), 'clinical_write')
      const clash = store.sleepEpisodes.some((item) =>
        item.missionId === missionId &&
        item.profileId === profile.id &&
        startAt < item.endAt &&
        endAt > item.startAt)
      if (clash) throw new BadRequestException('This interval overlaps another sleep episode')
      store.sleepEpisodes.push(episode)
    })
    return episode
  }

  listSleep(profile: Profile, missionId: string, subjectId?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'sleep')
    return this.store.get().sleepEpisodes.filter((item) => item.missionId === missionId && item.profileId === target)
  }

  addSymptom(profile: Profile, missionId: string, input: Omit<SymptomReport, 'id' | 'missionId' | 'profileId' | 'createdAt' | 'status'> & { status?: SymptomReport['status'] }) {
    this.requireMembership(profile, missionId)
    if (!input.description?.trim()) throw new BadRequestException('El síntoma necesita una descripción')
    const row: SymptomReport = {
      id: nid(),
      missionId,
      profileId: profile.id,
      description: input.description,
      startedAt: input.startedAt,
      intensity: input.intensity,
      context: input.context || '',
      source: input.source || 'self_report',
      bodyRegion: input.bodyRegion ?? null,
      status: input.status || 'open',
      createdAt: Date.now(),
    }
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      db.symptomReports.push(row)
    })
    return row
  }

  listSymptoms(profile: Profile, missionId: string, subjectId?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'symptoms')
    return this.store.get().symptomReports.filter((item) => item.missionId === missionId && item.profileId === target)
  }

  /**
   * Pain maps use the symptoms grant. The chief does not receive them by role.
   * Clinical notes are returned only to the person and to a medic with that grant.
   */
  listPainMaps(profile: Profile, missionId: string, subjectId?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'symptoms')
    const role = this.membership(profile.id, missionId)?.role
    const showNotes = profile.id === target || role === 'medic'
    return (this.store.get().painReports ?? [])
      .filter((item) => item.missionId === missionId && item.profileId === target)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((item) => (showNotes ? item : { ...item, clinicalNotes: [] }))
  }

  createPainMap(profile: Profile, missionId: string, input: unknown) {
    this.requireMembership(profile, missionId)
    const parsed = parsePainBody(input)
    const now = Date.now()
    const summary = symptomSummary(parsed.marks)
    const symptomId = nid()
    const report: PainMapReport = {
      id: nid(),
      missionId,
      profileId: profile.id,
      symptomReportId: symptomId,
      appointmentId: null,
      modelId: parsed.modelId,
      modelVersion: parsed.modelVersion,
      origin: 'self_report',
      status: 'open',
      marks: parsed.marks,
      revisions: [{ at: now, actorProfileId: profile.id, action: 'created', note: '', marks: parsed.marks }],
      clinicalNotes: [],
      followsReportId: null,
      createdAt: now,
      updatedAt: now,
    }
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      if (parsed.followsReportId) {
        const prior = db.painReports.find((item) => item.id === parsed.followsReportId && item.missionId === missionId && item.profileId === profile.id)
        if (!prior) throw new BadRequestException('The earlier report does not exist')
        report.followsReportId = prior.id
      }
      report.appointmentId = this.bindPainAppointment(db, missionId, profile.id, parsed.appointmentId)
      db.symptomReports.push({
        id: symptomId,
        missionId,
        profileId: profile.id,
        description: summary.description,
        startedAt: summary.startedAt,
        intensity: summary.intensity,
        context: summary.context,
        source: 'self_report',
        bodyRegion: summary.bodyRegion,
        status: 'open',
        createdAt: now,
      })
      db.painReports.push(report)
    })
    return report
  }

  private savedPain(report: PainMapReport | undefined): PainMapReport {
    if (!report) throw new BadRequestException('Invalid pain report')
    return report
  }

  correctPainMap(profile: Profile, missionId: string, reportId: string, input: unknown) {
    this.requireMembership(profile, missionId)
    const parsed = parsePainBody(input)
    let updated: PainMapReport | undefined
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      const report = db.painReports.find((item) => item.id === reportId && item.missionId === missionId)
      if (!report || report.profileId !== profile.id) throw new ForbiddenException('Only the person who reported this map can correct it')
      const now = Date.now()
      report.revisions.push({ at: now, actorProfileId: profile.id, action: 'corrected', note: '', marks: parsed.marks })
      report.marks = parsed.marks
      report.updatedAt = now
      if (parsed.appointmentId) report.appointmentId = this.bindPainAppointment(db, missionId, profile.id, parsed.appointmentId)
      const summary = symptomSummary(parsed.marks)
      const symptom = db.symptomReports.find((item) => item.id === report.symptomReportId)
      if (symptom) {
        symptom.description = summary.description
        symptom.startedAt = summary.startedAt
        symptom.intensity = summary.intensity
        symptom.context = summary.context
        symptom.bodyRegion = summary.bodyRegion
      }
      updated = report
    })
    return this.savedPain(updated)
  }

  setPainStatus(profile: Profile, missionId: string, reportId: string, status: string) {
    this.requireMembership(profile, missionId)
    if (status !== 'open' && status !== 'monitoring' && status !== 'resolved') {
      throw new BadRequestException('Invalid follow-up status')
    }
    const next = status as PainFollowUp
    let updated: PainMapReport | undefined
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      const report = db.painReports.find((item) => item.id === reportId && item.missionId === missionId)
      if (!report || report.profileId !== profile.id) throw new ForbiddenException('Only the person who reported this map can correct it')
      const previous = report.status
      if (previous === next) {
        updated = report
        return
      }
      const now = Date.now()
      report.revisions.push({
        at: now,
        actorProfileId: profile.id,
        action: 'status',
        note: `${previous} -> ${next}`,
        marks: report.marks,
      })
      report.status = next
      report.updatedAt = now
      const symptom = db.symptomReports.find((item) => item.id === report.symptomReportId)
      if (symptom) symptom.status = next
      updated = report
    })
    return this.savedPain(updated)
  }

  addPainClinicalNote(profile: Profile, missionId: string, reportId: string, body: string, appointmentId?: string | null) {
    this.requireMembership(profile, missionId)
    const noteBody = body.trim()
    if (noteBody.length < 3 || noteBody.length > 2000) throw new BadRequestException('The clinical note cannot be empty')
    const existing = this.store.get().painReports.find((item) => item.id === reportId && item.missionId === missionId)
    if (!existing) throw new NotFoundException('Pain report not found')
    if (existing.profileId === profile.id) {
      throw new ForbiddenException('The physician writes the clinical note. It does not replace the self-report')
    }
    if (this.membership(profile.id, missionId)?.role !== 'medic') {
      throw new ForbiddenException('Only the mission physician can add a clinical note')
    }
    this.requireHealthAccess(profile, missionId, existing.profileId, 'symptoms')
    const marksBefore = JSON.stringify(existing.marks)
    let updated: PainMapReport | undefined
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      const report = db.painReports.find((item) => item.id === reportId && item.missionId === missionId)
      if (!report) throw new NotFoundException('Pain report not found')
      const grant = db.healthGrants.find((item) =>
        item.missionId === missionId &&
        item.subjectProfileId === report.profileId &&
        item.granteeProfileId === profile.id &&
        !item.revokedAt &&
        item.categories.includes('symptoms') &&
        (!item.expiresAt || item.expiresAt > Date.now()) &&
        item.acceptedAt !== null)
      if (!grant) throw new ForbiddenException('The person has not authorized access to this category')
      const linked = appointmentId ? this.bindPainAppointment(db, missionId, report.profileId, appointmentId) : report.appointmentId
      const now = Date.now()
      report.clinicalNotes.push({
        id: nid(),
        authorProfileId: profile.id,
        appointmentId: linked,
        body: noteBody,
        createdAt: now,
      })
      if (linked && !report.appointmentId) {
        report.appointmentId = linked
        report.revisions.push({ at: now, actorProfileId: profile.id, action: 'linked', note: linked, marks: report.marks })
      }
      report.updatedAt = now
      if (JSON.stringify(report.marks) !== marksBefore) {
        throw new BadRequestException('A clinical note does not change the self-report')
      }
      updated = report
    })
    return this.savedPain(updated)
  }

  private bindPainAppointment(db: { appointments: Appointment[] }, missionId: string, subjectId: string, appointmentId: string | null) {
    if (!appointmentId) return null
    const row = db.appointments.find((item) => item.id === appointmentId && item.missionId === missionId)
    if (!row || row.requesterId !== subjectId) throw new BadRequestException('That visit does not belong to this person')
    return row.id
  }

  addHealthIndicator(
    profile: Profile,
    missionId: string,
    input: {
      kind: HealthIndicatorReading['kind']
      measuredAt?: number
      value: number
      valueSecondary?: number | null
      unit?: string
      origin?: HealthIndicatorReading['origin']
      context?: string
      quality?: HealthIndicatorReading['quality']
      staleAfterMs?: number
      notes?: string
      bodyRegion?: string | null
    },
  ) {
    this.requireMembership(profile, missionId)
    const kind = input.kind
    if (!INDICATOR_KINDS.includes(kind)) throw new BadRequestException('Tipo de indicador no válido')
    if (!Number.isFinite(input.value)) throw new BadRequestException('Valor inválido')

    if (kind === 'blood_pressure') {
      const diastolic = input.valueSecondary
      if (diastolic == null || !Number.isFinite(diastolic)) {
        throw new BadRequestException('La presión arterial requiere sistólica y diastólica')
      }
    }
    if (kind === 'mood') {
      if (input.value < 1 || input.value > 5) {
        throw new BadRequestException('El estado de ánimo es un autorreporte en escala 1–5')
      }
    }

    const defaults = indicatorDefaults(kind)
    const row: HealthIndicatorReading = {
      id: nid(),
      missionId,
      profileId: profile.id,
      kind,
      measuredAt: input.measuredAt && Number.isFinite(input.measuredAt) ? Number(input.measuredAt) : Date.now(),
      value: Number(input.value),
      valueSecondary: kind === 'blood_pressure' ? Number(input.valueSecondary) : input.valueSecondary ?? null,
      unit: input.unit?.trim() || defaults.unit,
      origin: input.origin || 'manual',
      context: input.context?.trim() || 'unspecified',
      quality: input.quality || 'unknown',
      staleAfterMs: input.staleAfterMs ?? defaults.staleAfterMs,
      notes: input.notes?.trim() || '',
      bodyRegion: input.bodyRegion ?? defaults.bodyRegion,
      createdAt: Date.now(),
    }
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      db.healthIndicators.push(row)
    })
    return row
  }

  listHealthIndicators(profile: Profile, missionId: string, subjectId?: string, kind?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'vitals')
    return this.store.get().healthIndicators
      .filter((item) => item.missionId === missionId && item.profileId === target && (!kind || item.kind === kind))
      .sort((a, b) => b.measuredAt - a.measuredAt)
  }

  // --- Grants ---
  grantHealth(subject: Profile, missionId: string, granteeProfileId: string, categories: string[], expiresAt: number | null, scopeNote = '') {
    this.requireMembership(subject, missionId)
    const membership = this.membership(subject.id, missionId)
    if (!membership) throw new ForbiddenException()
    const grantee = this.store.get().memberships.find((item) => item.missionId === missionId && item.profileId === granteeProfileId && item.status === 'active')
    if (!grantee || (grantee.role !== 'medic' && grantee.role !== 'psychologist')) {
      throw new BadRequestException('The recipient must be the mission Physician or Psychologist')
    }
    const grant: HealthGrant = {
      id: nid(),
      missionId,
      subjectProfileId: subject.id,
      granteeProfileId,
      categories,
      scopeNote,
      expiresAt,
      revokedAt: null,
      acceptedAt: Date.now(),
      createdAt: Date.now(),
    }
    this.store.mutate((db) => {
      this.requireAction(this.missionIn(db, missionId), 'clinical_write')
      db.healthGrants.push(grant)
      db.accessAudit.push({ id: nid(), missionId, actorProfileId: subject.id, action: 'grant-health', detail: `${granteeProfileId}:${categories.join(',')}`, createdAt: Date.now() })
    })
    return grant
  }

  revokeGrant(subject: Profile, grantId: string) {
    this.store.mutate((db) => {
      const grant = db.healthGrants.find((item) => item.id === grantId)
      if (!grant || grant.subjectProfileId !== subject.id) throw new ForbiddenException('Only the person who granted access can revoke it')
      const mission = db.missions.find((item) => item.id === grant.missionId)
      if (!mission || !stageAllows(mission.stage, 'clinical_write')) {
        throw new BadRequestException(stageDeniedMessage('clinical_write', mission?.stage || 'postmission'))
      }
      grant.revokedAt = Date.now()
      db.accessAudit.push({ id: nid(), missionId: grant.missionId, actorProfileId: subject.id, action: 'revoke-grant', detail: grantId, createdAt: Date.now() })
    })
    return { ok: true }
  }

  listGrants(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    return this.store.get().healthGrants.filter((item) =>
      item.missionId === missionId &&
      (item.subjectProfileId === profile.id || item.granteeProfileId === profile.id))
  }

  chiefShareSummary(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    return {
      sharesWithChief: ['mediciones permitidas', 'alertas operativas', 'seguimiento de checklist'],
      neverAutoShared: ['conversaciones emocionales con Quirón', 'notas clínicas', 'expediente completo'],
      note: 'The Mission Commander sees operational status under the stated policy, not private chats.',
    }
  }

  // --- Quirón conversations ---
  startConversation(profile: Profile, missionId: string, mode: 'physical' | 'emotional', locale: 'es' | 'en' = 'en') {
    this.requireMembership(profile, missionId)
    if (!['physical', 'emotional'].includes(mode)) throw new BadRequestException('Invalid conversation mode')
    const mission = this.missionIn(this.store.get(), missionId)
    if (mode === 'emotional') this.requireAction(mission, 'quiron_flight')
    else if (!stageAllows(mission.stage, 'quiron_prep') && !stageAllows(mission.stage, 'quiron_flight')) {
      throw new BadRequestException(stageDeniedMessage('quiron_prep', mission.stage))
    }
    const now = Date.now()
    const conversation: Conversation = {
      id: nid(),
      missionId,
      profileId: profile.id,
      mode,
      private: mode === 'emotional',
      messages: [{
        role: 'assistant',
        at: now,
        text: locale === 'en'
          ? mode === 'physical' ? 'What would you like to talk about or understand about your physical wellbeing?' : 'Would you like to talk about how you’re feeling, or get help requesting an appointment?'
          : mode === 'physical' ? '\u00bfDe qu\u00e9 te gustar\u00eda hablar o qu\u00e9 quieres entender sobre tu bienestar f\u00edsico?' : '\u00bfTe gustar\u00eda hablar sobre c\u00f3mo te sientes o recibir ayuda para solicitar una cita?',
      }],
      createdAt: now,
      updatedAt: now,
    }
    this.store.mutate((db) => db.conversations.push(conversation))
    return conversation
  }

  postConversationMessage(profile: Profile, conversationId: string, text: string) {
    const conversation = this.ownedConversation(profile, conversationId)
    return this.appendConversationTurn(profile, conversationId, text, {
      text: localCareReply(text, conversation.messages, 'es'), source: 'local',
    }, conversation.messages.length)
  }

  ownedConversation(profile: Profile, conversationId: string): Conversation {
    const conversation = this.store.get().conversations.find((item) => item.id === conversationId)
    if (!conversation || conversation.profileId !== profile.id) throw new ForbiddenException()
    this.requireMembership(profile, conversation.missionId)
    return structuredClone(conversation)
  }

  appendConversationTurn(profile: Profile, conversationId: string, text: string,
    reply: Omit<Conversation['messages'][number], 'role' | 'at'>, expectedMessages: number) {
    const conversation = this.ownedConversation(profile, conversationId)
    const mission = this.missionIn(this.store.get(), conversation.missionId)
    if (conversation.mode === 'emotional') this.requireAction(mission, 'quiron_flight')
    else if (!stageAllows(mission.stage, 'quiron_prep') && !stageAllows(mission.stage, 'quiron_flight')) {
      throw new BadRequestException(stageDeniedMessage('quiron_prep', mission.stage))
    }
    if (conversation.messages.length !== expectedMessages) throw new ConflictException('Conversation changed; retry')
    const now = Date.now()
    this.store.mutate((db) => {
      const row = db.conversations.find((item) => item.id === conversationId)!
      row.messages.push({ role: 'user', text, at: now }, { ...reply, role: 'assistant', at: now + 1 })
      row.updatedAt = now + 1
    })
    return this.ownedConversation(profile, conversationId)
  }

  approveSummary(profile: Profile, conversationId: string, body: string, shareWith: string | null, expectedMessages?: number) {
    const conversation = this.ownedConversation(profile, conversationId)
    if (!body.trim() || body.length > 2000) throw new BadRequestException('Invalid summary')
    if (expectedMessages !== undefined && conversation.messages.length !== expectedMessages) throw new ConflictException('Conversation changed; regenerate the draft')
    if (shareWith) {
      const recipient = this.membership(shareWith, conversation.missionId)
      if (!recipient || !['medic', 'psychologist'].includes(recipient.role)) throw new ForbiddenException('Choose an active medical or wellbeing professional')
    }
    const summary = {
      id: nid(),
      conversationId,
      body,
      approved: true,
      shareWith,
      createdAt: Date.now(),
    }
    this.store.mutate((db) => {
      db.conversationSummaries.push(summary)
      db.accessAudit.push({
        id: nid(),
        missionId: conversation.missionId,
        actorProfileId: profile.id,
        action: 'share-summary',
        detail: shareWith || 'none',
        createdAt: Date.now(),
      })
    })
    return summary
  }

  listConversationSummaries(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    const role = this.membership(profile.id, missionId)?.role
    return db.conversationSummaries.flatMap(summary => {
      const conversation = db.conversations.find(c => c.id === summary.conversationId && c.missionId === missionId)
      if (!conversation || !summary.approved) return []
      const owner = conversation.profileId === profile.id
      const recipient = summary.shareWith === profile.id && ['medic', 'psychologist'].includes(role || '')
      return owner || recipient ? [{ id: summary.id, body: summary.body, profileId: conversation.profileId, mode: conversation.mode, createdAt: summary.createdAt }] : []
    })
  }

  // --- Urgent + appointments ---
  urgentHelp(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    this.requireAction(this.missionIn(db, missionId), 'clinical_write')
    const protocol = db.protocols.find((item) => item.id === 'proto-urgent-v1')
    const professionals = db.memberships
      .filter((item) => item.missionId === missionId && item.status === 'active' && (item.role === 'medic' || item.role === 'psychologist' || item.role === 'chief'))
      .map((item) => db.profiles.find((profileRow) => profileRow.id === item.profileId))
      .filter(Boolean)
    this.store.mutate((store) => {
      this.requireAction(this.missionIn(store, missionId), 'clinical_write')
      store.accessAudit.push({
        id: nid(),
        missionId,
        actorProfileId: profile.id,
        action: 'urgent-help',
        detail: 'requested',
        createdAt: Date.now(),
      })
    })
    return {
      requested: true,
      received: false,
      protocol,
      professionals,
      limitation: 'Quirón does not improvise treatments. Follow the versioned protocol and contact a person.',
    }
  }

  requestAppointment(profile: Profile, missionId: string, input: {
    specialty: string
    professionalId?: string | null
    modality?: string
    reason?: string
    summary?: string
    scheduledAt?: number | null
    durationMin?: number
    timezone?: string
    shareCategories?: string[]
  }) {
    this.requireMembership(profile, missionId)
    const specialty = input.specialty === 'psychological' || input.specialty === 'psicologo' ? 'psychological' : input.specialty === 'medical' || input.specialty === 'medico' ? 'medical' : ''
    if (specialty !== 'medical' && specialty !== 'psychological') throw new BadRequestException('Choose medical or psychological care')
    if (!input.professionalId) throw new BadRequestException('Choose a professional on this mission')
    const reason = input.reason?.trim() || ''
    if (reason.length < 3) throw new BadRequestException('A reason is required')
    if (input.scheduledAt == null || !Number.isFinite(input.scheduledAt)) throw new BadRequestException('Choose a time')
    const durationMin = input.durationMin && input.durationMin >= 15 && input.durationMin <= 120 ? input.durationMin : 30
    const appointment = this.store.mutate((db) => {
      const mission = this.missionIn(db, missionId)
      this.requireAction(mission, 'clinical_write')
      const professional = db.memberships.find((item) => item.missionId === missionId && item.profileId === input.professionalId && item.status === 'active')
      const expected = specialty === 'medical' ? 'medic' : 'psychologist'
      if (!professional || professional.role !== expected) throw new BadRequestException('Ese profesional no cubre esta especialidad en la misión')
      this.assertSlotOpen(db, missionId, input.professionalId!, input.scheduledAt!, durationMin)
      const duplicate = db.appointments.some((item) =>
        item.missionId === missionId &&
        item.requesterId === profile.id &&
        item.professionalId === input.professionalId &&
        item.scheduledAt === input.scheduledAt &&
        item.status !== 'cancelled' &&
        item.status !== 'completed')
      if (duplicate) throw new ConflictException('An identical request already exists for that time')
      const now = Date.now()
      const row: Appointment = {
        id: nid(),
        missionId,
        requesterId: profile.id,
        professionalId: input.professionalId!,
        specialty,
        modality: input.modality || 'aboard',
        reason,
        summary: (input.summary || '').trim(),
        professionalNotes: '',
        shareCategories: input.shareCategories || [],
        status: 'requested',
        scheduledAt: input.scheduledAt!,
        durationMin,
        timezone: input.timezone || mission.timezone || 'UTC',
        outcome: '',
        cancelReason: '',
        followUpOf: null,
        history: [{ at: now, actorId: profile.id, action: 'request', from: null, to: 'requested', note: 'Waiting for the professional' }],
        simulated: false,
        createdAt: now,
        updatedAt: now,
      }
      db.appointments.push(row)
      return row
    })
    return { appointment, note: 'Request recorded. Confirmation requires valid acceptance.' }
  }

  confirmAppointment(profile: Profile, appointmentId: string, accept: boolean) {
    const saved = this.store.mutate((db) => {
      const appointment = this.appointmentIn(db, appointmentId)
      this.requireAction(this.missionIn(db, appointment.missionId), 'clinical_write')
      if (appointment.professionalId !== profile.id) throw new ForbiddenException('Only the assigned professional can respond')
      if (appointment.status !== 'requested' && appointment.status !== 'pending_confirm' && appointment.status !== 'rescheduled') {
        throw new BadRequestException('Esta cita ya no está pendiente de respuesta')
      }
      const from = appointment.status
      const now = Date.now()
      if (accept) {
        this.assertSlotOpen(db, appointment.missionId, appointment.professionalId!, appointment.scheduledAt || 0, appointment.durationMin || 30, appointment.id)
        appointment.status = 'confirmed'
        appointment.history.push({ at: now, actorId: profile.id, action: 'confirm', from, to: 'confirmed', note: 'Professional accepted the slot' })
      } else {
        appointment.status = 'cancelled'
        appointment.cancelReason = 'Professional declined'
        appointment.history.push({ at: now, actorId: profile.id, action: 'cancel', from, to: 'cancelled', note: 'Professional declined' })
      }
      appointment.updatedAt = now
      return appointment
    })
    return this.presentOne(profile, saved)
  }

  rescheduleAppointment(profile: Profile, appointmentId: string, scheduledAt: number) {
    if (!Number.isFinite(scheduledAt)) throw new BadRequestException('Choose a time')
    const saved = this.store.mutate((db) => {
      const appointment = this.appointmentIn(db, appointmentId)
      this.requireAction(this.missionIn(db, appointment.missionId), 'clinical_write')
      const allowed = appointment.professionalId === profile.id || appointment.requesterId === profile.id
      if (!allowed) throw new ForbiddenException('Solo paciente o profesional asignado pueden reprogramar')
      if (appointment.status === 'cancelled' || appointment.status === 'completed') throw new BadRequestException('Esta cita ya está cerrada')
      this.assertSlotOpen(db, appointment.missionId, appointment.professionalId!, scheduledAt, appointment.durationMin || 30, appointment.id)
      const from = appointment.status
      const now = Date.now()
      const isDoctor = appointment.professionalId === profile.id
      const note = isDoctor ? 'Professional updated the time slot' : 'Patient selected a new open time slot'
      appointment.scheduledAt = scheduledAt
      appointment.status = 'rescheduled'
      appointment.history.push({ at: now, actorId: profile.id, action: 'reschedule', from, to: 'rescheduled', note })
      appointment.updatedAt = now
      return appointment
    })
    return this.presentOne(profile, saved)
  }

  requestPatientReschedule(profile: Profile, appointmentId: string, note = '') {
    const saved = this.store.mutate((db) => {
      const appointment = this.appointmentIn(db, appointmentId)
      this.requireAction(this.missionIn(db, appointment.missionId), 'clinical_write')
      if (appointment.professionalId !== profile.id) throw new ForbiddenException('Solo el profesional asignado puede solicitar reprogramación')
      if (appointment.status === 'cancelled' || appointment.status === 'completed') throw new BadRequestException('Esta cita ya está cerrada')
      const from = appointment.status
      const now = Date.now()
      appointment.status = 'rescheduled'
      const historyNote = note.trim() || 'El médico solicitó reprogramar la cita. El paciente puede elegir un nuevo horario o cancelar.'
      appointment.history.push({ at: now, actorId: profile.id, action: 'reschedule_requested', from, to: 'rescheduled', note: historyNote })
      appointment.updatedAt = now
      return appointment
    })
    return this.presentOne(profile, saved)
  }

  cancelAppointment(profile: Profile, appointmentId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Indicá el motivo de la cancelación')
    const saved = this.store.mutate((db) => {
      const appointment = this.appointmentIn(db, appointmentId)
      this.requireAction(this.missionIn(db, appointment.missionId), 'clinical_write')
      const allowed = appointment.professionalId === profile.id || appointment.requesterId === profile.id
      if (!allowed) throw new ForbiddenException('Solo paciente o profesional pueden cancelar')
      if (appointment.status === 'cancelled' || appointment.status === 'completed') throw new BadRequestException('Esta cita ya está cerrada')
      const from = appointment.status
      const now = Date.now()
      appointment.status = 'cancelled'
      appointment.cancelReason = reason.trim()
      appointment.history.push({ at: now, actorId: profile.id, action: 'cancel', from, to: 'cancelled', note: reason.trim() })
      appointment.updatedAt = now
      return appointment
    })
    return this.presentOne(profile, saved)
  }

  completeAppointment(profile: Profile, appointmentId: string, outcome: string, professionalNotes = '') {
    if (!outcome.trim()) throw new BadRequestException('Registrá el resultado de la consulta')
    const saved = this.store.mutate((db) => {
      const appointment = this.appointmentIn(db, appointmentId)
      this.requireAction(this.missionIn(db, appointment.missionId), 'clinical_write')
      if (appointment.professionalId !== profile.id) throw new ForbiddenException('Solo el profesional asignado puede cerrar la consulta')
      if (appointment.status !== 'confirmed' && appointment.status !== 'rescheduled') {
        throw new BadRequestException('La consulta debe estar confirmada antes de registrar el resultado')
      }
      const from = appointment.status
      const now = Date.now()
      appointment.status = 'completed'
      appointment.outcome = outcome.trim()
      appointment.professionalNotes = professionalNotes.trim()
      appointment.history.push({ at: now, actorId: profile.id, action: 'complete', from, to: 'completed', note: 'Outcome recorded by the professional' })
      appointment.updatedAt = now
      return appointment
    })
    return this.presentOne(profile, saved)
  }

  listAppointments(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const role = this.membership(profile.id, missionId)?.role || 'crew'
    return this.store.get().appointments
      .filter((item) => item.missionId === missionId && canSeeAppointment(item, profile.id, role))
      .map((item) => presentAppointment(item, profile.id, role))
  }

  listSlots(profile: Profile, missionId: string, professionalId: string, day: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    const mission = this.missionIn(db, missionId)
    if (!stageAllows(mission.stage, 'clinical_write')) return { slots: [] as { start: number; label: string }[] }
    const date = new Date(`${day}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Fecha inválida')
    const window = db.availability.find((item) => item.missionId === missionId && item.profileId === professionalId)
      || { startMin: 8 * 60, endMin: 18 * 60, slotMin: 30, weekday: null as number | null }
    if (window.weekday != null && window.weekday !== date.getUTCDay()) return { slots: [] }
    const slots: { start: number; label: string }[] = []
    for (let minute = window.startMin; minute + 30 <= window.endMin; minute += window.slotMin || 30) {
      const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(minute / 60), minute % 60)
      const busy = db.appointments.some((item) => this.overlaps(item, professionalId, start, 30) && item.status !== 'cancelled')
      if (!busy) slots.push({ start, label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} UTC` })
    }
    return { slots }
  }

  missionReview(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    const role = this.membership(profile.id, missionId)?.role || 'crew'
    const live = buildMissionReview(db, missionId, profile.id, role)
    const versions = db.reviewReports
      .filter((item) => item.missionId === missionId)
      .map((item) => ({ id: item.id, version: item.version, createdAt: item.createdAt, generatedBy: item.generatedBy }))
    return { review: live, versions }
  }

  saveReviewVersion(profile: Profile, missionId: string) {
    this.requireRole(profile, missionId, ['chief'])
    return this.store.mutate((db) => {
      const mission = this.missionIn(db, missionId)
      this.requireAction(mission, 'review_generate')
      const version = db.reviewReports.filter((item) => item.missionId === missionId).length + 1
      const body = buildMissionReview(db, missionId, profile.id, 'chief')
      const report = {
        id: nid(),
        missionId,
        version,
        generatedBy: profile.id,
        createdAt: Date.now(),
        body,
      }
      db.reviewReports.push(report)
      return { id: report.id, version, createdAt: report.createdAt }
    })
  }

  listInventory(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const db = this.store.get()
    return {
      items: db.inventoryItems.filter((item) => item.missionId === missionId),
      movements: db.inventoryMovements.filter((item) => item.missionId === missionId),
    }
  }

  listMissionAlerts(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    return this.store.get().missionAlerts.filter((item) => item.missionId === missionId)
  }

  listEvidence() {
    return this.store.get().evidenceSources
  }

  assertMissionAccess(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
  }

  // --- helpers ---
  private membership(profileId: string, missionId: string) {
    return this.store.get().memberships.find((item) => item.profileId === profileId && item.missionId === missionId && item.status === 'active')
  }

  private requireMembership(profile: Profile, missionId: string) {
    if (!this.membership(profile.id, missionId)) throw new ForbiddenException('You are not a member of this mission')
  }

  private requireRole(profile: Profile, missionId: string, roles: DemoRole[]) {
    const membership = this.membership(profile.id, missionId)
    if (!membership || !roles.includes(membership.role)) throw new ForbiddenException('Your role does not allow this action in this mission')
  }

  private appointmentIn(db: { appointments: Appointment[] }, appointmentId: string) {
    const appointment = db.appointments.find((item) => item.id === appointmentId)
    if (!appointment) throw new NotFoundException('Appointment not found')
    return appointment
  }

  private presentOne(profile: Profile, appointment: Appointment) {
    const role = this.membership(profile.id, appointment.missionId)?.role || 'crew'
    return presentAppointment(appointment, profile.id, role)
  }

  private overlaps(item: Appointment, professionalId: string, start: number, durationMin: number, exceptId?: string) {
    if (exceptId && item.id === exceptId) return false
    if (item.professionalId !== professionalId || item.status === 'cancelled' || item.scheduledAt == null) return false
    const end = start + durationMin * 60_000
    const otherEnd = item.scheduledAt + (item.durationMin || 30) * 60_000
    return start < otherEnd && item.scheduledAt < end
  }

  private assertSlotOpen(
    db: { appointments: Appointment[]; availability: { missionId: string; profileId: string; weekday: number | null; startMin: number; endMin: number }[] },
    missionId: string,
    professionalId: string,
    start: number,
    durationMin: number,
    exceptId?: string,
  ) {
    const window = db.availability.find((item) => item.missionId === missionId && item.profileId === professionalId)
    if (window) {
      const date = new Date(start)
      const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
      if (window.weekday != null && window.weekday !== date.getUTCDay()) {
        throw new BadRequestException('Outside the professional’s availability')
      }
      if (minute < window.startMin || minute + durationMin > window.endMin) {
        throw new BadRequestException('Outside the professional’s availability')
      }
    }
    const clash = db.appointments.some((item) =>
      item.missionId === missionId && this.overlaps(item, professionalId, start, durationMin, exceptId))
    if (clash) throw new BadRequestException('That time slot is already booked')
  }

  private requireHealthAccess(viewer: Profile, missionId: string, subjectId: string, category: string) {
    const membership = this.membership(viewer.id, missionId)
    if (!membership) throw new ForbiddenException()
    if (membership.role === 'chief' && (category === 'vitals' || category === 'alerts')) return
    if (membership.role === 'chief') throw new ForbiddenException('The Mission Commander cannot access this clinical or private information')
    const now = Date.now()
    const grant = this.store.get().healthGrants.find((item) =>
      item.missionId === missionId &&
      item.subjectProfileId === subjectId &&
      item.granteeProfileId === viewer.id &&
      !item.revokedAt &&
      (!item.expiresAt || item.expiresAt > now) &&
      item.categories.includes(category) &&
      item.acceptedAt !== null)
    if (!grant) throw new ForbiddenException('The person has not authorized access to this category')
    this.store.mutate((db) => {
      db.accessAudit.push({
        id: nid(),
        missionId,
        actorProfileId: viewer.id,
        action: 'read-health',
        detail: `${subjectId}:${category}`,
        createdAt: Date.now(),
      })
    })
  }

  // --- Memories ---
  listMemories(profile: Profile): UserMemory[] {
    return this.store.get().userMemories
      .filter((item) => item.profileId === profile.id)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getMemory(profile: Profile, id: string): UserMemory {
    const memory = this.store.get().userMemories.find((item) => item.id === id)
    if (!memory) throw new NotFoundException('Memory not found')
    if (memory.profileId !== profile.id) throw new ForbiddenException('Access denied to private memory')
    return structuredClone(memory)
  }

  createMemory(profile: Profile, input: {
    title: string
    message: string
    imageBase64?: string | null
    imageContentType?: string | null
  }): UserMemory {
    const title = String(input.title || '').trim().slice(0, 100)
    if (!title) throw new BadRequestException('Title is required')
    const message = String(input.message || '').trim().slice(0, 500)

    let imageFileId: string | null = null
    let imageContentType: string | null = null

    if (input.imageBase64 && typeof input.imageBase64 === 'string') {
      let rawBase64 = input.imageBase64
      let detectedType = input.imageContentType || 'image/jpeg'
      if (rawBase64.startsWith('data:')) {
        const match = rawBase64.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          detectedType = match[1]
          rawBase64 = match[2]
        }
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!allowed.includes(detectedType.toLowerCase())) {
        throw new BadRequestException('Unsupported image type')
      }
      const buffer = Buffer.from(rawBase64, 'base64')
      if (buffer.length > 5 * 1024 * 1024) {
        throw new BadRequestException('Image exceeds 5MB limit')
      }
      const ext = detectedType.includes('png') ? 'png' : detectedType.includes('webp') ? 'webp' : detectedType.includes('gif') ? 'gif' : 'jpg'
      const fileId = `${nid()}.${ext}`
      this.store.saveMemoryFile(profile.id, fileId, buffer)
      imageFileId = fileId
      imageContentType = detectedType
    }

    const now = Date.now()
    const memory: UserMemory = {
      id: nid(),
      profileId: profile.id,
      title,
      message,
      imageFileId,
      imageContentType,
      imageBase64: input.imageBase64 || null,
      createdAt: now,
      updatedAt: now,
    }

    this.store.mutate((db) => {
      if (!Array.isArray(db.userMemories)) db.userMemories = []
      db.userMemories.push(memory)
    })
    return memory
  }

  updateMemory(profile: Profile, id: string, input: {
    title?: string
    message?: string
    imageBase64?: string | null
    imageContentType?: string | null
    removeImage?: boolean
  }): UserMemory {
    const memory = this.store.get().userMemories.find((item) => item.id === id)
    if (!memory) throw new NotFoundException('Memory not found')
    if (memory.profileId !== profile.id) throw new ForbiddenException('Access denied to private memory')

    let nextTitle = memory.title
    if (input.title !== undefined) {
      nextTitle = String(input.title).trim().slice(0, 100)
      if (!nextTitle) throw new BadRequestException('Title cannot be empty')
    }
    let nextMessage = memory.message
    if (input.message !== undefined) {
      nextMessage = String(input.message).trim().slice(0, 500)
    }

    let nextImageFileId = memory.imageFileId
    let nextImageContentType = memory.imageContentType
    let nextImageBase64 = memory.imageBase64 || null

    if (input.removeImage) {
      if (memory.imageFileId) {
        this.store.deleteMemoryFile(profile.id, memory.imageFileId)
      }
      nextImageFileId = null
      nextImageContentType = null
      nextImageBase64 = null
    } else if (input.imageBase64 && typeof input.imageBase64 === 'string') {
      let rawBase64 = input.imageBase64
      let detectedType = input.imageContentType || 'image/jpeg'
      if (rawBase64.startsWith('data:')) {
        const match = rawBase64.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          detectedType = match[1]
          rawBase64 = match[2]
        }
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!allowed.includes(detectedType.toLowerCase())) {
        throw new BadRequestException('Unsupported image type')
      }
      const buffer = Buffer.from(rawBase64, 'base64')
      if (buffer.length > 5 * 1024 * 1024) {
        throw new BadRequestException('Image exceeds 5MB limit')
      }
      if (memory.imageFileId) {
        this.store.deleteMemoryFile(profile.id, memory.imageFileId)
      }
      const ext = detectedType.includes('png') ? 'png' : detectedType.includes('webp') ? 'webp' : detectedType.includes('gif') ? 'gif' : 'jpg'
      const fileId = `${nid()}.${ext}`
      this.store.saveMemoryFile(profile.id, fileId, buffer)
      nextImageFileId = fileId
      nextImageContentType = detectedType
      nextImageBase64 = input.imageBase64
    }

    const now = Date.now()
    return this.store.mutate((db) => {
      const target = db.userMemories.find((item) => item.id === id)
      if (!target) throw new NotFoundException('Memory not found')
      target.title = nextTitle
      target.message = nextMessage
      target.imageFileId = nextImageFileId
      target.imageContentType = nextImageContentType
      target.imageBase64 = nextImageBase64
      target.updatedAt = now
      return structuredClone(target)
    })
  }

  deleteMemory(profile: Profile, id: string): { ok: boolean } {
    const memory = this.store.get().userMemories.find((item) => item.id === id)
    if (!memory) throw new NotFoundException('Memory not found')
    if (memory.profileId !== profile.id) throw new ForbiddenException('Access denied to private memory')

    if (memory.imageFileId) {
      this.store.deleteMemoryFile(profile.id, memory.imageFileId)
    }

    this.store.mutate((db) => {
      db.userMemories = db.userMemories.filter((item) => item.id !== id)
    })
    return { ok: true }
  }

  getMemoryImage(profile: Profile, id: string): { buffer: Buffer; contentType: string } {
    const memory = this.store.get().userMemories.find((item) => item.id === id)
    if (!memory) throw new NotFoundException('Memory not found')
    if (memory.profileId !== profile.id) throw new ForbiddenException('Access denied to private memory')
    if (!memory.imageFileId && !memory.imageBase64) throw new NotFoundException('Memory has no image')

    let buffer = memory.imageFileId ? this.store.getMemoryFile(profile.id, memory.imageFileId) : null
    if (!buffer && memory.imageBase64) {
      let rawBase64 = memory.imageBase64
      if (rawBase64.startsWith('data:')) {
        const match = rawBase64.match(/^data:([^;]+);base64,(.+)$/)
        if (match) rawBase64 = match[2]
      }
      buffer = Buffer.from(rawBase64, 'base64')
    }
    if (!buffer) throw new NotFoundException('Image file not found')
    return { buffer, contentType: memory.imageContentType || 'image/jpeg' }
  }
}