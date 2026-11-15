import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { computePrepPercent, defaultPrep, emptyDb, seedPlatform } from './seed'
import { platformRemoteEnabled, pullPlatformSnapshot, pushPlatformSnapshot } from './platform.remote'
import type { PlatformDb } from './types'

/** v4: demo HELIOS vuelve a Preembarque con checklist abierto. */
const VERSION = 4

type FileShape = { version: number; revision?: number; db: PlatformDb }

export type StorageStatus = {
  driver: 'json' | 'supabase'
  revision: number
  remoteError: string | null
  recovery: { at: number; file: string; reason: string } | null
  damaged: string[]
}

export class PlatformStore {
  private path: string
  private db: PlatformDb
  private revision = 0
  private remoteError: string | null = null
  private remoteChain: Promise<void> = Promise.resolve()
  private recovery: { at: number; damagedPath: string; reason: string } | null = null

  constructor(dataDir?: string) {
    const root = dataDir || process.env.SIMULATION_DATA_DIR || './data/sessions'
    this.path = resolve(root, 'platform-db.json')
    this.db = this.load()
  }

  get(): PlatformDb {
    return this.db
  }

  revisionNumber(): number {
    return this.revision
  }

  status(): StorageStatus {
    return {
      driver: platformRemoteEnabled() ? 'supabase' : 'json',
      revision: this.revision,
      remoteError: this.remoteError,
      recovery: this.recovery
        ? { at: this.recovery.at, file: basename(this.recovery.damagedPath), reason: this.recovery.reason }
        : null,
      damaged: this.listDamaged(),
    }
  }

  /** Aplica el cambio en una copia. El archivo solo se reemplaza si el cambio y la escritura terminan. */
  mutate<T>(fn: (db: PlatformDb) => T): T {
    const draft = structuredClone(this.db)
    const result = fn(draft)
    const previous = this.db
    const previousRevision = this.revision
    this.db = draft
    this.revision += 1
    try {
      this.writeFile()
    } catch (error) {
      this.db = previous
      this.revision = previousRevision
      throw error
    }
    this.scheduleRemote()
    return result
  }

  restoreDamaged(name: string): void {
    if (!/^platform-db\.damaged-\d+\.json$/.test(name)) throw new Error('Nombre de respaldo inválido')
    const source = resolve(dirname(this.path), name)
    if (resolve(dirname(source)) !== resolve(dirname(this.path)) || !existsSync(source)) {
      throw new Error('Respaldo no encontrado')
    }
    let parsed: FileShape
    try {
      parsed = JSON.parse(readFileSync(source, 'utf8')) as FileShape
    } catch {
      throw new Error('El respaldo sigue ilegible y no se modificó')
    }
    if (!parsed?.db?.profiles?.length) throw new Error('El respaldo no tiene perfiles; se conservó sin cambios')
    const restored = this.normalize(parsed)
    const previous = this.db
    const previousRevision = this.revision
    this.db = restored.db
    this.revision = Math.max(previousRevision, parsed.revision ?? 0) + 1
    try {
      this.writeFile()
    } catch (error) {
      this.db = previous
      this.revision = previousRevision
      throw error
    }
    const kept = resolve(dirname(this.path), `platform-db.restored-${Date.now()}.json`)
    try {
      renameSync(source, kept)
    } catch {
      /* El respaldo dañado sigue en su sitio si no se pudo renombrar. */
    }
    this.recovery = null
    this.scheduleRemote()
  }

  async hydrateRemote(): Promise<void> {
    if (!platformRemoteEnabled()) return
    try {
      const remote = await pullPlatformSnapshot()
      if (remote && remote.revision >= this.revision && remote.payload.db.profiles?.length) {
        const restored = this.normalize({ version: remote.payload.version ?? VERSION, revision: remote.revision, db: remote.payload.db })
        this.db = restored.db
        this.revision = remote.revision
        this.writeFile()
      } else {
        await pushPlatformSnapshot(this.revision, VERSION, this.db)
      }
      this.remoteError = null
    } catch (error) {
      this.remoteError = error instanceof Error ? error.message : 'supabase'
    }
  }

  private load(): PlatformDb {
    if (!existsSync(this.path)) return this.seedFresh()
    let raw: FileShape
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8')) as FileShape
    } catch (error) {
      this.quarantine(error instanceof Error ? error.message : 'No se pudo leer el JSON')
      return this.seedFresh()
    }
    if (!raw?.db?.profiles?.length) {
      this.quarantine('El JSON no tiene perfiles')
      return this.seedFresh()
    }
    try {
      const normalized = this.normalize(raw)
      this.db = normalized.db
      this.revision = raw.revision ?? 0
      if (normalized.persist || (raw.version ?? 0) !== VERSION) this.writeFile()
      return this.db
    } catch (error) {
      this.quarantine(error instanceof Error ? error.message : 'No se pudo interpretar el JSON')
      return this.seedFresh()
    }
  }

  private seedFresh(): PlatformDb {
    const seeded = seedPlatform()
    this.db = seeded
    this.revision = 1
    this.writeFile()
    return seeded
  }

  private quarantine(reason: string): void {
    if (!existsSync(this.path)) return
    const damaged = resolve(dirname(this.path), `platform-db.damaged-${Date.now()}.json`)
    copyFileSync(this.path, damaged)
    this.recovery = { at: Date.now(), damagedPath: damaged, reason }
  }

  private listDamaged(): string[] {
    const dir = dirname(this.path)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => /^platform-db\.damaged-\d+\.json$/.test(name))
      .sort()
      .reverse()
  }

  private normalize(raw: FileShape): { db: PlatformDb; persist: boolean } {
    const merged = { ...emptyDb(), ...raw.db }
    if (!Array.isArray(merged.healthIndicators)) merged.healthIndicators = []
    if (!Array.isArray(merged.symptomReports)) merged.symptomReports = []
    let persist = false
    const needsDemoReset = (raw.version ?? 0) < VERSION
    for (const mission of merged.missions) {
      if (!mission.environment) mission.environment = 'space_station'
      if (mission.id === 'mission-helios-demo') {
        const seats = merged.memberships.filter(
          (membership) =>
            membership.missionId === mission.id &&
            membership.status === 'active' &&
            membership.role !== 'ops',
        ).length
        mission.plannedCrewCount = seats > 0 ? seats : 4
        if (
          needsDemoReset ||
          mission.stage === 'aboard' ||
          mission.stage === 'postmission' ||
          mission.stage === 'archived'
        ) {
          mission.stage = 'preflight'
          mission.rosterLocked = false
          mission.analysisStale = true
          mission.durationDays = mission.durationDays || 42
          const now = Date.now()
          merged.prepItems = [
            ...merged.prepItems.filter((item) => item.missionId !== mission.id),
            ...defaultPrep(mission.id, now, mission.plannedCrewCount, mission.durationDays),
          ]
          mission.prepPercent = computePrepPercent(merged.prepItems.filter((item) => item.missionId === mission.id))
          mission.updatedAt = now
          persist = true
        }
        continue
      }
      const deployed =
        mission.stage === 'aboard' ||
        mission.stage === 'postmission' ||
        mission.stage === 'archived' ||
        mission.stage === 'cancelled'
      if (deployed) {
        mission.rosterLocked = true
        mission.analysisStale = false
      } else {
        mission.rosterLocked = false
        if (typeof mission.analysisStale !== 'boolean') mission.analysisStale = true
      }
    }
    for (const symptom of merged.symptomReports) {
      if (symptom.bodyRegion === undefined) symptom.bodyRegion = null
    }
    return { db: merged, persist }
  }

  private writeFile(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    const payload: FileShape = { version: VERSION, revision: this.revision, db: this.db }
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }

  private scheduleRemote(): void {
    if (!platformRemoteEnabled()) return
    const revision = this.revision
    const db = structuredClone(this.db)
    this.remoteChain = this.remoteChain
      .then(() => pushPlatformSnapshot(revision, VERSION, db))
      .then(() => {
        this.remoteError = null
      })
      .catch((error: unknown) => {
        this.remoteError = error instanceof Error ? error.message : 'supabase'
      })
  }
}
