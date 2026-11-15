import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { emptyDb, seedPlatform } from './seed'
import type { PlatformDb } from './types'

const VERSION = 1

type FileShape = { version: number; db: PlatformDb }

export class PlatformStore {
  private path: string
  private db: PlatformDb

  constructor(dataDir?: string) {
    const root = dataDir || process.env.SIMULATION_DATA_DIR || './data/sessions'
    this.path = resolve(root, 'platform-db.json')
    this.db = this.load()
  }

  get(): PlatformDb {
    return this.db
  }

  mutate<T>(fn: (db: PlatformDb) => T): T {
    const result = fn(this.db)
    this.save()
    return result
  }

  private load(): PlatformDb {
    try {
      if (!existsSync(this.path)) {
        const seeded = seedPlatform()
        this.db = seeded
        this.save()
        return seeded
      }
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as FileShape
      if (!raw?.db?.profiles?.length) {
        const seeded = seedPlatform()
        this.db = seeded
        this.save()
        return seeded
      }
      const merged = { ...emptyDb(), ...raw.db }
      for (const mission of merged.missions) {
        if (typeof mission.rosterLocked !== 'boolean') mission.rosterLocked = false
      }
      return merged
    } catch {
      const seeded = seedPlatform()
      this.db = seeded
      this.save()
      return seeded
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    const payload: FileShape = { version: VERSION, db: this.db }
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }
}