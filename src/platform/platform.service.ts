import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException, ConflictException, type OnModuleInit } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { buildMissionPrepChecklist } from './prepPlan'
import { computePrepPercent, isPrepItemComplete, nid } from './seed'
import { type SimulatorMissionContext } from './missionLink'
import { PlatformStore } from './platform.store'
import { localCareReply } from './quiron-local'
import type {
  Appointment,
  Conversation,
  DemoRole,
  HealthGrant,
  HealthIndicatorReading,
  Mission,
  MissionEnvironment,
  MissionStage,
  PrepItem,
  PrepStatus,
  Profile,
  SleepEpisode,
  SymptomReport,
  WakeCheck,
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
    if (!mission) throw new NotFoundException('Misión no encontrada')
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
    if (!profile) throw new NotFoundException('Perfil demo no encontrado')
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
    if (!token) throw new UnauthorizedException('Seleccioná un perfil demo')
    const now = Date.now()
    const session = this.store.get().sessions.find((item) => item.token === token && item.expiresAt > now)
    if (!session) throw new UnauthorizedException('Sesión demo expirada')
    const profile = this.store.get().profiles.find((item) => item.id === session.profileId)
    if (!profile) throw new UnauthorizedException('Perfil inválido')
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
    if (!mission) throw new NotFoundException('Misión no encontrada')
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
      name: input.name.trim() || 'Nueva misión',
      destination: input.destination?.trim() || '',
      environment,
      stage: 'draft',
      plannedStart: input.plannedStart ?? null,
      durationDays: input.durationDays ?? 30,
      plannedCrewCount: Math.max(1, input.plannedCrewCount ?? 4),
      timezone: input.timezone || 'UTC',
      activities: input.activities ?? [],
      commsNotes: input.commsNotes ?? '',
      storageNotes: input.storageNotes ?? '',
      prepPercent: 0,
      rosterLocked: false,
      analysisStale: true,
      createdBy: profile.id,
      createdAt: now,
      updatedAt: now,
    }
    this.store.mutate((db) => {
      db.missions.push(mission)
      db.memberships.push({ id: nid(), missionId: id, profileId: profile.id, role: 'chief', status: 'active', createdAt: now })
      db.invitations.push({ id: nid(), missionId: id, code, invitedRole: 'crew', requestedBy: null, status: 'open', createdAt: now })
      db.prepItems.push(
        ...starterPrep(
          id,
          now,
          profile.id,
          mission.plannedCrewCount,
          mission.durationDays,
        ),
      )
      mission.prepPercent = computePrepPercent(db.prepItems.filter((item) => item.missionId === id))
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

  /** Checklist solo en borrador/preembarque. Tras despegue queda cerrado a la fuerza. */
  private assertChecklistOpen(mission: Mission) {
    if (mission.stage === 'draft' || mission.stage === 'preflight') return
    throw new BadRequestException(
      'Checklist cerrado: la misión ya desplegó o está en posmisión. No se puede volver a editar ni reabrir el paso de preparación.',
    )
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
    if (!normalized) throw new BadRequestException('Código requerido')
    const db = this.store.get()
    const mission = db.missions.find((item) => item.code.toUpperCase() === normalized)
    if (!mission) throw new NotFoundException('No hay misión con ese código. El código no revela datos de salud.')
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
      note: 'Solicitud enviada. Conocer el código no otorga acceso a salud ni roles privilegiados.',
    }
  }

  decideJoin(chief: Profile, missionId: string, membershipId: string, accept: boolean) {
    this.requireRole(chief, missionId, ['chief'])
    const mission = this.store.get().missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Misión no encontrada')
    if (accept) {
      const blocked = this.crewAddsBlocked(mission)
      if (blocked) throw new BadRequestException(blocked)
    }
    const now = Date.now()
    this.store.mutate((db) => {
      const current = db.missions.find((item) => item.id === missionId)
      const membership = db.memberships.find((item) => item.id === membershipId && item.missionId === missionId)
      if (!membership) throw new NotFoundException('Solicitud no encontrada')
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
      if (!mission) throw new NotFoundException('Misión no encontrada')
      if (mission.stage !== 'draft' && mission.stage !== 'preflight') {
        throw new BadRequestException('Solo se editan datos generales en borrador o preembarque')
      }
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
    if (!missionGate) throw new NotFoundException('Misión no encontrada')
    this.assertChecklistOpen(missionGate)
    const now = Date.now()
    return this.store.mutate((db) => {
      const existing = item.id ? db.prepItems.find((row) => row.id === item.id && row.missionId === missionId) : undefined
      if (existing) {
        if (existing.critical && item.critical === false) {
          throw new BadRequestException('No se puede bajar criticidad sin justificación versionada en este prototipo')
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
        } else if (item.status && item.status !== 'cargado_verificado') {
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
          source: item.source ?? 'Planificación HELIOS',
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
    if (!mission) throw new NotFoundException('Misión no encontrada')
    if (mission.stage !== 'draft' && mission.stage !== 'preflight') {
      throw new BadRequestException('El análisis de IA de checklist solo está disponible antes del despliegue (borrador o preembarque).')
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
    if (!mission) throw new NotFoundException('Misión no encontrada')
    if (mission.stage !== 'draft' && mission.stage !== 'preflight') {
      throw new BadRequestException('Solo se puede analizar antes del despliegue.')
    }
    const { suggestions, note, warning } = this.suggestPrep(profile, missionId)
    const selected = titles?.length
      ? suggestions.filter((item) => titles.includes(item.title))
      : suggestions
    if (!selected.length) throw new BadRequestException('No hay ítems de checklist para guardar')
    const now = Date.now()
    this.store.mutate((db) => {
      const current = db.missions.find((item) => item.id === missionId)
      if (!current) throw new NotFoundException('Misión no encontrada')
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
    const db = this.store.get()
    const mission = db.missions.find((item) => item.id === missionId)
    if (!mission) throw new NotFoundException('Misión no encontrada')
    const items = db.prepItems.filter((item) => item.missionId === missionId)
    const percent = computePrepPercent(items)
    const applicable = items.filter((item) => item.applies && item.status !== 'no_aplica')
    const criticalPending = applicable.filter(
      (item) => item.critical && !isPrepItemComplete(item),
    )
    const activeMembers = db.memberships.filter((item) => item.missionId === missionId && item.status === 'active')
    /** Asientos de tripulación visibles: excluye mesa Ops. */
    const crewSeats = activeMembers.filter((item) => item.role !== 'ops')
    const blockers: string[] = []
    if (mission.analysisStale) blockers.push('Hubo cambios desde el último análisis: volvé a analizar antes de despegar')
    if (percent < 80) blockers.push(`Preparación ${percent}% < 80% (regla HELIOS: 80% o más para despegar)`)
    if (criticalPending.length) blockers.push(`${criticalPending.length} crítico(s) sin verificar`)
    if (crewSeats.length < 1) blockers.push('Sin integrantes activos')
    if (crewSeats.length > mission.plannedCrewCount) blockers.push('Integrantes activos exceden la planificación')
    return {
      ok: blockers.length === 0,
      percent,
      analysisStale: Boolean(mission.analysisStale),
      blockers,
      criticalPending: criticalPending.map((item) => item.id),
      activeMembers: crewSeats.length,
      plannedCrewCount: mission.plannedCrewCount,
      disclaimer: 'El 80% es regla HELIOS de simulación; no es certificación médica ni requisito NASA.',
    }
  }

  startSimulatedMission(profile: Profile, missionId: string, confirm: boolean) {
    this.requireRole(profile, missionId, ['chief'])
    if (!confirm) throw new BadRequestException('El jefe debe confirmar el comienzo')
    const evaluation = this.evaluateStart(missionId)
    if (!evaluation.ok) throw new BadRequestException({ message: 'No se puede iniciar', ...evaluation })
    const now = Date.now()
    this.store.mutate((db) => {
      const mission = db.missions.find((item) => item.id === missionId)
      if (!mission) throw new NotFoundException('Misión no encontrada')
      const items = db.prepItems.filter((item) => item.missionId === missionId)
      db.prepSnapshots.push({
        id: nid(),
        missionId,
        percent: evaluation.percent,
        payload: structuredClone(items),
        confirmedBy: profile.id,
        createdAt: now,
      })
      mission.stage = 'aboard'
      mission.rosterLocked = true
      mission.analysisStale = false
      mission.prepPercent = evaluation.percent
      mission.updatedAt = now
      db.accessAudit.push({ id: nid(), missionId, actorProfileId: profile.id, action: 'start-simulated', detail: `${evaluation.percent}%`, createdAt: now })
    })
    return { ...this.getMission(profile, missionId), evaluation }
  }

  setStage(profile: Profile, missionId: string, stage: MissionStage) {
    this.requireRole(profile, missionId, ['chief', 'ops'])
    if (stage === 'aboard') throw new BadRequestException('Usá startSimulatedMission para pasar a bordo')
    this.store.mutate((db) => {
      const mission = db.missions.find((item) => item.id === missionId)
      if (!mission) throw new NotFoundException('Misión no encontrada')
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
      // Forzado: nunca reabrir checklist después del despegue.
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
    let check = db.wakeChecks.find((item) => item.missionId === missionId && item.profileId === profile.id && item.periodKey === periodKey)
    if (!check) {
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
      this.store.mutate((store) => store.wakeChecks.push(check as WakeCheck))
    }
    return { check, justWoke, note: check.status === 'pending' ? 'Sin completar' : check.status }
  }

  completeWakeCheck(profile: Profile, missionId: string, payload: Record<string, unknown>) {
    this.requireMembership(profile, missionId)
    const periodKey = new Date().toISOString().slice(0, 10)
    this.store.mutate((db) => {
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
    if (!(endAt > startAt)) throw new BadRequestException('Intervalo inválido')
    const db = this.store.get()
    const overlap = db.sleepEpisodes.some((item) =>
      item.missionId === missionId &&
      item.profileId === profile.id &&
      startAt < item.endAt &&
      endAt > item.startAt)
    if (overlap) throw new BadRequestException('El intervalo se solapa con otro episodio de sueño')
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
    this.store.mutate((store) => store.sleepEpisodes.push(episode))
    return episode
  }

  listSleep(profile: Profile, missionId: string, subjectId?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'sleep')
    return this.store.get().sleepEpisodes.filter((item) => item.missionId === missionId && item.profileId === target)
  }

  addSymptom(profile: Profile, missionId: string, input: Omit<SymptomReport, 'id' | 'missionId' | 'profileId' | 'createdAt'>) {
    this.requireMembership(profile, missionId)
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
      createdAt: Date.now(),
    }
    this.store.mutate((db) => db.symptomReports.push(row))
    return row
  }

  listSymptoms(profile: Profile, missionId: string, subjectId?: string) {
    this.requireMembership(profile, missionId)
    const target = subjectId || profile.id
    if (target !== profile.id) this.requireHealthAccess(profile, missionId, target, 'symptoms')
    return this.store.get().symptomReports.filter((item) => item.missionId === missionId && item.profileId === target)
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
    this.store.mutate((db) => db.healthIndicators.push(row))
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
      throw new BadRequestException('El destinatario debe ser médico o psicólogo de la misión')
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
      createdAt: Date.now(),
    }
    this.store.mutate((db) => {
      db.healthGrants.push(grant)
      db.accessAudit.push({ id: nid(), missionId, actorProfileId: subject.id, action: 'grant-health', detail: `${granteeProfileId}:${categories.join(',')}`, createdAt: Date.now() })
    })
    return grant
  }

  revokeGrant(subject: Profile, grantId: string) {
    this.store.mutate((db) => {
      const grant = db.healthGrants.find((item) => item.id === grantId)
      if (!grant || grant.subjectProfileId !== subject.id) throw new ForbiddenException('Solo quien otorgó puede revocar')
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
      note: 'El jefe ve estado operativo según política informada; no chats privados.',
    }
  }

  // --- Quirón conversations ---
  startConversation(profile: Profile, missionId: string, mode: 'physical' | 'emotional', locale: 'es' | 'en' = 'es') {
    this.requireMembership(profile, missionId)
    if (!['physical', 'emotional'].includes(mode)) throw new BadRequestException('Invalid conversation mode')
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
          ? mode === 'physical' ? 'What would you like to talk about or understand about your physical wellbeing?' : 'This is your space to talk. Nothing is shared unless you explicitly approve it.'
          : mode === 'physical' ? '\u00bfDe qu\u00e9 te gustar\u00eda hablar o qu\u00e9 quieres entender sobre tu bienestar f\u00edsico?' : 'Este es tu espacio para hablar. No se comparte nada sin tu aprobaci\u00f3n expl\u00edcita.',
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
    const protocol = db.protocols.find((item) => item.id === 'proto-urgent-v1')
    const professionals = db.memberships
      .filter((item) => item.missionId === missionId && item.status === 'active' && (item.role === 'medic' || item.role === 'psychologist' || item.role === 'chief'))
      .map((item) => db.profiles.find((profileRow) => profileRow.id === item.profileId))
      .filter(Boolean)
    this.store.mutate((store) => {
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
      limitation: 'Quirón no improvisa tratamientos. Seguí el protocolo versionado y el contacto humano.',
    }
  }

  requestAppointment(profile: Profile, missionId: string, input: { specialty: string; professionalId?: string | null; modality?: string; reason?: string; summary?: string; scheduledAt?: number | null }) {
    this.requireMembership(profile, missionId)
    if (input.professionalId && input.scheduledAt) {
      const clash = this.store.get().appointments.some((item) =>
        item.missionId === missionId &&
        item.professionalId === input.professionalId &&
        item.scheduledAt === input.scheduledAt &&
        item.status !== 'cancelled')
      if (clash) throw new BadRequestException('Ese horario ya está ocupado')
    }
    const appointment: Appointment = {
      id: nid(),
      missionId,
      requesterId: profile.id,
      professionalId: input.professionalId ?? null,
      specialty: input.specialty,
      modality: input.modality || 'aboard',
      reason: input.reason || '',
      summary: input.summary || '',
      status: input.professionalId ? 'pending_confirm' : 'requested',
      scheduledAt: input.scheduledAt ?? null,
      createdAt: Date.now(),
    }
    this.store.mutate((db) => db.appointments.push(appointment))
    return { appointment, note: 'Solicitud registrada. No está confirmada hasta aceptación válida.' }
  }

  confirmAppointment(profile: Profile, appointmentId: string, accept: boolean) {
    this.store.mutate((db) => {
      const appointment = db.appointments.find((item) => item.id === appointmentId)
      if (!appointment) throw new NotFoundException('Cita no encontrada')
      if (appointment.professionalId !== profile.id && this.membership(profile.id, appointment.missionId)?.role !== 'chief') {
        throw new ForbiddenException('Solo el profesional o el jefe pueden confirmar')
      }
      appointment.status = accept ? 'confirmed' : 'cancelled'
    })
    return this.store.get().appointments.find((item) => item.id === appointmentId)
  }

  listAppointments(profile: Profile, missionId: string) {
    this.requireMembership(profile, missionId)
    const role = this.membership(profile.id, missionId)?.role
    return this.store.get().appointments.filter((item) => {
      if (item.missionId !== missionId) return false
      if (role === 'chief' || role === 'medic' || role === 'psychologist') return true
      return item.requesterId === profile.id
    })
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
    if (!this.membership(profile.id, missionId)) throw new ForbiddenException('No pertenecés a esta misión')
  }

  private requireRole(profile: Profile, missionId: string, roles: DemoRole[]) {
    const membership = this.membership(profile.id, missionId)
    if (!membership || !roles.includes(membership.role)) throw new ForbiddenException('Rol insuficiente en esta misión')
  }

  private requireHealthAccess(viewer: Profile, missionId: string, subjectId: string, category: string) {
    const membership = this.membership(viewer.id, missionId)
    if (!membership) throw new ForbiddenException()
    if (membership.role === 'chief' && (category === 'vitals' || category === 'alerts')) return
    if (membership.role === 'chief') throw new ForbiddenException('El jefe no accede a este dato clínico/privado')
    const now = Date.now()
    const grant = this.store.get().healthGrants.find((item) =>
      item.missionId === missionId &&
      item.subjectProfileId === subjectId &&
      item.granteeProfileId === viewer.id &&
      !item.revokedAt &&
      (!item.expiresAt || item.expiresAt > now) &&
      item.categories.includes(category))
    if (!grant) throw new ForbiddenException('Sin autorización de la persona para esta categoría')
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


}

function starterPrep(
  missionId: string,
  at: number,
  ownerId: string,
  plannedCrewCount = 4,
  durationDays = 30,
): PrepItem[] {
  return buildMissionPrepChecklist(plannedCrewCount, durationDays).map((item) => ({
    id: `${missionId}-plan-${item.key}`,
    missionId,
    category: item.category,
    title: item.title,
    description: item.qtyLabel
      ? `${item.description} Cantidad planificada: ${item.qtyLabel}.`
      : item.description,
    source: item.source,
    ownerProfileId: ownerId,
    qtyRequired: item.qtyRequired,
    qtyAvailable: null,
    critical: item.critical,
    status: 'pendiente_revision' as const,
    evidence: '',
    verifiedBy: null,
    verifiedAt: null,
    applies: true,
    updatedAt: at,
  }))
}