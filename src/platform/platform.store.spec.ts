import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlatformStore } from './platform.store'

describe('PlatformStore recovery and transactions', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'helios-store-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rolls back a failed change and leaves the file untouched', () => {
    const store = new PlatformStore(dir)
    const before = store.get().missions[0].name
    expect(() => store.mutate((db) => {
      db.missions[0].name = 'CHANGED'
      throw new Error('boom')
    })).toThrow('boom')
    expect(store.get().missions[0].name).toBe(before)
    const saved = JSON.parse(readFileSync(join(dir, 'platform-db.json'), 'utf8')) as { db: { missions: { name: string }[] } }
    expect(saved.db.missions[0].name).toBe(before)
  })

  it('seeds an idempotent medical visit for the chief in the in-flight demo', () => {
    const store = new PlatformStore(dir)
    const visit = store.get().appointments.find((item) => item.id === 'mission-demo-horizon-appt-elena-upcoming')

    expect(visit).toMatchObject({
      missionId: 'mission-demo-horizon',
      requesterId: 'elena-torres',
      professionalId: 'sofia-chen',
      specialty: 'medical',
      status: 'confirmed',
      simulated: true,
    })
    expect(visit?.scheduledAt).toBeGreaterThan(Date.now())

    const reloaded = new PlatformStore(dir)
    expect(reloaded.get().appointments.filter((item) => item.id === visit?.id)).toHaveLength(1)
  })

  it('keeps an unreadable JSON file and still boots a demo database', () => {
    writeFileSync(join(dir, 'platform-db.json'), '{', 'utf8')
    const store = new PlatformStore(dir)
    expect(store.get().profiles.length).toBeGreaterThan(0)
    const damaged = readdirSync(dir).filter((name) => name.startsWith('platform-db.damaged-'))
    expect(damaged).toHaveLength(1)
    expect(readFileSync(join(dir, damaged[0]), 'utf8')).toBe('{')
    expect(() => store.restoreDamaged(damaged[0])).toThrow(/ilegible/)
    expect(readFileSync(join(dir, damaged[0]), 'utf8')).toBe('{')
  })

  it('restores a quarantined snapshot without deleting its bytes', () => {
    const store = new PlatformStore(dir)
    store.mutate((db) => {
      db.missions[0].name = 'MISION-RECUPERADA'
    })
    const good = readFileSync(join(dir, 'platform-db.json'), 'utf8')
    const damagedName = `platform-db.damaged-${Date.now()}.json`
    writeFileSync(join(dir, damagedName), good, 'utf8')
    writeFileSync(join(dir, 'platform-db.json'), '{', 'utf8')
    const reloaded = new PlatformStore(dir)
    expect(reloaded.get().missions[0].name).not.toBe('MISION-RECUPERADA')
    const file = reloaded.status().damaged.find((name) => {
      try {
        return readFileSync(join(dir, name), 'utf8').includes('MISION-RECUPERADA')
      } catch {
        return false
      }
    })
    expect(file).toBeTruthy()
    reloaded.restoreDamaged(file!)
    expect(reloaded.get().missions[0].name).toBe('MISION-RECUPERADA')
    expect(readdirSync(dir).some((name) => name.startsWith('platform-db.restored-'))).toBe(true)
  })
})
