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

export type Mission = {
  id: string
  code: string
  name: string
  destination: string
  stage: MissionStage
  plannedStart: string | null
  durationDays: number
  plannedCrewCount: number
  timezone: string
  activities: string[]
  commsNotes: string
  storageNotes: string
  prepPercent: number
  /** When true, crew roster is frozen (no new members / role changes). Set after saving AI prep checklist. */
  rosterLocked: boolean
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

export type Appointment = {
  id: string
  missionId: string
  requesterId: string
  professionalId: string | null
  specialty: string
  modality: string
  reason: string
  summary: string
  status: 'requested' | 'pending_confirm' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed'
  scheduledAt: number | null
  createdAt: number
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
  conversations: Conversation[]
  conversationSummaries: ConversationSummary[]
  appointments: Appointment[]
  evidenceSources: EvidenceSource[]
  protocols: Protocol[]
}