import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PlatformService } from './platform.service'
import { localPainReportReply, parsePainBody } from './pain-map'
import type { PainMark } from './types'

const HORIZON = 'mission-demo-horizon'
const PATHFINDER = 'mission-demo-pathfinder'
const AURORA = 'mission-demo-aurora'

function mark(over: Partial<PainMark> = {}): PainMark {
  return {
    id: 'mark-chest-01',
    kind: 'point',
    regionId: 'chest',
    detectedRegionId: 'chest',
    regionLabel: 'Chest',
    labelSource: 'auto',
    laterality: 'left',
    aspect: 'anterior',
    localPosition: { x: 0.08, y: 1.24, z: 0.12 },
    normal: { x: 0, y: 0.1, z: 0.99 },
    surfaceId: 'torso',
    intensity: 4,
    startedAt: Date.UTC(2026, 10, 1, 12, 0, 0),
    pattern: 'intermittent',
    description: 'Tight feeling while seated',
    activity: 'working at the console',
    additionalSymptoms: 'none',
    notes: '',
    ...over,
  }
}

function payload(marks: PainMark[], extra: Record<string, unknown> = {}) {
  return {
    modelId: 'helios-mannequin',
    modelVersion: '1',
    origin: 'self_report',
    marks,
    ...extra,
  }
}

describe('pain body map', () => {
  let service: PlatformService
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'helios-pain-'))
    process.env.SIMULATION_DATA_DIR = dir
    service = new PlatformService()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function person(id: string) {
    return service.requireSession(service.selectProfile(id).token)
  }

  it('stores model coordinates and rejects a screen-only mark', () => {
    const mateo = person('mateo-ruiz')
    const saved = service.createPainMap(mateo, HORIZON, payload([
      mark(),
      mark({
        id: 'mark-back-02',
        regionId: 'upper_back',
        detectedRegionId: 'upper_back',
        regionLabel: 'Upper back',
        laterality: 'right',
        aspect: 'posterior',
        localPosition: { x: -0.06, y: 1.22, z: -0.1 },
        normal: { x: 0, y: 0, z: -1 },
        intensity: 7,
        description: 'Ache along the shoulder blade',
      }),
    ]))
    expect(saved.origin).toBe('self_report')
    expect(saved.modelId).toBe('helios-mannequin')
    expect(saved.modelVersion).toBe('1')
    expect(saved.marks[0].localPosition).toEqual({ x: 0.08, y: 1.24, z: 0.12 })
    expect(saved.marks[0].laterality).toBe('left')
    expect(saved.marks[1].intensity).toBe(7)
    expect(saved).not.toHaveProperty('organ')
    expect(saved).not.toHaveProperty('urgency')
    expect(() => parsePainBody({
      modelId: 'helios-mannequin',
      modelVersion: '1',
      marks: [{ ...mark(), localPosition: undefined, screenX: 120, screenY: 80 }],
    })).toThrow(/coordenadas locales/)
    expect(() => service.createPainMap(mateo, HORIZON, payload([mark({ intensity: 11 })]))).toThrow(/0 a 10/)
  })

  it('keeps the previous report on follow-up and the previous marks on correction', () => {
    const mateo = person('mateo-ruiz')
    const first = service.createPainMap(mateo, HORIZON, payload([mark()]))
    const next = service.createPainMap(mateo, HORIZON, payload([
      mark({ id: 'mark-chest-03', intensity: 6, description: 'Stronger by the evening' }),
    ], { followsReportId: first.id }))
    expect(next.followsReportId).toBe(first.id)
    const rows = service.listPainMaps(mateo, HORIZON)
    expect(rows.map((item) => item.id).sort()).toEqual([first.id, next.id].sort())
    expect(rows.find((item) => item.id === first.id)?.marks[0].intensity).toBe(4)

    const corrected = service.correctPainMap(mateo, HORIZON, first.id, payload([
      mark({ regionId: 'abdomen', detectedRegionId: 'chest', regionLabel: 'Abdomen', labelSource: 'user', description: 'It was lower than the diagram suggested' }),
    ]))
    expect(corrected.marks[0].regionId).toBe('abdomen')
    expect(corrected.revisions[0].marks[0].regionId).toBe('chest')
    expect(corrected.revisions[0].marks[0].description).toBe('Tight feeling while seated')
    const symptom = service.listSymptoms(mateo, HORIZON).find((item) => item.id === first.symptomReportId)
    expect(symptom?.description).toContain('abdomen')
    expect(symptom?.description).toContain('not an organ finding')
  })

  it('blocks new reports by stage and still lists history after the mission ends', () => {
    const mateo = person('mateo-ruiz')
    const elena = person('elena-torres')
    expect(() => service.createPainMap(mateo, PATHFINDER, payload([mark()]))).toThrow(/a bordo/)
    expect(() => service.createPainMap(mateo, AURORA, payload([mark()]))).toThrow(/finalizó|a bordo/)
    const saved = service.createPainMap(mateo, HORIZON, payload([mark({ id: 'mark-stage-1' })]))
    service.setStage(elena, HORIZON, 'postmission')
    expect(service.listPainMaps(mateo, HORIZON).some((item) => item.id === saved.id)).toBe(true)
    expect(() => service.createPainMap(mateo, HORIZON, payload([mark({ id: 'mark-stage-2' })]))).toThrow()
    expect(() => service.correctPainMap(mateo, HORIZON, saved.id, payload([mark({ description: 'too late' })]))).toThrow()
  })

  it('shows the map only with a symptoms grant and keeps clinical notes off the self-report', () => {
    const mateo = person('mateo-ruiz')
    const sofia = person('sofia-chen')
    const alex = person('alex-morgan')
    const elena = person('elena-torres')
    const saved = service.createPainMap(mateo, HORIZON, payload([mark()]))
    const before = saved.marks[0].description
    expect(() => service.listPainMaps(sofia, HORIZON, 'mateo-ruiz')).toThrow(/autorización/)
    expect(() => service.listPainMaps(elena, HORIZON, 'mateo-ruiz')).toThrow(/jefe/)
    service.grantHealth(mateo, HORIZON, 'sofia-chen', ['vitals'], null)
    expect(() => service.listPainMaps(sofia, HORIZON, 'mateo-ruiz')).toThrow(/autorización/)
    const symptoms = service.grantHealth(mateo, HORIZON, 'sofia-chen', ['symptoms'], null)
    expect(service.listPainMaps(sofia, HORIZON, 'mateo-ruiz')[0].marks[0].localPosition).toEqual(saved.marks[0].localPosition)
    const noted = service.addPainClinicalNote(sofia, HORIZON, saved.id, 'Observe only. No organ is identified from the diagram.')
    expect(noted.marks[0].description).toBe(before)
    expect(noted.clinicalNotes).toHaveLength(1)
    expect(noted.clinicalNotes[0].body).not.toBe(noted.marks[0].description)
    service.grantHealth(mateo, HORIZON, 'alex-morgan', ['symptoms'], null)
    expect(service.listPainMaps(alex, HORIZON, 'mateo-ruiz')[0].clinicalNotes).toEqual([])
    expect(() => service.addPainClinicalNote(alex, HORIZON, saved.id, 'Psych note should not land here.')).toThrow(/médico/)
    service.revokeGrant(mateo, symptoms.id)
    expect(() => service.listPainMaps(sofia, HORIZON, 'mateo-ruiz')).toThrow(/autorización/)
    const reply = localPainReportReply(service.listPainMaps(mateo, HORIZON), 'en')
    expect(reply.toLowerCase()).toContain('self-report')
    expect(reply.toLowerCase()).toContain('not a diagnosis')
    expect(reply.toLowerCase()).not.toContain('heart')
    expect(reply).not.toContain('Observe only')
  })
})
