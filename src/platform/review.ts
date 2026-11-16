import type {
  Appointment,
  AppointmentStatus,
  DemoRole,
  MissionReview,
  PlatformDb,
  ReviewStatement,
} from './types'

const DISCLAIMER = {
  en: 'Simulated demonstration review. Observations describe this scenario only. Proposals are for human review and are not applied to another mission automatically. Demo rules are not validated clinical criteria.',
  es: 'Revisión de demostración simulada. Las observaciones describen solo este escenario. Las propuestas quedan para revisión humana y no se aplican solas a otra misión. Las reglas demo no son criterios clínicos validados.',
}

export function presentAppointment(item: Appointment, viewerId: string, role: DemoRole | string) {
  const assigned = item.professionalId === viewerId
  const owner = item.requesterId === viewerId
  const operationalOnly = role === 'chief' || role === 'ops' || (!assigned && !owner)
  const history = (item.history || []).map((change) => ({
    at: change.at,
    actorId: change.actorId,
    action: change.action,
    from: change.from,
    to: change.to,
    note: operationalOnly && change.action !== 'administrative_close' ? '' : change.note,
  }))
  const base = {
    id: item.id,
    missionId: item.missionId,
    requesterId: item.requesterId,
    professionalId: item.professionalId,
    specialty: item.specialty,
    modality: item.modality,
    status: item.status,
    scheduledAt: item.scheduledAt,
    durationMin: item.durationMin,
    timezone: item.timezone,
    followUpOf: item.followUpOf,
    simulated: item.simulated,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    history,
  }
  if (operationalOnly) return base
  return {
    ...base,
    reason: item.reason,
    summary: item.summary,
    shareCategories: item.shareCategories,
    outcome: item.outcome,
    cancelReason: item.cancelReason,
    professionalNotes: assigned ? item.professionalNotes : '',
  }
}

export function canSeeAppointment(item: Appointment, viewerId: string, role: DemoRole | string) {
  if (role === 'chief' || role === 'ops') return true
  if (item.requesterId === viewerId || item.professionalId === viewerId) return true
  return false
}

function statement(
  kind: ReviewStatement['kind'],
  en: string,
  es: string,
  basisEn: string,
  basisEs: string,
): ReviewStatement {
  return { kind, text: { en, es }, basis: { en: basisEn, es: basisEs } }
}

export function buildMissionReview(db: PlatformDb, missionId: string, viewerId: string, role: DemoRole): MissionReview {
  const mission = db.missions.find((item) => item.id === missionId)
  if (!mission) throw new Error('Mission not found')
  const members = db.memberships.filter((item) => item.missionId === missionId && item.status === 'active' && item.role !== 'ops')
  const indicators = db.healthIndicators.filter((item) => item.missionId === missionId)
  const now = Date.now()
  const byKind = new Map<string, { count: number; stale: number }>()
  for (const reading of indicators) {
    const row = byKind.get(reading.kind) || { count: 0, stale: 0 }
    row.count += 1
    if (now - reading.measuredAt > reading.staleAfterMs) row.stale += 1
    byKind.set(reading.kind, row)
  }
  const checks = db.wakeChecks.filter((item) => item.missionId === missionId)
  const sleep = db.sleepEpisodes.filter((item) => item.missionId === missionId)
  const symptoms = db.symptomReports.filter((item) => item.missionId === missionId)
  const appointments = db.appointments.filter((item) => item.missionId === missionId)
  const byStatus: Partial<Record<AppointmentStatus, number>> = {}
  for (const item of appointments) byStatus[item.status] = (byStatus[item.status] || 0) + 1
  const pendingAtClose = appointments
    .filter((item) => item.status === 'confirmed' || item.status === 'rescheduled' || item.status === 'requested' || item.status === 'pending_confirm')
    .filter((item) => canSeeAppointment(item, viewerId, role))
    .map((item) => ({
      id: item.id,
      status: item.status,
      specialty: String(item.specialty),
      label: role === 'chief' || role === 'ops'
        ? 'Open at close — not marked completed'
        : item.reason || item.status,
    }))
  const adminClosed = appointments.filter((item) =>
    item.status === 'cancelled' && item.history?.some((change) => change.action === 'administrative_close'))
  const resources = db.inventoryItems.filter((item) => item.missionId === missionId).map((item) => {
    const movements = db.inventoryMovements.filter((move) => move.itemId === item.id).length
    const note = item.qtyOnHand < item.qtyPlanned * 0.5
      ? 'short' as const
      : movements === 0 && item.qtyOnHand >= item.qtyPlanned
        ? 'underused' as const
        : movements > 0
          ? 'used' as const
          : 'steady' as const
    return {
      name: item.name,
      kind: item.kind,
      qtyOnHand: item.qtyOnHand,
      qtyPlanned: item.qtyPlanned,
      movements,
      note,
    }
  })
  const checkInsCompleted = checks.filter((item) => item.status === 'completed').length
  const checkInsPending = checks.filter((item) => item.status !== 'completed').length
  const openSymptoms = symptoms.filter((item) => item.status !== 'resolved').length
  const shortResources = resources.filter((item) => item.note === 'short')
  const underused = resources.filter((item) => item.note === 'underused')
  const staleCount = [...byKind.values()].reduce((sum, row) => sum + row.stale, 0)

  const lessons: ReviewStatement[] = [
    statement(
      'observation',
      `${checkInsCompleted} daily check-ins were completed and ${checkInsPending} stayed incomplete in the stored record.`,
      `Se completaron ${checkInsCompleted} chequeos diarios y ${checkInsPending} quedaron incompletos en el registro.`,
      'Counted from wake-check rows for this mission. A missing check-in is not a diagnosis.',
      'Conteo de chequeos de esta misión. Un chequeo faltante no es un diagnóstico.',
    ),
    statement(
      'observation',
      `${openSymptoms} symptom report(s) were still open or in monitoring when this review was built. Closing the mission did not mark them resolved.`,
      `${openSymptoms} reporte(s) de síntomas seguían abiertos o en seguimiento al armar esta revisión. Cerrar la misión no los marcó como resueltos.`,
      'Symptom status field, unchanged by mission close.',
      'Campo de estado del síntoma, sin cambios por el cierre.',
    ),
  ]
  if (staleCount) {
    lessons.push(statement(
      'observation',
      `${staleCount} indicator reading(s) are older than their freshness window and should be treated as historical.`,
      `${staleCount} lectura(s) superan su ventana de frescura y deben tratarse como históricas.`,
      'measuredAt plus staleAfterMs on each reading.',
      'measuredAt más staleAfterMs de cada lectura.',
    ))
  }
  if (adminClosed.length) {
    lessons.push(statement(
      'observation',
      `${adminClosed.length} future or still-open visit request(s) were closed administratively. They were not marked completed and no care-delivered notice was created.`,
      `${adminClosed.length} solicitud(es) futura(s) o aún abiertas se cerraron de forma administrativa. No se marcaron como realizadas ni se inventó un aviso de atención.`,
      'Appointment history action administrative_close.',
      'Acción de historial administrative_close.',
    ))
  }

  const recommendations: ReviewStatement[] = []
  if (checkInsPending > 0) {
    recommendations.push(statement(
      'proposal',
      'For another flight, review whether the daily check-in prompt matches the crew wake hour. This proposal does not change any mission.',
      'Para otro vuelo, revisar si el aviso de chequeo diario coincide con la hora de despertar. Esta propuesta no modifica ninguna misión.',
      `This flight still has ${checkInsPending} incomplete check-in row(s).`,
      `Este vuelo conserva ${checkInsPending} chequeo(s) incompleto(s).`,
    ))
  }
  if (shortResources.length) {
    recommendations.push(statement(
      'proposal',
      `Review packing for ${shortResources.map((item) => item.name).join(', ')}: on-hand quantity finished below half of the planned amount.`,
      `Revisar el embarque de ${shortResources.map((item) => item.name).join(', ')}: la cantidad disponible quedó por debajo de la mitad de lo planificado.`,
      'Inventory on-hand compared with qty planned in this simulated scenario.',
      'Inventario disponible comparado con lo planificado en este escenario simulado.',
    ))
  }
  if (underused.length) {
    recommendations.push(statement(
      'proposal',
      `Consider whether ${underused.map((item) => item.name).join(', ')} should be carried next time: no movements were recorded.`,
      `Valorar si ${underused.map((item) => item.name).join(', ')} debe viajar la próxima vez: no hubo movimientos registrados.`,
      'Inventory movements for this mission are zero while stock stayed at the planned level.',
      'Los movimientos de inventario de esta misión son cero y el stock siguió en el nivel planificado.',
    ))
  }
  if (mission.prepPercent < 100) {
    recommendations.push(statement(
      'proposal',
      'Before another flight, repeat the preparation checklist instead of copying this mission automatically. Critical items should be verified again.',
      'Antes de otro vuelo, repetir el checklist de preparación en lugar de copiar esta misión. Los ítems críticos deben verificarse de nuevo.',
      `Stored preparation at close was ${mission.prepPercent}%.`,
      `La preparación guardada al cierre fue ${mission.prepPercent}%.`,
    ))
  }
  if (!recommendations.length) {
    recommendations.push(statement(
      'proposal',
      'No packing change is proposed from this snapshot. A future crew should still run its own preparation.',
      'Esta instantánea no propone un cambio de embarque. Una tripulación futura igual debe hacer su propia preparación.',
      'No short or unused resource crossed the demo threshold.',
      'Ningún recurso corto o sin uso cruzó el umbral de la demo.',
    ))
  }

  const visible = appointments.filter((item) => canSeeAppointment(item, viewerId, role))
  return {
    simulated: true,
    stage: mission.stage,
    disclaimer: DISCLAIMER,
    flight: {
      name: mission.name,
      destination: mission.destination,
      timezone: mission.timezone || 'UTC',
      actualStart: mission.actualStart,
      actualReturn: mission.actualReturn,
      closedAt: mission.closedAt,
      closedBy: mission.closedBy,
      durationDays: mission.durationDays,
      crewCount: members.length,
      prepPercent: mission.prepPercent,
    },
    indicators: [...byKind.entries()].map(([kind, row]) => ({ kind, count: row.count, staleCount: row.stale })),
    rest: members.map((member) => ({
      profileId: member.profileId,
      sleepEpisodes: sleep.filter((item) => item.profileId === member.profileId).length,
      checkInsCompleted: checks.filter((item) => item.profileId === member.profileId && item.status === 'completed').length,
      checkInsPending: checks.filter((item) => item.profileId === member.profileId && item.status !== 'completed').length,
    })),
    episodes: {
      open: symptoms.filter((item) => item.status === 'open').length,
      monitoring: symptoms.filter((item) => item.status === 'monitoring').length,
      resolved: symptoms.filter((item) => item.status === 'resolved').length,
    },
    alerts: db.missionAlerts
      .filter((item) => item.missionId === missionId)
      .map((item) => ({ id: item.id, title: item.title, status: item.status, subjectProfileId: item.subjectProfileId })),
    resources,
    care: {
      visibleDetail: role !== 'chief' && role !== 'ops',
      byStatus,
      pendingAtClose,
      items: visible.map((item) => presentAppointment(item, viewerId, role)),
    },
    lessons,
    recommendations,
  }
}
