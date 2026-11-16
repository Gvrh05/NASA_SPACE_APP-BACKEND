import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PlatformService } from './platform.service'
import { DEMO_MISSIONS } from './demoScenarios'

describe('mission stage rules, agenda and close', () => {
  let service: PlatformService
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'helios-stage-'))
    process.env.SIMULATION_DATA_DIR = dir
    service = new PlatformService()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function person(id: string) {
    return service.requireSession(service.selectProfile(id).token)
  }

  it('keeps a draft empty and blocks clinical writes', () => {
    const elena = person('elena-torres')
    const mission = service.getMission(elena, DEMO_MISSIONS.genesis)
    expect(mission.mission.stage).toBe('draft')
    expect(mission.prepItems).toHaveLength(0)
    expect(mission.mission.name).toBe('HELIOS Genesis — Draft')
    expect(() => service.addSymptom(elena, DEMO_MISSIONS.genesis, {
      description: 'should not save',
      startedAt: null,
      intensity: 1,
      context: 'self',
      source: 'self_report',
      bodyRegion: null,
    })).toThrow(/in flight/)
    expect(() => service.startConversation(elena, DEMO_MISSIONS.genesis, 'emotional', 'en')).toThrow(/in flight/)
  })

  it('blocks takeoff and visits while preflight is incomplete', () => {
    const elena = person('elena-torres')
    const check = service.evaluateStart(DEMO_MISSIONS.pathfinder)
    expect(check.ok).toBe(false)
    expect(check.percent).toBeGreaterThan(40)
    expect(check.percent).toBeLessThan(50)
    expect(check.criticalPending.length).toBeGreaterThan(0)
    expect(() => service.startSimulatedMission(elena, DEMO_MISSIONS.pathfinder, true)).toThrow()
    const mateo = person('mateo-ruiz')
    expect(() => service.requestAppointment(mateo, DEMO_MISSIONS.pathfinder, {
      specialty: 'medical',
      professionalId: 'sofia-chen',
      reason: 'Too early',
      scheduledAt: Date.now() + 86_400_000,
      shareCategories: ['symptoms'],
    })).toThrow(/in flight/)
  })

  it('requests a visit without confirming it and rejects a busy slot', () => {
    const nova = person('nova-hale')
    const sofia = person('sofia-chen')
    const when = Date.UTC(2026, 10, 20, 16, 0, 0)
    const created = service.requestAppointment(nova, DEMO_MISSIONS.horizon, {
      specialty: 'medical',
      professionalId: 'sofia-chen',
      reason: 'Simulated slot request',
      scheduledAt: when,
      shareCategories: ['symptoms'],
      timezone: 'UTC',
    })
    expect(created.appointment.status).toBe('requested')
    expect(() => service.requestAppointment(nova, DEMO_MISSIONS.horizon, {
      specialty: 'medical',
      professionalId: 'sofia-chen',
      reason: 'Simulated slot request',
      scheduledAt: when,
      shareCategories: ['symptoms'],
    })).toThrow()
    const confirmed = service.confirmAppointment(sofia, created.appointment.id, true) as { status: string }
    expect(confirmed.status).toBe('confirmed')
    expect(() => service.requestAppointment(person('kenji-oka'), DEMO_MISSIONS.horizon, {
      specialty: 'medical',
      professionalId: 'sofia-chen',
      reason: 'Overlapping visit',
      scheduledAt: when + 10 * 60_000,
      shareCategories: [],
    })).toThrow(/already booked/)
  })

  it('hides psychological notes from the commander and the patient', () => {
    const chief = person('elena-torres')
    const patient = person('mateo-ruiz')
    const psych = person('alex-morgan')
    const chiefView = JSON.stringify(service.listAppointments(chief, DEMO_MISSIONS.horizon))
    const patientView = JSON.stringify(service.listAppointments(patient, DEMO_MISSIONS.horizon))
    const psychView = JSON.stringify(service.listAppointments(psych, DEMO_MISSIONS.horizon))
    expect(chiefView).not.toContain('SIMULATED private professional note')
    expect(chiefView).not.toContain('Simulated request to talk about sleep')
    expect(patientView).toContain('Simulated request to talk about sleep')
    expect(patientView).not.toContain('SIMULATED private professional note')
    expect(psychView).toContain('SIMULATED private professional note')
    const review = JSON.stringify(service.missionReview(chief, DEMO_MISSIONS.horizon))
    expect(review).not.toContain('SIMULATED private worry')
    expect(review).not.toContain('SIMULATED private professional note')
  })

  it('closes a flight without completing open care or resolving symptoms', () => {
    const elena = person('elena-torres')
    const before = service.getMission(elena, DEMO_MISSIONS.aurora)
    expect(before.mission.stage).toBe('postmission')
    expect(before.mission.closedBy).toBe('elena-torres')
    const symptoms = service.listSymptoms(person('kenji-oka'), DEMO_MISSIONS.aurora)
    expect(symptoms.some((item) => item.status === 'open')).toBe(true)
    expect(symptoms.every((item) => item.status !== 'resolved' || item.description.includes('resolved'))).toBe(true)
    const visits = service.listAppointments(elena, DEMO_MISSIONS.aurora) as { status: string; history?: { action: string }[] }[]
    expect(visits.some((item) => item.status === 'confirmed' || item.status === 'rescheduled')).toBe(true)
    expect(visits.some((item) => item.history?.some((change) => change.action === 'administrative_close'))).toBe(true)
    expect(visits.filter((item) => item.history?.some((change) => change.action === 'administrative_close')).every((item) => item.status !== 'completed')).toBe(true)
    expect(() => service.addSymptom(person('mateo-ruiz'), DEMO_MISSIONS.aurora, {
      description: 'after close',
      startedAt: null,
      intensity: 1,
      context: 'self',
      source: 'self_report',
      bodyRegion: null,
    })).toThrow(/completed/)
    const outsider = service.createMission(elena, { name: 'Other mission' })
    expect(() => service.listSymptoms(person('nova-hale'), outsider.mission.id)).toThrow()
  })
})
