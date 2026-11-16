import { installDemoScenarios } from './demoScenarios'
import { buildMissionPrepChecklist } from './prepPlan'
import { computePrepPercent, isPrepItemComplete, nid, prepItemProgress } from './prepMath'
import type { PlatformDb, PrepItem } from './types'

export { computePrepPercent, isPrepItemComplete, nid, prepItemProgress }

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
    painReports: [],
    healthIndicators: [],
    conversations: [],
    conversationSummaries: [],
    appointments: [],
    availability: [],
    inventoryItems: [],
    inventoryMovements: [],
    missionAlerts: [],
    reviewReports: [],
    evidenceSources: [],
    protocols: [],
  }
}

export function seedPlatform(): PlatformDb {
  const now = Date.now()
  const db = emptyDb()

  db.profiles = [
    { id: 'elena-torres', displayName: 'Elena Torres', title: 'Jefa de misión (demo)', demoRole: 'chief', avatarKey: 'elena' },
    { id: 'mateo-ruiz', displayName: 'Mateo Ruiz', title: 'Tripulante (demo)', demoRole: 'crew', avatarKey: 'mateo' },
    { id: 'sofia-chen', displayName: 'Sofía Chen', title: 'Médica simulada (demo)', demoRole: 'medic', avatarKey: 'sofia' },
    { id: 'alex-morgan', displayName: 'Alex Morgan', title: 'Psicólogo simulado (demo)', demoRole: 'psychologist', avatarKey: 'alex' },
    { id: 'ops-desk', displayName: 'Operations desk', title: 'Operaciones / preparación (demo)', demoRole: 'ops', avatarKey: 'ops' },
  ]

  db.evidenceSources = [
    {
      id: 'hrp-evidence',
      title: 'Human Research Roadmap — Evidence',
      institution: 'NASA HRP',
      url: 'https://humanresearchroadmap.nasa.gov/Evidence/',
      kind: 'risk',
      notes: 'Explains risks; does not diagnose.',
    },
    {
      id: 'med-ops',
      title: 'Medical Operations (6.0)',
      institution: 'NASA',
      url: 'https://www.nasa.gov/reference/6-0-medical-operations/',
      kind: 'ops',
      notes: 'Operational context; verify the version.',
    },
    {
      id: 'ochmo-briefs',
      title: 'OCHMO Technical Briefs',
      institution: 'NASA OCHMO',
      url: 'https://www.nasa.gov/ochmo/hsa-standards/ochmo-technical-briefs/',
      kind: 'brief',
      notes: 'Cite the specific document, not just the catalog.',
    },
    {
      id: 'osdr',
      title: 'OSDR / Biological & Physical Data',
      institution: 'NASA',
      url: 'https://science.nasa.gov/biological-physical/data/',
      kind: 'data',
      notes: 'Not every study involves humans or clinical research.',
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

  installDemoScenarios(db, now)
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
