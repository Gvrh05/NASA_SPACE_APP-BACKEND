import { PlatformService } from './platform.service'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

describe('PlatformService', () => {
  let service: PlatformService
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'helios-plat-'))
    process.env.SIMULATION_DATA_DIR = dir
    service = new PlatformService()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('selects a demo profile without password', () => {
    const profiles = service.listProfiles()
    expect(profiles.length).toBeGreaterThan(3)
    const session = service.selectProfile('elena-torres')
    expect(session.token).toBeTruthy()
    expect(service.requireSession(session.token).id).toBe('elena-torres')
  })

  it('creates a mission with chief membership only for that mission', () => {
    const { token } = service.selectProfile('elena-torres')
    const chief = service.requireSession(token)
    const created = service.createMission(chief, { name: 'Test Mission', plannedCrewCount: 3 })
    expect(created.mission.createdBy).toBe('elena-torres')
    const members = created.members.filter((item) => item.status === 'active')
    expect(members.some((item) => item.profileId === 'elena-torres' && item.role === 'chief')).toBe(true)
  })

  it('join by code does not grant health access automatically', () => {
    const elena = service.requireSession(service.selectProfile('elena-torres').token)
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const created = service.createMission(elena, { name: 'Join Test' })
    const join = service.requestJoin(mateo, created.mission.code, 'crew')
    expect(join.status).toBe('pending')
  })

  it('blocks start under 80% or with critical pending', () => {
    const elena = service.requireSession(service.selectProfile('elena-torres').token)
    const created = service.createMission(elena, { name: 'Prep Test' })
    const evaluation = service.evaluateStart(created.mission.id)
    expect(evaluation.ok).toBe(false)
    expect(evaluation.percent).toBeLessThan(80)
  })

  it('rejects overlapping sleep episodes', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const start = Date.UTC(2026, 0, 1, 10, 0, 0)
    service.addSleep(mateo, 'mission-demo-horizon', start, start + 3600000, 3, 'nap')
    expect(() => service.addSleep(mateo, 'mission-demo-horizon', start + 1800000, start + 5400000, 3, 'nap')).toThrow()
  })

  it('keeps emotional conversation private by default', () => {
    const alex = service.requireSession(service.selectProfile('alex-morgan').token)
    const conversation = service.startConversation(alex, 'mission-demo-horizon', 'emotional')
    expect(conversation.private).toBe(true)
  })

  it('blocks medic symptom reads without grant and after revoke', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const sofia = service.requireSession(service.selectProfile('sofia-chen').token)
    const missionId = 'mission-demo-horizon'
    service.addSymptom(mateo, missionId, {
      description: 'AUDIT headache',
      startedAt: null,
      intensity: 2,
      context: 'self',
      source: 'self_report',
      bodyRegion: 'head',
    })
    expect(() => service.listSymptoms(sofia, missionId, 'mateo-ruiz')).toThrow()
    const grant = service.grantHealth(mateo, missionId, 'sofia-chen', ['symptoms', 'vitals'], null)
    expect(service.listSymptoms(sofia, missionId, 'mateo-ruiz').some((item) => item.description === 'AUDIT headache')).toBe(true)
    service.revokeGrant(mateo, grant.id)
    expect(() => service.listSymptoms(sofia, missionId, 'mateo-ruiz')).toThrow()
  })

  it('stores blood pressure as systolic/diastolic and lists vitals with grant', () => {
    const mateo = service.requireSession(service.selectProfile('mateo-ruiz').token)
    const sofia = service.requireSession(service.selectProfile('sofia-chen').token)
    expect(() =>
      service.addHealthIndicator(mateo, 'mission-demo-horizon', { kind: 'blood_pressure', value: 120 }),
    ).toThrow()
    const bp = service.addHealthIndicator(mateo, 'mission-demo-horizon', {
      kind: 'blood_pressure',
      value: 118,
      valueSecondary: 76,
      origin: 'manual',
      context: 'rest',
      quality: 'good',
    })
    expect(bp.value).toBe(118)
    expect(bp.valueSecondary).toBe(76)
    expect(bp.unit).toBe('mmHg')
    const mood = service.addHealthIndicator(mateo, 'mission-demo-horizon', {
      kind: 'mood',
      value: 2,
      origin: 'manual',
      context: 'post_wake',
    })
    expect(mood.unit).toBe('mood_1_5')
    expect(() => service.listHealthIndicators(sofia, 'mission-demo-horizon', 'mateo-ruiz')).toThrow()
    service.grantHealth(mateo, 'mission-demo-horizon', 'sofia-chen', ['vitals'], null)
    expect(service.listHealthIndicators(sofia, 'mission-demo-horizon', 'mateo-ruiz').length).toBeGreaterThanOrEqual(2)
  })
})