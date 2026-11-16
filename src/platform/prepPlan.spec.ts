import { buildMissionPrepChecklist } from './prepPlan'

describe('buildMissionPrepChecklist', () => {
  it('computes hygiene and coverage from crew × days', () => {
    const rows = buildMissionPrepChecklist(5, 14)
    expect(rows).toHaveLength(7)
    const hygiene = rows.find((row) => row.key === 'hygiene')
    expect(hygiene?.qtyRequired).toBe(Math.ceil(5 * 14 * 1.1))
    expect(hygiene?.qtyLabel).toContain('5×14+10%')
    const ox = rows.find((row) => row.key === 'oximeter')
    expect(ox?.qtyRequired).toBe(Math.max(2, Math.ceil(5 / 2)))
    const evalKit = rows.find((row) => row.key === 'eval-kit')
    expect(evalKit?.qtyRequired).toBe(1)
    expect(evalKit?.critical).toBe(true)
  })
})
