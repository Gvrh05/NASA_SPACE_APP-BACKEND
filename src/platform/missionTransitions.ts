import { BadRequestException } from '@nestjs/common'
import { computePrepPercent, isPrepItemComplete, nid } from './prepMath'
import type { Mission, PlatformDb, PrepItem } from './types'

export const ADMIN_CLOSE_REASON =
  'Administrative close when the mission ended. This was not a completed visit and not a resolved case.'

export function evaluateStartOn(db: PlatformDb, missionId: string) {
  const mission = db.missions.find((item) => item.id === missionId)
  if (!mission) throw new BadRequestException('Mission not found')
  const items = db.prepItems.filter((item) => item.missionId === missionId)
  const percent = computePrepPercent(items)
  const applicable = items.filter((item) => item.applies && item.status !== 'no_aplica')
  const criticalPending = applicable.filter((item) => item.critical && !isPrepItemComplete(item))
  const activeMembers = db.memberships.filter((item) => item.missionId === missionId && item.status === 'active')
  const crewSeats = activeMembers.filter((item) => item.role !== 'ops')
  const blockers: string[] = []
  if (mission.stage !== 'preflight') blockers.push('A flight can start only from Preflight')
  if (mission.analysisStale) blockers.push('The plan changed since the last analysis. Run it again before takeoff.')
  if (percent < 80) blockers.push(`Preparation ${percent}% < 80% (HELIOS simulation rule)`)
  if (criticalPending.length) blockers.push(`${criticalPending.length} critical item(s) not verified`)
  if (crewSeats.length < 1) blockers.push('No active members')
  if (crewSeats.length > mission.plannedCrewCount) blockers.push('Active members exceed the planned crew size')
  return {
    ok: blockers.length === 0,
    percent,
    analysisStale: Boolean(mission.analysisStale),
    blockers,
    criticalPending: criticalPending.map((item) => item.id),
    activeMembers: crewSeats.length,
    plannedCrewCount: mission.plannedCrewCount,
    disclaimer: 'The 80% rule is a HELIOS simulation rule, not medical certification or a NASA requirement.',
  }
}

/** Same checks the chief runs when starting a simulated flight. */
export function applyStart(db: PlatformDb, missionId: string, actorId: string, at: number) {
  const evaluation = evaluateStartOn(db, missionId)
  if (!evaluation.ok) {
    throw new BadRequestException({ message: evaluation.blockers.join(' · '), ...evaluation })
  }
  const mission = db.missions.find((item) => item.id === missionId) as Mission
  const items = db.prepItems.filter((item) => item.missionId === missionId)
  db.prepSnapshots.push({
    id: nid(),
    missionId,
    percent: evaluation.percent,
    payload: structuredClone(items) as PrepItem[],
    confirmedBy: actorId,
    createdAt: at,
  })
  mission.stage = 'aboard'
  mission.rosterLocked = true
  mission.analysisStale = false
  mission.prepPercent = evaluation.percent
  mission.actualStart = new Date(at).toISOString()
  mission.updatedAt = at
  db.accessAudit.push({
    id: nid(),
    missionId,
    actorProfileId: actorId,
    action: 'start-simulated',
    detail: `${evaluation.percent}%`,
    createdAt: at,
  })
  return evaluation
}

/**
 * Closes a flight. Future visits and open requests are cancelled administratively.
 * Past unfinished visits and symptom statuses stay as they were.
 */
export function applyAdministrativeClose(db: PlatformDb, missionId: string, actorId: string, at: number) {
  const mission = db.missions.find((item) => item.id === missionId)
  if (!mission) throw new BadRequestException('Mission not found')
  if (mission.stage !== 'aboard') {
    throw new BadRequestException('Only an in-flight mission can be completed.')
  }
  for (const appointment of db.appointments) {
    if (appointment.missionId !== missionId) continue
    if (appointment.status === 'completed' || appointment.status === 'cancelled') continue
    const future = appointment.scheduledAt == null || appointment.scheduledAt > at
    const openRequest = appointment.status === 'requested' || appointment.status === 'pending_confirm'
    if (!future && !openRequest) continue
    const from = appointment.status
    appointment.status = 'cancelled'
    appointment.cancelReason = ADMIN_CLOSE_REASON
    appointment.updatedAt = at
    appointment.history = appointment.history || []
    appointment.history.push({
      at,
      actorId,
      action: 'administrative_close',
      from,
      to: 'cancelled',
      note: ADMIN_CLOSE_REASON,
    })
  }
  mission.stage = 'postmission'
  mission.closedAt = at
  mission.closedBy = actorId
  mission.actualReturn = new Date(at).toISOString()
  mission.rosterLocked = true
  mission.analysisStale = false
  mission.updatedAt = at
  db.accessAudit.push({
    id: nid(),
    missionId,
    actorProfileId: actorId,
    action: 'mission-close',
    detail: ADMIN_CLOSE_REASON,
    createdAt: at,
  })
}
