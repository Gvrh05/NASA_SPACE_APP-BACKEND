import type { MissionStage } from './types'

/** Actions gated by mission stage. Reads of existing records are separate and stay allowed. */
export type StageAction =
  | 'configure'
  | 'prep_write'
  | 'begin_prep'
  | 'clinical_write'
  | 'quiron_prep'
  | 'quiron_flight'
  | 'close_mission'
  | 'review_generate'

const MATRIX: Record<MissionStage, readonly StageAction[]> = {
  draft: ['configure', 'begin_prep', 'quiron_prep'],
  preflight: ['configure', 'prep_write', 'begin_prep', 'quiron_prep'],
  aboard: ['clinical_write', 'quiron_prep', 'quiron_flight', 'close_mission'],
  postmission: ['review_generate'],
  archived: [],
  cancelled: [],
}

export function stageAllows(stage: MissionStage, action: StageAction): boolean {
  return MATRIX[stage].includes(action)
}

export function stageDeniedMessage(action: StageAction, stage: MissionStage): string {
  if (action === 'clinical_write' && (stage === 'postmission' || stage === 'archived' || stage === 'cancelled')) {
    return 'This mission is completed. You can read the history, but you cannot start a new operation. The text in the form stays on this screen.'
  }
  if (action === 'clinical_write') {
    return 'Daily Check-ins, symptoms, rest, and visits are available only while the mission is in flight.'
  }
  if (action === 'prep_write' && stage === 'draft') {
    return 'Preparation has not started. Save the plan and generate the checklist to move to preflight.'
  }
  if (action === 'prep_write') {
    return 'The preparation checklist is read-only at this stage.'
  }
  if (action === 'configure') {
    return 'Mission settings cannot be changed at this stage.'
  }
  if (action === 'quiron_flight') {
    return 'Quirón’s in-flight support is available only while the mission is in flight.'
  }
  if (action === 'quiron_prep') {
    return 'Quirón no longer guides preparation at this stage.'
  }
  if (action === 'close_mission') {
    return 'Only an in-flight mission can be completed.'
  }
  if (action === 'review_generate') {
    return 'The mission review is saved once the mission is completed.'
  }
  return `This action is not available at the current stage (${stage}).`
}
