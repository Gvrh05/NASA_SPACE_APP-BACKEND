import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PlatformService } from '../platform/platform.service'
import { SimulationService } from './simulation.service'

describe('platform and simulator mission context', () => {
  let dir: string
  const previous = process.env.SIMULATION_DATA_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'helios-mission-'))
    process.env.SIMULATION_DATA_DIR = dir
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.SIMULATION_DATA_DIR
    else process.env.SIMULATION_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })

  it('copies the platform mission into the simulator once', () => {
    const platform = new PlatformService()
    const simulation = new SimulationService()
    const sessionId = randomUUID()
    simulation.initialize(sessionId, { scenarioId: 'baseline' })
    const chief = platform.requireSession(platform.selectProfile('elena-torres').token)
    const context = platform.simulatorContext(chief, 'mission-helios-demo')
    const first = simulation.alignWithPlatform(sessionId, context)
    expect(first.state.mission.name).toBe('HELIOS Demo · Hábitat orbital')
    expect(first.state.mission.stage).toBe('preembarque')
    expect(first.state.mission.destination).toBe('Órbita baja (simulación)')
    expect(first.state.mission.crewCount).toBe(4)
    const second = simulation.alignWithPlatform(sessionId, context)
    expect(second.revision).toBe(first.revision)
  })

  it('keeps symptom reads with the subject until a grant exists', () => {
    const platform = new PlatformService()
    const mateo = platform.requireSession(platform.selectProfile('mateo-ruiz').token)
    platform.addSymptom(mateo, 'mission-helios-demo', {
      description: 'ROLE-PRIVATE',
      startedAt: null,
      intensity: 2,
      context: 'self',
      source: 'self_report',
    })
    expect(platform.listSymptoms(mateo, 'mission-helios-demo')).toHaveLength(1)
    for (const id of ['elena-torres', 'sofia-chen', 'alex-morgan']) {
      const viewer = platform.requireSession(platform.selectProfile(id).token)
      expect(() => platform.listSymptoms(viewer, 'mission-helios-demo', 'mateo-ruiz')).toThrow()
    }
  })
})
