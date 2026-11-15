/** Render only fields actually returned by an authorized read-only tool. */
export function localEvidenceText(name: string, value: unknown, en: boolean): string {
  const data = value as Record<string, unknown>
  const measurement = data.measurement as { value?: unknown; unit?: string } | null | undefined
  if (name === 'getLatestVitals') return typeof measurement?.value === 'number'
    ? en ? `The authorized simulated pulse record is ${measurement.value} ${measurement.unit ?? 'bpm'}. It is a recorded reading, not a diagnosis or proof of your current condition.`
      : `El registro simulado autorizado de pulso es ${measurement.value} ${measurement.unit ?? 'lpm'}. Es una lectura registrada, no un diagnóstico ni una confirmación de tu estado actual.`
    : en ? 'There is no reliable pulse reading available in the authorized context.' : 'No hay una lectura confiable de pulso disponible en el contexto autorizado.'
  if (name === 'getVitalTrends') return typeof data.currentHr === 'number'
    ? en ? `Simulated pulse: ${data.currentHr} bpm. Individual baseline: ${data.hrMin}–${data.hrMax} bpm. Usable samples: ${data.sampleCount}. The comparison does not establish a cause.`
      : `Pulso simulado: ${data.currentHr} lpm. Referencia individual: ${data.hrMin}–${data.hrMax} lpm. Muestras utilizables: ${data.sampleCount}. La comparación no establece una causa.`
    : en ? 'There is no current reliable pulse reading for a trend comparison. Missing evidence does not establish stability.' : 'No hay un pulso actual confiable para comparar la tendencia. La falta de evidencia no demuestra estabilidad.'
  if (name === 'getMeasurementQuality') {
    if (data.ageMinutes === null) return en ? 'No pulse reading is available to check its quality or age.' : 'No hay una lectura de pulso para comprobar su calidad o antigüedad.'
    const statuses: Record<string, string> = en
      ? { valid: 'passes the checks', stale: 'is old', frozen: 'has repeated values that need verification', pending: 'is pending verification' }
      : { valid: 'supera las comprobaciones', stale: 'es antigua', frozen: 'tiene valores repetidos que necesitan verificación', pending: 'está pendiente de verificación' }
    return en ? `The simulated signal ${statuses[String(data.status)] ?? 'needs review'}. Age: ${data.ageMinutes} minutes; signal quality: ${data.signalQuality}%. This describes data quality, not health.`
      : `La señal simulada ${statuses[String(data.status)] ?? 'requiere revisión'}. Antigüedad: ${data.ageMinutes} minutos; calidad de señal: ${data.signalQuality}%. Esto describe los datos, no el estado de salud.`
  }
  if (name === 'getActiveHealthAlerts') {
    const alerts = Array.isArray(data.alerts) ? data.alerts : []
    return en ? `The authorized simulation contains ${alerts.length} active health alert(s). These are review flags, not diagnoses. No alert has been modified.`
      : `La simulación autorizada contiene ${alerts.length} alerta(s) de salud activas. Son señales para revisión, no diagnósticos. No se modificó ninguna alerta.`
  }
  if (name === 'getRecentSleep') {
    const records = data.records as Array<{ hours?: number }> | undefined
    const hours = records?.[0]?.hours ?? measurement?.value
    return typeof hours === 'number'
      ? en ? `The latest authorized sleep record is ${hours} hours. This is a recorded interval, not a current assessment of wellbeing.`
        : `El último registro autorizado de descanso es de ${hours} horas. Es un intervalo registrado, no una evaluación actual del bienestar.`
      : en ? 'There is no authorized sleep record available. That does not establish whether rest was adequate.' : 'No hay un registro autorizado de descanso disponible. Eso no permite concluir si fue suficiente.'
  }
  if (name === 'getMissionContext') return en ? `Simulated mission: ${data.name}. Stage: ${data.stage}.` : `Misión simulada: ${data.name}. Etapa: ${data.stage}.`
  const options = Array.isArray(data.options) ? data.options as Array<string | { role?: string }> : []
  if (!options.length) return en ? 'No active medical or wellbeing professionals are listed in this mission. Nobody has been notified.'
    : 'No figuran profesionales médicos o de bienestar activos en esta misión. No se notificó a nadie.'
  const labels = options.map(option => typeof option === 'string' ? option
    : option.role === 'medic' ? (en ? 'medical professional' : 'profesional médico')
      : option.role === 'psychologist' ? (en ? 'wellbeing professional' : 'profesional de bienestar') : option.role ?? '')
  return en ? `The listed support options are: ${labels.join(', ')}. Nobody has been notified.`
    : `Las opciones de apoyo registradas son: ${labels.join(', ')}. No se notificó a nadie.`
}
