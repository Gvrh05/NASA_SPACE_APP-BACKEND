import { randomBytes } from 'node:crypto'
import { buildMissionPrepChecklist } from './prepPlan'
import type { PlatformDb, PrepItem } from './types'

export function emptyDb(): PlatformDb {
  return {
    profiles: [],
    sessions: [],
    missions: [],
    memberships: [],
    invitations: [],
    prepItems: [],
    prepSnapshots: [],
    healthGrants: [],
    accessAudit: [],
    wakeChecks: [],
    sleepEpisodes: [],
    symptomReports: [],
    healthIndicators: [],
    conversations: [],
    conversationSummaries: [],
    appointments: [],
    evidenceSources: [],
    protocols: [],
  }
}

/** Avance 0–1 de un ítem: con cantidad usa tengo/requerido; sin cantidad, check binario. */
export function prepItemProgress(item: PrepItem): number {
  if (!item.applies || item.status === 'no_aplica') return 0
  if (item.qtyRequired != null && item.qtyRequired > 0) {
    const have = Math.max(0, Number(item.qtyAvailable ?? 0))
    return Math.min(1, have / item.qtyRequired)
  }
  return item.status === 'cargado_verificado' ? 1 : 0
}

export function computePrepPercent(items: PrepItem[]): number {
  const applicable = items.filter((item) => item.applies && item.status !== 'no_aplica')
  if (applicable.length === 0) return 0
  const sum = applicable.reduce((acc, item) => acc + prepItemProgress(item), 0)
  return Math.round((sum / applicable.length) * 1000) / 10
}

export function isPrepItemComplete(item: PrepItem): boolean {
  return prepItemProgress(item) >= 1
}

export function seedPlatform(): PlatformDb {
  const now = Date.now()
  const db = emptyDb()
  const missionId = 'mission-helios-demo'

  db.profiles = [
    { id: 'elena-torres', displayName: 'Elena Torres', title: 'Jefa de misión (demo)', demoRole: 'chief', avatarKey: 'elena' },
    { id: 'mateo-ruiz', displayName: 'Mateo Ruiz', title: 'Tripulante (demo)', demoRole: 'crew', avatarKey: 'mateo' },
    { id: 'sofia-chen', displayName: 'Sofía Chen', title: 'Médica simulada (demo)', demoRole: 'medic', avatarKey: 'sofia' },
    { id: 'alex-morgan', displayName: 'Alex Morgan', title: 'Psicólogo simulado (demo)', demoRole: 'psychologist', avatarKey: 'alex' },
    { id: 'ops-desk', displayName: 'Mesa Ops', title: 'Operaciones / preparación (demo)', demoRole: 'ops', avatarKey: 'ops' },
  ]

  db.prepItems = defaultPrep(missionId, now, 4, 42)
  const percent = computePrepPercent(db.prepItems)

  db.missions = [
    {
      id: missionId,
      code: 'HELIOS-DEMO',
      name: 'HELIOS Demo · Hábitat orbital',
      destination: 'Órbita baja (simulación)',
      environment: 'space_station',
      stage: 'preflight',
      plannedStart: '2026-02-01',
      durationDays: 42,
      /** 4 personas del monitor (Elena, Mateo, Sofía, Alex). Ops no cuenta como asiento. */
      plannedCrewCount: 4,
      timezone: 'UTC',
      activities: ['Operaciones de hábitat', 'Ejercicio diario', 'EVA de demostración', 'Ciencia a bordo'],
      commsNotes: 'Enlace Tierra con demora simulada.',
      storageNotes: 'Inventario limitado; reposición solo en posmisión.',
      prepPercent: percent,
      rosterLocked: false,
      analysisStale: true,
      createdBy: 'elena-torres',
      createdAt: now,
      updatedAt: now,
    },
  ]

  db.memberships = [
    { id: nid(), missionId, profileId: 'elena-torres', role: 'chief', status: 'active', createdAt: now },
    { id: nid(), missionId, profileId: 'mateo-ruiz', role: 'crew', status: 'active', createdAt: now },
    { id: nid(), missionId, profileId: 'sofia-chen', role: 'medic', status: 'active', createdAt: now },
    { id: nid(), missionId, profileId: 'alex-morgan', role: 'psychologist', status: 'active', createdAt: now },
    { id: nid(), missionId, profileId: 'ops-desk', role: 'ops', status: 'active', createdAt: now },
  ]

  db.invitations = [
    { id: nid(), missionId, code: 'HELIOS-DEMO', invitedRole: 'crew', requestedBy: null, status: 'open', createdAt: now },
  ]

  db.evidenceSources = [
    {
      id: 'hrp-evidence',
      title: 'Human Research Roadmap — Evidence',
      institution: 'NASA HRP',
      url: 'https://humanresearchroadmap.nasa.gov/Evidence/',
      kind: 'risk',
      notes: 'Explica riesgos; no diagnostica.',
    },
    {
      id: 'med-ops',
      title: 'Medical Operations (6.0)',
      institution: 'NASA',
      url: 'https://www.nasa.gov/reference/6-0-medical-operations/',
      kind: 'ops',
      notes: 'Contexto operativo; verificar versión.',
    },
    {
      id: 'ochmo-briefs',
      title: 'OCHMO Technical Briefs',
      institution: 'NASA OCHMO',
      url: 'https://www.nasa.gov/ochmo/hsa-standards/ochmo-technical-briefs/',
      kind: 'brief',
      notes: 'Citar documento concreto, no solo el catálogo.',
    },
    {
      id: 'osdr',
      title: 'OSDR / Biological & Physical Data',
      institution: 'NASA',
      url: 'https://science.nasa.gov/biological-physical/data/',
      kind: 'data',
      notes: 'No todo estudio es humano ni clínico.',
    },
    {
      id: 'csa-radiation',
      title: 'How radiation affects the human body in space',
      institution: 'Canadian Space Agency (CSA/ASC)',
      url: 'https://www.asc-csa.gc.ca/eng/astronauts/space-medicine/radiation.asp',
      kind: 'partner',
      notes: 'Educación sobre radiación espacial y ALARA. No es dosis personal del tripulante HELIOS. Consultada 2026-11-15.',
    },
    {
      id: 'csa-sciences',
      title: 'Space science research (CSA)',
      institution: 'Canadian Space Agency (CSA/ASC)',
      url: 'https://www.asc-csa.gc.ca/eng/sciences/',
      kind: 'partner',
      notes: 'Portal partner del reto. Solo citas/enlaces; sin copiar datasets propietarios.',
    },
  ]

  db.protocols = [
    {
      id: 'proto-urgent-v1',
      missionId: null,
      title: 'Ayuda urgente a bordo (demo)',
      version: '1.0',
      body: '1) Avisá al responsable capacitado de la misión.\n2) Buscá profesional a bordo o apoyo remoto.\n3) Seguí solo procedimientos locales versionados.\n4) Registrá qué se solicitó y si hubo respuesta.\nNo inventes dosis ni maniobras no documentadas.',
      audience: 'crew',
      createdAt: now,
    },
    {
      id: 'HELIOS-DEMO-REVIEW-v1',
      missionId: null,
      title: 'Protocolo de revisión de demostración HELIOS',
      version: '1.0.0',
      body: 'Reglas demo (NO clínicas / NO aprobadas por NASA):\n- FC Δ≥20 bpm → cambio observado\n- Temp Δ≥1°C → cambio observado\n- Ánimo ≤2/5 → revisión profesional pendiente (autorreporte)\n- Calidad pobre / dato antiguo → requiere comprobación\n- PA exige sistólica y diastólica\n“Sin alertas” ≠ salud perfecta.',
      audience: 'crew',
      createdAt: now,
    },
  ]

  return db
}

/** Checklist de preembarque pendiente (no pre-marcado). */
export function defaultPrep(
  missionId: string,
  at: number,
  plannedCrewCount = 4,
  durationDays = 42,
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
    ownerProfileId: 'ops-desk',
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

export function nid(): string {
  return randomBytes(8).toString('hex')
}