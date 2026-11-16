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
    const context = platform.simulatorContext(chief, 'mission-demo-pathfinder')
    const first = simulation.alignWithPlatform(sessionId, context)
    expect(first.state.mission.name).toBe('HELIOS Pathfinder — Preflight')
    expect(first.state.mission.stage).toBe('preembarque')
    expect(first.state.mission.destination).toBe('Low Earth orbit (simulated)')
    expect(first.state.mission.crewCount).toBe(6)
    const second = simulation.alignWithPlatform(sessionId, context)
    expect(second.revision).toBe(first.revision)
  })

  it('keeps the simulator in flight when platform completion has open episodes', () => {
    const platform = new PlatformService()
    const simulation = new SimulationService()
    const sessionId = randomUUID()
    const initial = simulation.initialize(sessionId, { scenarioId: 'baseline' })
    simulation.action(sessionId, randomUUID(), initial.revision, {
      type: 'addSymptom',
      crewId: 'elena-torres',
      symptoms: ['mareo'],
      note: '',
      idempotencyKey: 'stage-with-open-episode',
    })
    const chief = platform.requireSession(platform.selectProfile('elena-torres').token)
    const context = {
      ...platform.simulatorContext(chief, 'mission-demo-pathfinder'),
      stage: 'postmission' as const,
    }

    const snapshot = simulation.alignWithPlatform(sessionId, context)

    expect(snapshot.state.mission.stage).toBe('a_bordo')
    expect(snapshot.state.episodes.some((episode) => episode.status !== 'closed')).toBe(true)
  })

  it('keeps symptom reads with the subject until a grant exists', () => {
    const platform = new PlatformService()
    const mateo = platform.requireSession(platform.selectProfile('mateo-ruiz').token)
    platform.addSymptom(mateo, 'mission-demo-horizon', {
      description: 'ROLE-PRIVATE',
      startedAt: null,
      intensity: 2,
      context: 'self',
      source: 'self_report',
    })
    expect(platform.listSymptoms(mateo, 'mission-demo-horizon').some((item) => item.description === 'ROLE-PRIVATE')).toBe(true)
    for (const id of ['elena-torres', 'sofia-chen', 'alex-morgan']) {
      const viewer = platform.requireSession(platform.selectProfile(id).token)
      expect(() => platform.listSymptoms(viewer, 'mission-demo-horizon', 'mateo-ruiz')).toThrow()
    }
  })
})
