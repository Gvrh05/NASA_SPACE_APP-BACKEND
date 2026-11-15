import { randomBytes } from 'node:crypto'
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
    conversations: [],
    conversationSummaries: [],
    appointments: [],
    evidenceSources: [],
    protocols: [],
  }
}

export function computePrepPercent(items: PrepItem[]): number {
  const applicable = items.filter((item) => item.applies && item.status !== 'no_aplica')
  if (applicable.length === 0) return 0
  const done = applicable.filter((item) => item.status === 'cargado_verificado').length
  return Math.round((done / applicable.length) * 1000) / 10
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

  db.prepItems = defaultPrep(missionId, now)
  const percent = computePrepPercent(db.prepItems)

  db.missions = [
    {
      id: missionId,
      code: 'HELIOS-DEMO',
      name: 'HELIOS Demo · Hábitat orbital',
      destination: 'Órbita baja (simulación)',
      stage: 'aboard',
      plannedStart: '2026-02-01',
      durationDays: 42,
      plannedCrewCount: 5,
      timezone: 'UTC',
      activities: ['Operaciones de hábitat', 'Ejercicio diario', 'EVA de demostración', 'Ciencia a bordo'],
      commsNotes: 'Enlace Tierra con demora simulada.',
      storageNotes: 'Inventario limitado; reposición solo en posmisión.',
      prepPercent: percent,
      rosterLocked: false,
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
  ]

  return db
}

function defaultPrep(missionId: string, at: number): PrepItem[] {
  const base = (item: Omit<PrepItem, 'missionId' | 'updatedAt' | 'verifiedBy' | 'verifiedAt' | 'ownerProfileId' | 'evidence'> & { evidence?: string }): PrepItem => ({
    ...item,
    missionId,
    updatedAt: at,
    ownerProfileId: 'ops-desk',
    evidence: item.evidence ?? '',
    verifiedBy: item.status === 'cargado_verificado' ? 'elena-torres' : null,
    verifiedAt: item.status === 'cargado_verificado' ? at : null,
  })

  return [
    base({
      id: `${missionId}-hygiene`,
      category: 'higiene',
      title: 'Material de higiene',
      description: 'Consumibles de higiene para la duración planificada.',
      source: 'Regla logística HELIOS (demo)',
      critical: true,
      status: 'cargado_verificado',
      applies: true,
      qtyRequired: 42,
      qtyAvailable: 42,
      evidence: 'Verificado en gabinete A',
    }),
    base({
      id: `${missionId}-eval`,
      category: 'monitoreo',
      title: 'Kit de evaluación',
      description: 'Equipos reutilizables de evaluación a bordo.',
      source: 'HRP Evidence (contexto)',
      critical: true,
      status: 'cargado_verificado',
      applies: true,
      qtyRequired: 1,
      qtyAvailable: 1,
      evidence: 'Checklist firmado',
    }),
    base({
      id: `${missionId}-oximeter`,
      category: 'monitoreo',
      title: 'Oxímetro',
      description: 'Cobertura y redundancia; no por persona×día.',
      source: 'Inventario HELIOS',
      critical: true,
      status: 'cargado_verificado',
      applies: true,
      qtyRequired: 2,
      qtyAvailable: 2,
    }),
    base({
      id: `${missionId}-comms`,
      category: 'comunicacion',
      title: 'Canal de asistencia',
      description: 'Procedimiento de enlace Tierra / demora.',
      source: 'Medical Operations 6.0 (referencia)',
      critical: false,
      status: 'disponible',
      applies: true,
      qtyRequired: null,
      qtyAvailable: null,
    }),
    base({
      id: `${missionId}-wellbeing`,
      category: 'bienestar',
      title: 'Recursos de descanso',
      description: 'Materiales no clínicos de bienestar.',
      source: 'Planificación HELIOS',
      critical: false,
      status: 'cargado_verificado',
      applies: true,
      qtyRequired: null,
      qtyAvailable: null,
    }),
    base({
      id: `${missionId}-eva`,
      category: 'entrenamiento',
      title: 'Briefing EVA de demostración',
      description: 'Contexto técnico; no umbral clínico automático.',
      source: 'Documentos EVA adjuntos (revisión)',
      critical: false,
      status: 'pendiente_revision',
      applies: true,
      qtyRequired: null,
      qtyAvailable: null,
    }),
  ]
}

export function nid(): string {
  return randomBytes(8).toString('hex')
}