export type PlatformMissionStage = 'draft' | 'preflight' | 'aboard' | 'postmission' | 'archived' | 'cancelled'
export type SimulatorMissionStage = 'preembarque' | 'a_bordo' | 'posmision'

export type SimulatorMissionContext = {
  id: string
  name: string
  destination: string
  stage: PlatformMissionStage
  durationDays: number
  crewCount: number
  activities: string[]
}

/** El simulador solo tiene tres etapas. Cancelada queda cerrada, no vuelve a preembarque. */
export function simulatorStage(stage: PlatformMissionStage): SimulatorMissionStage {
  if (stage === 'aboard') return 'a_bordo'
  if (stage === 'postmission' || stage === 'archived' || stage === 'cancelled') return 'posmision'
  return 'preembarque'
}
