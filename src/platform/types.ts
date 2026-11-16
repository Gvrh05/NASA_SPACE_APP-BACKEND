export type DemoRole = 'chief' | 'crew' | 'medic' | 'psychologist' | 'ops'
export type MissionStage = 'draft' | 'preflight' | 'aboard' | 'postmission' | 'archived' | 'cancelled'
export type MembershipStatus = 'active' | 'pending' | 'left'
export type InvitationStatus = 'open' | 'pending' | 'accepted' | 'rejected' | 'revoked'
export type PrepStatus =
  | 'propuesto'
  | 'pendiente_revision'
  | 'aprobado'
  | 'disponible'
  | 'faltante'
  | 'cargado_verificado'
  | 'no_aplica'

export type Profile = {
  id: string
  displayName: string
  title: string
  demoRole: DemoRole
  avatarKey: string | null
}

export type DemoSession = {
  token: string
  profileId: string
  createdAt: number
  expiresAt: number
}

/** Mission habitat / vehicle context (demo taxonomy — not clinical thresholds). */
export type MissionEnvironment =
  | 'spacecraft'
  | 'space_station'
  | 'rover'
  | 'surface_base'
  | 'training'

export type Mission = {
  id: string
  code: string
  name: string
  destination: string
  /** Habitat/vehicle context for copy and prep — does not invent medical thresholds. */
  environment: MissionEnvironment
  stage: MissionStage
  plannedStart: string | null
  /** ISO date-time when the simulated flight actually started. */
  actualStart: string | null
  /** ISO date-time of the recorded return. */
  actualReturn: string | null
  durationDays: number
  plannedCrewCount: number
  timezone: string
  /** UTC hour after which the daily check-in may be prompted. */
  wakeHourUtc: number
  activities: string[]
  commsNotes: string
  storageNotes: string
  prepPercent: number
  /** When true, crew roster is frozen (no new members). Set when the mission deploys (aboard). */
  rosterLocked: boolean
  /** When true, plan/crew changed since last analysis — chief must run Analizar again before takeoff. */
  analysisStale: boolean
  /** Stable demo scenario id. Null for missions a person created. */
  demoKey: 'aurora' | 'horizon' | 'pathfinder' | 'genesis' | null
  /** True when the row is simulated demonstration data, not a live clinical record. */
  simulated: boolean
  closedAt: number | null
  closedBy: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type Membership = {
  id: string
  missionId: string
  profileId: string
  role: DemoRole
  status: MembershipStatus
  createdAt: number
}

export type Invitation = {
  id: string
  missionId: string
  code: string
  invitedRole: Exclude<DemoRole, 'chief'>
  requestedBy: string | null
  status: InvitationStatus
  createdAt: number
}

export type PrepItem = {
  id: string
  missionId: string
  category: string
  title: string
  description: string
  source: string
  ownerProfileId: string | null
  qtyRequired: number | null
  qtyAvailable: number | null
  critical: boolean
  status: PrepStatus
  evidence: string
  verifiedBy: string | null
  verifiedAt: number | null
  applies: boolean
  updatedAt: number
}

export type PrepSnapshot = {
  id: string
  missionId: string
  percent: number
  payload: PrepItem[]
  confirmedBy: string
  createdAt: number
}

export type HealthGrant = {
  id: string
  missionId: string
  subjectProfileId: string
  granteeProfileId: string
  categories: string[]
  scopeNote: string
  expiresAt: number | null
  revokedAt: number | null
  /** Null means the professional has not accepted yet. Missing means a legacy active grant. */
  acceptedAt?: number | null
  createdAt: number
}

export type AccessAudit = {
  id: string
  missionId: string | null
  actorProfileId: string | null
  action: string
  detail: string
  createdAt: number
}

export type WakeCheck = {
  id: string
  missionId: string
  profileId: string
  periodKey: string
  status: 'pending' | 'completed' | 'skipped'
  payload: Record<string, unknown>
  createdAt: number
}

export type SleepEpisode = {
  id: string
  missionId: string
  profileId: string
  startAt: number
  endAt: number
  quality: number | null
  kind: string
  createdAt: number
}

export type SymptomReport = {
  id: string
  missionId: string
  profileId: string
  description: string
  startedAt: number | null
  intensity: number | null
  context: string
  source: string
  /** Optional body region id for body-map linking (e.g. head, chest, abdomen). */
  bodyRegion: string | null
  /** Historical clinical state. Closing a mission must not rewrite this. */
  status: 'open' | 'monitoring' | 'resolved'
  createdAt: number
}

export type PainLaterality = 'left' | 'right' | 'midline'
export type PainAspect = 'anterior' | 'posterior' | 'lateral' | 'unspecified'
export type PainPattern = 'constant' | 'intermittent'
export type PainFollowUp = 'open' | 'monitoring' | 'resolved'

/**
 * One surface mark on HELIOS mannequin model space.
 * localPosition is meters in the model frame (+X person's left, +Y up, +Z anterior).
 * It is an approximate self-report, not an organ or a validated landmark.
 */
export type PainMark = {
  id: string
  kind: 'point' | 'region'
  regionId: string
  detectedRegionId: string
  regionLabel: string
  labelSource: 'auto' | 'user'
  laterality: PainLaterality
  aspect: PainAspect
  localPosition: { x: number; y: number; z: number }
  normal: { x: number; y: number; z: number }
  surfaceId: string
  intensity: number
  startedAt: number | null
  pattern: PainPattern
  description: string
  activity: string
  additionalSymptoms: string
  notes: string
}

export type PainRevision = {
  at: number
  actorProfileId: string
  action: 'created' | 'corrected' | 'status' | 'linked'
  note: string
  marks: PainMark[]
}

/** Professional observation. Never replaces the person's marks or description. */
export type ClinicalPainNote = {
  id: string
  authorProfileId: string
  appointmentId: string | null
  body: string
  createdAt: number
}

export type PainMapReport = {
  id: string
  missionId: string
  profileId: string
  symptomReportId: string | null
  appointmentId: string | null
  modelId: string
  modelVersion: string
  origin: 'self_report'
  status: PainFollowUp
  marks: PainMark[]
  revisions: PainRevision[]
  clinicalNotes: ClinicalPainNote[]
  followsReportId: string | null
  createdAt: number
  updatedAt: number
}

export type IndicatorKind =
  | 'heart_rate'
  | 'blood_pressure'
  | 'spo2'
  | 'glucose'
  | 'temperature'
  | 'respiratory_rate'
  | 'sleep_hours'
  | 'mood'

export type IndicatorOrigin = 'manual' | 'sensor' | 'import' | 'simulation'
export type IndicatorQuality = 'good' | 'fair' | 'poor' | 'unknown'

/** Manual or imported health indicator reading (platform care layer). */
export type HealthIndicatorReading = {
  id: string
  missionId: string
  profileId: string
  kind: IndicatorKind
  measuredAt: number
  /** Primary value. For blood_pressure this is systolic (mmHg). */
  value: number
  /** Secondary value. For blood_pressure this is diastolic (mmHg). */
  valueSecondary: number | null
  unit: string
  origin: IndicatorOrigin
  context: string
  quality: IndicatorQuality
  /** Age after which UI should flag the reading as stale (ms). */
  staleAfterMs: number
  notes: string
  bodyRegion: string | null
  createdAt: number
}

export type Conversation = {
  id: string
  missionId: string
  profileId: string
  mode: 'physical' | 'emotional'
  private: boolean
  messages: { role: 'user' | 'assistant'; text: string; at: number; source?: 'model' | 'local'; model?: string; notice?: string; sources?: string[]; toolsUsed?: { name: string; status: string }[] }[]
  createdAt: number
  updatedAt: number
}

export type ConversationSummary = {
  id: string
  conversationId: string
  body: string
  approved: boolean
  shareWith: string | null
  createdAt: number
}

export type AppointmentStatus = 'requested' | 'pending_confirm' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed'
export type AppointmentSpecialty = 'medical' | 'psychological'

export type AppointmentChange = {
  at: number
  actorId: string
  action: string
  from: AppointmentStatus | null
  to: AppointmentStatus
  note: string
}

export type Appointment = {
  id: string
  missionId: string
  requesterId: string
  professionalId: string | null
  specialty: AppointmentSpecialty | string
  modality: string
  reason: string
  /** Voluntary summary the person agreed to share. Not a Quirón transcript. */
  summary: string
  /** Restricted to the assigned professional. */
  professionalNotes: string
  /** What the person authorized for this visit. */
  shareCategories: string[]
  status: AppointmentStatus
  scheduledAt: number | null
  durationMin: number
  timezone: string
  outcome: string
  cancelReason: string
  followUpOf: string | null
  history: AppointmentChange[]
  simulated: boolean
  createdAt: number
  updatedAt: number
}

export type AvailabilityWindow = {
  id: string
  missionId: string
  profileId: string
  /** Null = every weekday. */
  weekday: number | null
  startMin: number
  endMin: number
  slotMin: number
}

export type InventoryItem = {
  id: string
  missionId: string
  name: string
  kind: 'reusable' | 'consumable'
  unit: string
  qtyOnHand: number
  qtyPlanned: number
  simulated: boolean
}

export type InventoryMovement = {
  id: string
  missionId: string
  itemId: string
  delta: number
  reason: string
  actorProfileId: string
  at: number
  simulated: boolean
}

export type MissionAlert = {
  id: string
  missionId: string
  subjectProfileId: string | null
  title: string
  detail: string
  status: 'active' | 'monitoring' | 'closed'
  simulated: boolean
  openedAt: number
  updatedAt: number
}

export type ReviewStatement = {
  kind: 'observation' | 'proposal'
  text: { en: string; es: string }
  basis: { en: string; es: string }
}

export type MissionReview = {
  simulated: true
  stage: MissionStage
  disclaimer: { en: string; es: string }
  flight: {
    name: string
    destination: string
    timezone: string
    actualStart: string | null
    actualReturn: string | null
    closedAt: number | null
    closedBy: string | null
    durationDays: number
    crewCount: number
    prepPercent: number
  }
  indicators: { kind: string; count: number; staleCount: number }[]
  rest: { profileId: string; sleepEpisodes: number; checkInsCompleted: number; checkInsPending: number }[]
  episodes: { open: number; monitoring: number; resolved: number }
  alerts: { id: string; title: string; status: MissionAlert['status']; subjectProfileId: string | null }[]
  resources: {
    name: string
    kind: InventoryItem['kind']
    qtyOnHand: number
    qtyPlanned: number
    movements: number
    note: 'underused' | 'short' | 'used' | 'steady'
  }[]
  care: {
    visibleDetail: boolean
    byStatus: Partial<Record<AppointmentStatus, number>>
    pendingAtClose: { id: string; status: string; specialty: string; label: string }[]
    items: Record<string, unknown>[]
  }
  lessons: ReviewStatement[]
  recommendations: ReviewStatement[]
}

export type ReviewReport = {
  id: string
  missionId: string
  version: number
  generatedBy: string
  createdAt: number
  body: MissionReview
}

export type EvidenceSource = {
  id: string
  title: string
  institution: string
  url: string
  kind: string
  notes: string
}

export type Protocol = {
  id: string
  missionId: string | null
  title: string
  version: string
  body: string
  audience: string
  createdAt: number
}

export type UserMemory = {
  id: string
  profileId: string
  title: string
  message: string
  imageFileId: string | null
  imageContentType: string | null
  createdAt: number
  updatedAt: number
}

export type PlatformDb = {
  profiles: Profile[]
  sessions: DemoSession[]
  missions: Mission[]
  memberships: Membership[]
  invitations: Invitation[]
  prepItems: PrepItem[]
  prepSnapshots: PrepSnapshot[]
  healthGrants: HealthGrant[]
  accessAudit: AccessAudit[]
  wakeChecks: WakeCheck[]
  sleepEpisodes: SleepEpisode[]
  symptomReports: SymptomReport[]
  painReports: PainMapReport[]
  healthIndicators: HealthIndicatorReading[]
  conversations: Conversation[]
  conversationSummaries: ConversationSummary[]
  appointments: Appointment[]
  availability: AvailabilityWindow[]
  inventoryItems: InventoryItem[]
  inventoryMovements: InventoryMovement[]
  missionAlerts: MissionAlert[]
  reviewReports: ReviewReport[]
  evidenceSources: EvidenceSource[]
  protocols: Protocol[]
  userMemories: UserMemory[]
}