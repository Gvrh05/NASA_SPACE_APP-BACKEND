/** Checklist de preembarque HELIOS con cantidades derivadas del plan (personas × días). */

export type PrepPlanRow = {
  key: string
  category: string
  title: string
  description: string
  source: string
  critical: boolean
  qtyRequired: number | null
  qtyLabel: string | null
}

export function buildMissionPrepChecklist(
  plannedCrewCount: number,
  durationDays: number,
): PrepPlanRow[] {
  const people = Math.max(1, Math.floor(plannedCrewCount) || 1)
  const days = Math.max(1, Math.floor(durationDays) || 1)
  const hygiene = Math.ceil(people * days * 1.1)
  const monitors = Math.max(2, Math.ceil(people / 2))
  const restKits = Math.max(1, people)
  const waterDays = people * days

  return [
    {
      key: 'eval-kit',
      category: 'monitoreo',
      title: 'Kit de evaluación verificado',
      description:
        'Equipo reutilizable de evaluación a bordo. Cantidad fija de kit (no por día).',
      source: 'Planificación HELIOS',
      critical: true,
      qtyRequired: 1,
      qtyLabel: '1 kit',
    },
    {
      key: 'oximeter',
      category: 'monitoreo',
      title: 'Oxímetros (cobertura + redundancia)',
      description:
        'Cobertura compartida con redundancia mínima; no se multiplica por día.',
      source: 'Inventario HELIOS',
      critical: true,
      qtyRequired: monitors,
      qtyLabel: `${monitors} unidades (máx. 2 o ⌈personas/2⌉)`,
    },
    {
      key: 'hygiene',
      category: 'higiene',
      title: 'Consumibles de higiene',
      description: `Estimación logística: ${people} personas × ${days} días + 10% de reserva = ${hygiene}. Revisable en misión.`,
      source: 'Regla HELIOS: personas × días + 10%',
      critical: true,
      qtyRequired: hygiene,
      qtyLabel: `${hygiene} raciones (${people}×${days}+10%)`,
    },
    {
      key: 'first-aid',
      category: 'medico',
      title: 'Kit de primeros auxilios revisado',
      description:
        'Recurso médico mínimo de la nave. No sustituye evaluación clínica real.',
      source: 'Preparación HELIOS / inventario',
      critical: true,
      qtyRequired: 1,
      qtyLabel: '1 kit',
    },
    {
      key: 'comms',
      category: 'comunicacion',
      title: 'Canal de asistencia y demora',
      description:
        'Procedimiento de enlace Tierra documentado. No implica chat clínico en vivo.',
      source: 'Medical Operations 6.0 (referencia)',
      critical: true,
      qtyRequired: null,
      qtyLabel: 'Procedimiento (sin cantidad)',
    },
    {
      key: 'wellbeing',
      category: 'bienestar',
      title: 'Recursos de descanso',
      description: `Material no clínico de bienestar: al menos 1 set por persona (${people}).`,
      source: 'Planificación HELIOS',
      critical: false,
      qtyRequired: restKits,
      qtyLabel: `${restKits} sets (1 por persona)`,
    },
    {
      key: 'water-plan',
      category: 'logistica',
      title: 'Plan de agua y consumibles base',
      description: `Cobertura base de consumibles de soporte: referencia ${waterDays} persona-días (${people}×${days}). Validación operativa pendiente.`,
      source: 'Planificación HELIOS (demo)',
      critical: false,
      qtyRequired: waterDays,
      qtyLabel: `${waterDays} persona-días (${people}×${days})`,
    },
  ]
}
