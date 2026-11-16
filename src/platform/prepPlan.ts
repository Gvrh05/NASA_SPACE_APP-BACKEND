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
      title: 'Verified evaluation kit',
      description:
        'Reusable onboard evaluation equipment. Fixed kit quantity (not per day).',
      source: 'HELIOS planning',
      critical: true,
      qtyRequired: 1,
      qtyLabel: '1 kit',
    },
    {
      key: 'oximeter',
      category: 'monitoreo',
      title: 'Oximeters (coverage and redundancy)',
      description:
        'Shared coverage with minimum redundancy; not multiplied by day.',
      source: 'HELIOS inventory',
      critical: true,
      qtyRequired: monitors,
      qtyLabel: `${monitors} units (max of 2 or ceil(people/2))`,
    },
    {
      key: 'hygiene',
      category: 'higiene',
      title: 'Hygiene consumables',
      description: `Logistics estimate: ${people} people × ${days} days + 10% reserve = ${hygiene}. Reviewable on the mission.`,
      source: 'HELIOS rule: people × days + 10%',
      critical: true,
      qtyRequired: hygiene,
      qtyLabel: `${hygiene} rations (${people}×${days}+10%)`,
    },
    {
      key: 'first-aid',
      category: 'medico',
      title: 'Reviewed first aid kit',
      description:
        'Minimum ship medical resource. Does not replace a real clinical evaluation.',
      source: 'HELIOS preparation / inventory',
      critical: true,
      qtyRequired: 1,
      qtyLabel: '1 kit',
    },
    {
      key: 'comms',
      category: 'comunicacion',
      title: 'Support channel and delay',
      description:
        'Documented Earth-link procedure. It does not imply a live clinical chat.',
      source: 'Medical Operations 6.0 (reference)',
      critical: true,
      qtyRequired: null,
      qtyLabel: 'Procedure (no quantity)',
    },
    {
      key: 'wellbeing',
      category: 'bienestar',
      title: 'Rest resources',
      description: `Non-clinical wellbeing material: at least 1 set per person (${people}).`,
      source: 'HELIOS planning',
      critical: false,
      qtyRequired: restKits,
      qtyLabel: `${restKits} sets (1 per person)`,
    },
    {
      key: 'water-plan',
      category: 'logistica',
      title: 'Water and base consumables plan',
      description: `Base support-consumable coverage: reference ${waterDays} person-days (${people}×${days}). Operational validation is still pending.`,
      source: 'HELIOS planning (demo)',
      critical: false,
      qtyRequired: waterDays,
      qtyLabel: `${waterDays} person-days (${people}×${days})`,
    },
  ]
}
