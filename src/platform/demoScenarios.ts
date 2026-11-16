import { buildMissionPrepChecklist } from './prepPlan'
import { computePrepPercent } from './prepMath'
import { applyAdministrativeClose, applyStart } from './missionTransitions'
import { buildMissionReview } from './review'
import type {
  Appointment,
  AvailabilityWindow,
  HealthGrant,
  HealthIndicatorReading,
  InventoryItem,
  Membership,
  Mission,
  MissionAlert,
  PlatformDb,
  PrepItem,
  Profile,
  SymptomReport,
  WakeCheck,
} from './types'

export const DEMO_MISSIONS = {
  aurora: 'mission-demo-aurora',
  horizon: 'mission-demo-horizon',
  pathfinder: 'mission-demo-pathfinder',
  genesis: 'mission-demo-genesis',
} as const

const DAY = 24 * 60 * 60 * 1000
const CHIEF = 'elena-torres'
const MEDIC = 'sofia-chen'
const PSYCH = 'alex-morgan'
const CREW = ['mateo-ruiz', 'nova-hale', 'kenji-oka'] as const
const FLIGHT = [CHIEF, ...CREW, MEDIC, PSYCH] as const

const EXTRA_PROFILES: Profile[] = [
  { id: 'nova-hale', displayName: 'Nova Hale', title: 'Crew Member (simulated)', demoRole: 'crew', avatarKey: 'nova' },
  { id: 'kenji-oka', displayName: 'Kenji Oka', title: 'Crew Member (simulated)', demoRole: 'crew', avatarKey: 'kenji' },
]

function atHour(ts: number, hour: number, minute = 0) {
  const date = new Date(ts)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0)
}

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10)
}

function wipeDemo(db: PlatformDb) {
  const ids = new Set<string>([
    ...Object.values(DEMO_MISSIONS),
    'mission-helios-demo',
  ])
  for (const mission of db.missions) {
    if (mission.demoKey) ids.add(mission.id)
  }
  const drop = (missionId: string | null | undefined) => Boolean(missionId && ids.has(missionId))
  db.missions = db.missions.filter((item) => !ids.has(item.id))
  db.memberships = db.memberships.filter((item) => !drop(item.missionId))
  db.invitations = db.invitations.filter((item) => !drop(item.missionId))
  db.prepItems = db.prepItems.filter((item) => !drop(item.missionId))
  db.prepSnapshots = db.prepSnapshots.filter((item) => !drop(item.missionId))
  db.healthGrants = db.healthGrants.filter((item) => !drop(item.missionId))
  db.wakeChecks = db.wakeChecks.filter((item) => !drop(item.missionId))
  db.sleepEpisodes = db.sleepEpisodes.filter((item) => !drop(item.missionId))
  db.symptomReports = db.symptomReports.filter((item) => !drop(item.missionId))
  db.painReports = (db.painReports || []).filter((item) => !drop(item.missionId))
  db.healthIndicators = db.healthIndicators.filter((item) => !drop(item.missionId))
  db.conversations = db.conversations.filter((item) => !drop(item.missionId))
  db.appointments = db.appointments.filter((item) => !drop(item.missionId))
  db.availability = (db.availability || []).filter((item) => !drop(item.missionId))
  db.inventoryItems = (db.inventoryItems || []).filter((item) => !drop(item.missionId))
  db.inventoryMovements = (db.inventoryMovements || []).filter((item) => !drop(item.missionId))
  db.missionAlerts = (db.missionAlerts || []).filter((item) => !drop(item.missionId))
  db.reviewReports = (db.reviewReports || []).filter((item) => !drop(item.missionId))
  db.accessAudit = db.accessAudit.filter((item) => !drop(item.missionId))
}

function ensureProfiles(db: PlatformDb) {
  for (const profile of EXTRA_PROFILES) {
    if (!db.profiles.some((item) => item.id === profile.id)) db.profiles.push(profile)
  }
}

function missionShell(input: {
  id: string
  code: string
  name: string
  demoKey: Mission['demoKey']
  stage: Mission['stage']
  destination: string
  days: number
  crew: number
  start: string | null
  at: number
  activities: string[]
}): Mission {
  return {
    id: input.id,
    code: input.code,
    name: input.name,
    destination: input.destination,
    environment: 'space_station',
    stage: input.stage,
    plannedStart: input.start,
    actualStart: null,
    actualReturn: null,
    durationDays: input.days,
    plannedCrewCount: input.crew,
    timezone: 'UTC',
    wakeHourUtc: 6,
    activities: input.activities,
    commsNotes: 'Simulated Earth link. Demonstration only.',
    storageNotes: 'Simulated inventory. Not a flight manifest.',
    prepPercent: 0,
    rosterLocked: false,
    analysisStale: input.stage === 'draft',
    demoKey: input.demoKey,
    simulated: true,
    closedAt: null,
    closedBy: null,
    createdBy: CHIEF,
    createdAt: input.at,
    updatedAt: input.at,
  }
}

function seats(missionId: string, at: number, includeOps: boolean): Membership[] {
  const rows: Membership[] = [
    { id: `${missionId}-m-elena`, missionId, profileId: CHIEF, role: 'chief', status: 'active', createdAt: at },
    { id: `${missionId}-m-mateo`, missionId, profileId: 'mateo-ruiz', role: 'crew', status: 'active', createdAt: at },
    { id: `${missionId}-m-nova`, missionId, profileId: 'nova-hale', role: 'crew', status: 'active', createdAt: at },
    { id: `${missionId}-m-kenji`, missionId, profileId: 'kenji-oka', role: 'crew', status: 'active', createdAt: at },
    { id: `${missionId}-m-sofia`, missionId, profileId: MEDIC, role: 'medic', status: 'active', createdAt: at },
    { id: `${missionId}-m-alex`, missionId, profileId: PSYCH, role: 'psychologist', status: 'active', createdAt: at },
  ]
  if (includeOps) {
    rows.push({ id: `${missionId}-m-ops`, missionId, profileId: 'ops-desk', role: 'ops', status: 'active', createdAt: at })
  }
  return rows
}

function prepFor(missionId: string, people: number, days: number, at: number, mode: 'ready' | 'partial'): PrepItem[] {
  const owners: Record<string, string> = {
    'eval-kit': MEDIC,
    oximeter: CHIEF,
    hygiene: 'ops-desk',
    'first-aid': MEDIC,
    comms: CHIEF,
    wellbeing: PSYCH,
    'water-plan': 'kenji-oka',
  }
  return buildMissionPrepChecklist(people, days).map((item) => {
    const qty = item.qtyRequired
    let qtyAvailable: number | null = null
    let status: PrepItem['status'] = 'pendiente_revision'
    let verifiedBy: string | null = null
    let verifiedAt: number | null = null
    const leaveOpen = mode === 'partial' && (item.key === 'first-aid' || item.key === 'comms' || item.key === 'water-plan')
    if (!leaveOpen && mode === 'ready' && item.key === 'water-plan' && qty) {
      qtyAvailable = Math.round(qty * 0.3)
      status = 'pendiente_revision'
    } else if (!leaveOpen && mode === 'partial' && item.key === 'wellbeing' && qty) {
      qtyAvailable = 1
      status = 'pendiente_revision'
    } else if (!leaveOpen) {
      qtyAvailable = qty
      status = 'cargado_verificado'
      verifiedBy = CHIEF
      verifiedAt = at
    }
    return {
      id: `${missionId}-plan-${item.key}`,
      missionId,
      category: item.category,
      title: item.title,
      description: item.qtyLabel ? `${item.description} Planned quantity: ${item.qtyLabel}.` : item.description,
      source: item.source,
      ownerProfileId: owners[item.key] || CHIEF,
      qtyRequired: qty,
      qtyAvailable,
      critical: item.critical,
      status,
      evidence: status === 'cargado_verificado' ? 'Simulated verification recorded before deploy.' : '',
      verifiedBy,
      verifiedAt,
      applies: true,
      updatedAt: at,
    }
  })
}

function windows(missionId: string): AvailabilityWindow[] {
  return [MEDIC, PSYCH].map((profileId) => ({
    id: `${missionId}-avail-${profileId}`,
    missionId,
    profileId,
    weekday: null,
    startMin: 8 * 60,
    endMin: 18 * 60,
    slotMin: 30,
  }))
}

function appointment(input: Omit<Appointment, 'simulated' | 'history' | 'professionalNotes' | 'summary' | 'outcome' | 'cancelReason' | 'shareCategories' | 'durationMin' | 'timezone' | 'updatedAt' | 'followUpOf'> & Partial<Appointment>): Appointment {
  return {
    professionalNotes: '',
    summary: '',
    outcome: '',
    cancelReason: '',
    shareCategories: [],
    durationMin: 30,
    timezone: 'UTC',
    followUpOf: null,
    history: [],
    simulated: true,
    updatedAt: input.createdAt,
    ...input,
  }
}

export function ensureUpcomingCareAppointments(db: PlatformDb, now = Date.now()) {
  const missionId = DEMO_MISSIONS.horizon
  if (!db.missions.some((mission) => mission.id === missionId)) return false

  const upcoming = [
    appointment({
      id: `${missionId}-appt-psych-upcoming`,
      missionId,
      requesterId: 'mateo-ruiz',
      professionalId: PSYCH,
      specialty: 'psychological',
      modality: 'aboard',
      reason: 'Consulta psicológica de seguimiento',
      summary: 'Solicitud de acompañamiento voluntario.',
      status: 'confirmed',
      scheduledAt: atHour(now + DAY, 9),
      createdAt: now,
      history: [{
        at: now,
        actorId: PSYCH,
        action: 'confirm',
        from: 'requested',
        to: 'confirmed',
        note: 'Professional accepted the slot',
      }],
    }),
    appointment({
      id: `${missionId}-appt-med-upcoming`,
      missionId,
      requesterId: 'mateo-ruiz',
      professionalId: MEDIC,
      specialty: 'medical',
      modality: 'aboard',
      reason: 'Revisión médica de rutina',
      status: 'confirmed',
      scheduledAt: atHour(now + 2 * DAY, 10),
      createdAt: now,
      history: [{
        at: now,
        actorId: MEDIC,
        action: 'confirm',
        from: 'requested',
        to: 'confirmed',
        note: 'Physician accepted the slot',
      }],
    }),
    appointment({
      id: `${missionId}-appt-elena-upcoming`,
      missionId,
      requesterId: CHIEF,
      professionalId: MEDIC,
      specialty: 'medical',
      modality: 'aboard',
      reason: 'Simulated routine medical follow-up',
      status: 'confirmed',
      scheduledAt: atHour(now + 2 * DAY, 11),
      createdAt: now,
      history: [{
        at: now,
        actorId: MEDIC,
        action: 'confirm',
        from: 'requested',
        to: 'confirmed',
        note: 'Physician accepted the slot',
      }],
    }),
  ]
  let changed = false
  for (const visit of upcoming) {
    if (db.appointments.some((item) => item.id === visit.id)) continue
    db.appointments.push(visit)
    changed = true
  }
  return changed
}

function addFlightRecords(db: PlatformDb, missionId: string, start: number, days: number, today: number) {
  const people = [...FLIGHT]
  for (let offset = 0; offset < days; offset += 1) {
    const stamp = start + offset * DAY
    for (const profileId of people) {
      const completed = !(profileId === 'nova-hale' && offset % 4 === 0) && !(profileId === 'kenji-oka' && offset === days - 1)
      if (!completed && profileId === 'kenji-oka') continue
      const row: WakeCheck = {
        id: `${missionId}-wake-${profileId}-${offset}`,
        missionId,
        profileId,
        periodKey: dayKey(stamp),
        status: completed ? 'completed' : 'pending',
        payload: completed
          ? { sleepHours: 7, sleepQuality: 3, physical: 'acceptable', mood: 4, symptoms: '', comments: 'Simulated check-in', supportRequested: false }
          : {},
        createdAt: atHour(stamp, 7),
      }
      db.wakeChecks.push(row)
      if (completed) {
        db.sleepEpisodes.push({
          id: `${missionId}-sleep-${profileId}-${offset}`,
          missionId,
          profileId,
          startAt: atHour(stamp, 23) - DAY,
          endAt: atHour(stamp, 6),
          quality: 3,
          kind: 'night',
          createdAt: atHour(stamp, 6),
        })
      }
      db.healthIndicators.push({
        id: `${missionId}-hr-${profileId}-${offset}`,
        missionId,
        profileId,
        kind: 'heart_rate',
        measuredAt: atHour(stamp, 9),
        value: 68 + (offset % 5) + (profileId === CHIEF && offset === 2 ? 22 : 0),
        valueSecondary: null,
        unit: 'bpm',
        origin: 'simulation',
        context: 'morning',
        quality: 'good',
        staleAfterMs: 6 * 60 * 60 * 1000,
        notes: 'Simulated reading. Demo rule only — not a diagnosis.',
        bodyRegion: 'chest',
        createdAt: atHour(stamp, 9),
      })
    }
  }
  const stale: HealthIndicatorReading = {
    id: `${missionId}-hr-elena-stale`,
    missionId,
    profileId: CHIEF,
    kind: 'heart_rate',
    measuredAt: start - 40 * DAY,
    value: 74,
    valueSecondary: null,
    unit: 'bpm',
    origin: 'simulation',
    context: 'archive',
    quality: 'poor',
    staleAfterMs: 6 * 60 * 60 * 1000,
    notes: 'Simulated old reading. Identified as historical, not current.',
    bodyRegion: 'chest',
    createdAt: start - 40 * DAY,
  }
  db.healthIndicators.push(stale)
  db.sleepEpisodes.push({
    id: `${missionId}-nap-kenji`,
    missionId,
    profileId: 'kenji-oka',
    startAt: atHour(start + 4 * DAY, 14),
    endAt: atHour(start + 4 * DAY, 14, 40),
    quality: 3,
    kind: 'nap',
    createdAt: atHour(start + 4 * DAY, 14, 40),
  })
  const symptom = (row: SymptomReport) => db.symptomReports.push(row)
  symptom({
    id: `${missionId}-sx-mateo-1`,
    missionId,
    profileId: 'mateo-ruiz',
    description: 'Simulated headache, first report',
    startedAt: start + DAY,
    intensity: 4,
    context: 'after exercise',
    source: 'self_report',
    bodyRegion: 'head',
    status: 'monitoring',
    createdAt: start + DAY,
  })
  symptom({
    id: `${missionId}-sx-mateo-2`,
    missionId,
    profileId: 'mateo-ruiz',
    description: 'Simulated headache, follow-up report',
    startedAt: start + 4 * DAY,
    intensity: 3,
    context: 'afternoon',
    source: 'self_report',
    bodyRegion: 'head',
    status: 'monitoring',
    createdAt: start + 4 * DAY,
  })
  symptom({
    id: `${missionId}-sx-mateo-3`,
    missionId,
    profileId: 'mateo-ruiz',
    description: 'Simulated headache, later report',
    startedAt: start + 7 * DAY,
    intensity: 2,
    context: 'morning',
    source: 'self_report',
    bodyRegion: 'head',
    status: 'monitoring',
    createdAt: start + 7 * DAY,
  })
  symptom({
    id: `${missionId}-sx-sofia`,
    missionId,
    profileId: MEDIC,
    description: 'Simulated dry eyes',
    startedAt: start + 3 * DAY,
    intensity: 2,
    context: 'own health record',
    source: 'self_report',
    bodyRegion: 'head',
    status: 'open',
    createdAt: start + 3 * DAY,
  })
  symptom({
    id: `${missionId}-sx-kenji-open`,
    missionId,
    profileId: 'kenji-oka',
    description: 'Simulated poor sleep still open at review',
    startedAt: start + 6 * DAY,
    intensity: 3,
    context: 'self',
    source: 'self_report',
    bodyRegion: null,
    status: 'open',
    createdAt: start + 6 * DAY,
  })
  const alerts: MissionAlert[] = [
    {
      id: `${missionId}-alert-active`,
      missionId,
      subjectProfileId: 'kenji-oka',
      title: 'Short sleep stretch observed',
      detail: 'Demo rule: several short rest entries. Not a diagnosis.',
      status: 'active',
      simulated: true,
      openedAt: start + 6 * DAY,
      updatedAt: start + 6 * DAY,
    },
    {
      id: `${missionId}-alert-watch`,
      missionId,
      subjectProfileId: 'mateo-ruiz',
      title: 'Headache reports in follow-up',
      detail: 'Demo rule: repeated self-report. Status stays in monitoring.',
      status: 'monitoring',
      simulated: true,
      openedAt: start + DAY,
      updatedAt: start + 7 * DAY,
    },
    {
      id: `${missionId}-alert-closed`,
      missionId,
      subjectProfileId: CHIEF,
      title: 'Heart-rate change observed, then back in range',
      detail: 'Demo rule Δ≥20 bpm on one simulated morning. Closed after later readings. Not a diagnosis.',
      status: 'closed',
      simulated: true,
      openedAt: start + 2 * DAY,
      updatedAt: start + 3 * DAY,
    },
  ]
  db.missionAlerts.push(...alerts)
  const items: InventoryItem[] = [
    { id: `${missionId}-inv-ox`, missionId, name: 'Oximeters', kind: 'reusable', unit: 'unit', qtyOnHand: 3, qtyPlanned: 3, simulated: true },
    { id: `${missionId}-inv-hyg`, missionId, name: 'Hygiene consumables', kind: 'consumable', unit: 'ration', qtyOnHand: 12, qtyPlanned: 40, simulated: true },
    { id: `${missionId}-inv-thermo`, missionId, name: 'Spare thermometer', kind: 'reusable', unit: 'unit', qtyOnHand: 1, qtyPlanned: 1, simulated: true },
  ]
  db.inventoryItems.push(...items)
  db.inventoryMovements.push(
    { id: `${missionId}-mov-ox-1`, missionId, itemId: `${missionId}-inv-ox`, delta: -1, reason: 'Simulated checkout', actorProfileId: MEDIC, at: start + DAY, simulated: true },
    { id: `${missionId}-mov-ox-2`, missionId, itemId: `${missionId}-inv-ox`, delta: 1, reason: 'Simulated return', actorProfileId: MEDIC, at: start + DAY + 3600000, simulated: true },
    { id: `${missionId}-mov-hyg`, missionId, itemId: `${missionId}-inv-hyg`, delta: -28, reason: 'Simulated daily use', actorProfileId: 'ops-desk', at: start + 5 * DAY, simulated: true },
  )
  const grants: HealthGrant[] = [
    {
      id: `${missionId}-grant-mateo`,
      missionId,
      subjectProfileId: 'mateo-ruiz',
      granteeProfileId: MEDIC,
      categories: ['sleep'],
      scopeNote: 'Simulated active grant',
      expiresAt: null,
      revokedAt: null,
      acceptedAt: start,
      createdAt: start,
    },
    {
      id: `${missionId}-grant-nova`,
      missionId,
      subjectProfileId: 'nova-hale',
      granteeProfileId: PSYCH,
      categories: ['symptoms'],
      scopeNote: 'Simulated pending grant',
      expiresAt: null,
      revokedAt: null,
      acceptedAt: null,
      createdAt: start,
    },
    {
      id: `${missionId}-grant-kenji`,
      missionId,
      subjectProfileId: 'kenji-oka',
      granteeProfileId: MEDIC,
      categories: ['symptoms'],
      scopeNote: 'Simulated revoked grant',
      expiresAt: null,
      revokedAt: start + 2 * DAY,
      acceptedAt: start,
      createdAt: start,
    },
  ]
  db.healthGrants.push(...grants)
  db.availability.push(...windows(missionId))
  const completedPsych = appointment({
    id: `${missionId}-appt-psych-done`,
    missionId,
    requesterId: 'mateo-ruiz',
    professionalId: PSYCH,
    specialty: 'psychological',
    modality: 'aboard',
    reason: 'Simulated request to talk about sleep',
    summary: 'Voluntary shared summary: sleep has been uneven. No transcript attached.',
    professionalNotes: 'SIMULATED private professional note. Restricted to the psychologist.',
    shareCategories: ['sleep'],
    status: 'completed',
    scheduledAt: atHour(start + DAY, 14),
    outcome: 'Simulated visit held. Follow-up proposed, not a diagnosis.',
    history: [{
      at: start + DAY,
      actorId: PSYCH,
      action: 'confirm',
      from: 'requested',
      to: 'confirmed',
      note: 'Professional accepted the slot',
    }, {
      at: start + DAY + 3600000,
      actorId: PSYCH,
      action: 'complete',
      from: 'confirmed',
      to: 'completed',
      note: 'Outcome recorded by the professional',
    }],
    createdAt: start,
  })
  const follow = appointment({
    id: `${missionId}-appt-psych-follow`,
    missionId,
    requesterId: 'mateo-ruiz',
    professionalId: PSYCH,
    specialty: 'psychological',
    modality: 'aboard',
    reason: 'Simulated follow-up',
    shareCategories: ['sleep'],
    status: 'confirmed',
    scheduledAt: atHour(start + 6 * DAY, 14),
    followUpOf: completedPsych.id,
    history: [{
      at: start + 2 * DAY,
      actorId: PSYCH,
      action: 'confirm',
      from: 'requested',
      to: 'confirmed',
      note: 'Professional accepted the follow-up',
    }],
    createdAt: start + 2 * DAY,
  })
  db.appointments.push(
    completedPsych,
    follow,
    appointment({
      id: `${missionId}-appt-med-confirmed`,
      missionId,
      requesterId: 'mateo-ruiz',
      professionalId: MEDIC,
      specialty: 'medical',
      modality: 'aboard',
      reason: 'Simulated headache follow-up',
      shareCategories: ['vitals', 'symptoms'],
      status: 'confirmed',
      scheduledAt: atHour(start + 2 * DAY, 10),
      history: [{
        at: start + DAY,
        actorId: MEDIC,
        action: 'confirm',
        from: 'requested',
        to: 'confirmed',
        note: 'Physician accepted the slot',
      }],
      createdAt: start + DAY,
    }),
    appointment({
      id: `${missionId}-appt-med-requested`,
      missionId,
      requesterId: 'nova-hale',
      professionalId: MEDIC,
      specialty: 'medical',
      modality: 'aboard',
      reason: 'Simulated non-urgent question',
      shareCategories: ['symptoms'],
      status: 'requested',
      scheduledAt: atHour(today + DAY, 10),
      history: [{
        at: today,
        actorId: 'nova-hale',
        action: 'request',
        from: null,
        to: 'requested',
        note: 'Waiting for the physician',
      }],
      createdAt: today,
    }),
    appointment({
      id: `${missionId}-appt-psych-moved`,
      missionId,
      requesterId: 'kenji-oka',
      professionalId: PSYCH,
      specialty: 'psychological',
      modality: 'aboard',
      reason: 'Simulated request to reschedule',
      shareCategories: [],
      status: 'rescheduled',
      scheduledAt: atHour(start + 3 * DAY, 15),
      history: [{
        at: start + 2 * DAY,
        actorId: PSYCH,
        action: 'confirm',
        from: 'requested',
        to: 'confirmed',
        note: 'Professional accepted',
      }, {
        at: start + 2 * DAY + 1000,
        actorId: PSYCH,
        action: 'reschedule',
        from: 'confirmed',
        to: 'rescheduled',
        note: 'Moved from 11:00 to 15:00 UTC',
      }],
      createdAt: start + 2 * DAY,
    }),
    appointment({
      id: `${missionId}-appt-med-cancelled`,
      missionId,
      requesterId: CHIEF,
      professionalId: MEDIC,
      specialty: 'medical',
      modality: 'aboard',
      reason: 'Simulated request later withdrawn',
      status: 'cancelled',
      scheduledAt: atHour(start + 4 * DAY, 11),
      cancelReason: 'Requester withdrew before the visit',
      history: [{
        at: start + 3 * DAY,
        actorId: CHIEF,
        action: 'cancel',
        from: 'requested',
        to: 'cancelled',
        note: 'Requester withdrew before the visit',
      }],
      createdAt: start + 3 * DAY,
    }),
  )
}

function todayCheck(db: PlatformDb, missionId: string, now: number) {
  const key = dayKey(now)
  db.wakeChecks = db.wakeChecks.filter((item) => !(item.missionId === missionId && item.periodKey === key))
  db.wakeChecks.push({
    id: `${missionId}-wake-mateo-today`,
    missionId,
    profileId: 'mateo-ruiz',
    periodKey: key,
    status: 'completed',
    payload: {
      sleepHours: 6.5,
      sleepQuality: 3,
      physical: 'acceptable',
      mood: 3,
      symptoms: 'Simulated mild headache',
      comments: 'Already submitted today',
      supportRequested: false,
    },
    createdAt: atHour(now, 7),
  })
  db.wakeChecks.push({
    id: `${missionId}-wake-elena-today`,
    missionId,
    profileId: CHIEF,
    periodKey: key,
    status: 'completed',
    payload: { sleepHours: 7, sleepQuality: 4, physical: 'good', mood: 4, symptoms: '', comments: '', supportRequested: false },
    createdAt: atHour(now, 7),
  })
  db.wakeChecks.push({
    id: `${missionId}-wake-nova-today`,
    missionId,
    profileId: 'nova-hale',
    periodKey: key,
    status: 'pending',
    payload: {},
    createdAt: atHour(now, 6),
  })
}

/** Rebuilds the four demonstration missions. Safe to run again: demo ids are replaced, other missions stay. */
export function installDemoScenarios(db: PlatformDb, now = Date.now()) {
  if (!Array.isArray(db.availability)) db.availability = []
  if (!Array.isArray(db.inventoryItems)) db.inventoryItems = []
  if (!Array.isArray(db.inventoryMovements)) db.inventoryMovements = []
  if (!Array.isArray(db.missionAlerts)) db.missionAlerts = []
  if (!Array.isArray(db.reviewReports)) db.reviewReports = []
  wipeDemo(db)
  ensureProfiles(db)

  const pathfinderAt = now - 5 * DAY
  const pathfinder = missionShell({
    id: DEMO_MISSIONS.pathfinder,
    code: 'HELIOS-PATHFINDER',
    name: 'HELIOS Pathfinder — Preflight',
    demoKey: 'pathfinder',
    stage: 'preflight',
    destination: 'Low Earth orbit (simulated)',
    days: 21,
    crew: 6,
    start: new Date(now + 14 * DAY).toISOString().slice(0, 10),
    at: pathfinderAt,
    activities: ['Habitat setup', 'Checklist drills'],
  })
  const pathPrep = prepFor(pathfinder.id, 6, 21, pathfinderAt, 'partial')
  pathfinder.prepPercent = computePrepPercent(pathPrep)
  pathfinder.analysisStale = false
  db.missions.push(pathfinder)
  db.memberships.push(...seats(pathfinder.id, pathfinderAt, true))
  db.prepItems.push(...pathPrep)
  db.inventoryItems.push(
    { id: `${pathfinder.id}-inv-review`, missionId: pathfinder.id, name: 'Evaluation kit', kind: 'reusable', unit: 'kit', qtyOnHand: 0, qtyPlanned: 1, simulated: true },
    { id: `${pathfinder.id}-inv-water`, missionId: pathfinder.id, name: 'Water plan', kind: 'consumable', unit: 'person-day', qtyOnHand: 0, qtyPlanned: 126, simulated: true },
  )

  const genesis = missionShell({
    id: DEMO_MISSIONS.genesis,
    code: 'HELIOS-GENESIS',
    name: 'HELIOS Genesis — Draft',
    demoKey: 'genesis',
    stage: 'draft',
    destination: '',
    days: 30,
    crew: 4,
    start: null,
    at: now - DAY,
    activities: [],
  })
  db.missions.push(genesis)
  db.memberships.push({
    id: `${genesis.id}-m-elena`,
    missionId: genesis.id,
    profileId: CHIEF,
    role: 'chief',
    status: 'active',
    createdAt: genesis.createdAt,
  })

  const horizonStart = now - 10 * DAY
  const horizon = missionShell({
    id: DEMO_MISSIONS.horizon,
    code: 'HELIOS-HORIZON',
    name: 'HELIOS Horizon — In Flight',
    demoKey: 'horizon',
    stage: 'preflight',
    destination: 'Low Earth orbit (simulated)',
    days: 14,
    crew: 6,
    start: dayKey(horizonStart),
    at: horizonStart - DAY,
    activities: ['Daily operations', 'Exercise', 'Science'],
  })
  const horizonPrep = prepFor(horizon.id, 6, 14, horizon.createdAt, 'ready')
  horizon.prepPercent = computePrepPercent(horizonPrep)
  horizon.analysisStale = false
  db.missions.push(horizon)
  db.memberships.push(...seats(horizon.id, horizon.createdAt, false))
  db.prepItems.push(...horizonPrep)
  applyStart(db, horizon.id, CHIEF, horizonStart)
  addFlightRecords(db, horizon.id, horizonStart, 9, now)
  ensureUpcomingCareAppointments(db, now)
  todayCheck(db, horizon.id, now)
  db.conversations.push({
    id: `${horizon.id}-quiron-mateo`,
    missionId: horizon.id,
    profileId: 'mateo-ruiz',
    mode: 'emotional',
    private: true,
    messages: [
      { role: 'assistant', text: 'This is your space to talk. Nothing is shared unless you explicitly approve it.', at: horizonStart + 2 * DAY, source: 'local' },
      { role: 'user', text: 'SIMULATED private worry about sleep. Do not copy this into a visit.', at: horizonStart + 2 * DAY + 1000 },
    ],
    createdAt: horizonStart + 2 * DAY,
    updatedAt: horizonStart + 2 * DAY + 1000,
  })

  const auroraStart = now - 24 * DAY
  const auroraClose = now - 3 * DAY
  const aurora = missionShell({
    id: DEMO_MISSIONS.aurora,
    code: 'HELIOS-AURORA',
    name: 'HELIOS Aurora — Completed Mission',
    demoKey: 'aurora',
    stage: 'preflight',
    destination: 'Low Earth orbit (simulated)',
    days: 12,
    crew: 6,
    start: dayKey(auroraStart),
    at: auroraStart - 2 * DAY,
    activities: ['Transit', 'Science', 'Return'],
  })
  const auroraPrep = prepFor(aurora.id, 6, 12, aurora.createdAt, 'ready')
  aurora.prepPercent = computePrepPercent(auroraPrep)
  aurora.analysisStale = false
  db.missions.push(aurora)
  db.memberships.push(...seats(aurora.id, aurora.createdAt, false))
  db.prepItems.push(...auroraPrep)
  applyStart(db, aurora.id, CHIEF, auroraStart)
  addFlightRecords(db, aurora.id, auroraStart, 12, auroraClose)
  applyAdministrativeClose(db, aurora.id, CHIEF, auroraClose)
  const review = buildMissionReview(db, aurora.id, CHIEF, 'chief')
  db.reviewReports.push({
    id: `${aurora.id}-review-v1`,
    missionId: aurora.id,
    version: 1,
    generatedBy: CHIEF,
    createdAt: auroraClose + 1000,
    body: review,
  })
}
