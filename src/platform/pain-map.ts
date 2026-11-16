import { BadRequestException } from '@nestjs/common'
import type { PainAspect, PainLaterality, PainMapReport, PainMark, PainPattern } from './types'

/**
 * HELIOS mannequin v1 — coordinate contract.
 *
 * Model space is right-handed, Y-up, meters.
 * +Y superior, +Z anterior (the figure faces +Z), +X the person's left.
 * Laterality is anatomical (the person's left/right), never the side of the screen.
 * Marks persist localPosition, normal, surfaceId, regionId, model id and version.
 * Screen pixels are not stored. Resizing, orbiting, or opening another device
 * rebuilds the marker from these model coordinates.
 *
 * If a future mesh replaces this one, bump modelVersion and keep regionId strings.
 * Readers still show the textual region when the 3D asset cannot be loaded.
 */
export const PAIN_MODEL_ID = 'helios-mannequin'
export const PAIN_MODEL_VERSION = '1'

export const PAIN_REGION_IDS = [
  'head',
  'face',
  'neck',
  'shoulder',
  'chest',
  'upper_back',
  'abdomen',
  'lower_back',
  'pelvis',
  'upper_arm',
  'elbow',
  'forearm',
  'hand',
  'hip',
  'thigh',
  'knee',
  'lower_leg',
  'foot',
] as const

const REGIONS = new Set<string>(PAIN_REGION_IDS)
const SIDES = new Set<PainLaterality>(['left', 'right', 'midline'])
const ASPECTS = new Set<PainAspect>(['anterior', 'posterior', 'lateral', 'unspecified'])
const PATTERNS = new Set<PainPattern>(['constant', 'intermittent'])

export type PainWriteBody = {
  modelId: string
  modelVersion: string
  appointmentId: string | null
  followsReportId: string | null
  marks: PainMark[]
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(message)
  return value as Record<string, unknown>
}

function vector(value: unknown, message: string): { x: number; y: number; z: number } {
  const row = asRecord(value, message)
  const x = Number(row.x)
  const y = Number(row.y)
  const z = Number(row.z)
  if (![x, y, z].every((item) => Number.isFinite(item))) throw new BadRequestException(message)
  return { x, y, z }
}

function unitNormal(value: unknown): { x: number; y: number; z: number } {
  const raw = vector(value, 'That mark has an invalid surface direction')
  const length = Math.hypot(raw.x, raw.y, raw.z)
  if (!(length > 0.2 && length < 3)) throw new BadRequestException('That mark has an invalid surface direction')
  return { x: round(raw.x / length), y: round(raw.y / length), z: round(raw.z / length) }
}

function localPoint(value: unknown): { x: number; y: number; z: number } {
  const point = vector(value, 'That mark needs coordinates on the body model')
  if (point.x < -0.6 || point.x > 0.6 || point.y < -0.05 || point.y > 1.9 || point.z < -0.45 || point.z > 0.5) {
    throw new BadRequestException('That mark sits outside the body model')
  }
  return { x: round(point.x), y: round(point.y), z: round(point.z) }
}

function parseMark(value: unknown, index: number, seen: Set<string>): PainMark {
  const row = asRecord(value, 'Invalid pain location')
  const regionId = String(row.regionId || '')
  const detectedRegionId = String(row.detectedRegionId || regionId)
  if (!REGIONS.has(regionId) || !REGIONS.has(detectedRegionId)) {
    throw new BadRequestException('Invalid pain location')
  }
  const laterality = String(row.laterality || '') as PainLaterality
  const aspect = String(row.aspect || '') as PainAspect
  const pattern = String(row.pattern || '') as PainPattern
  if (!SIDES.has(laterality) || !ASPECTS.has(aspect) || !PATTERNS.has(pattern)) {
    throw new BadRequestException('Invalid pain location')
  }
  const intensity = Number(row.intensity)
  if (!Number.isInteger(intensity) || intensity < 0 || intensity > 10) {
    throw new BadRequestException('Intensity is a self-report from 0 to 10')
  }
  const description = clip(row.description, 800)
  if (description.length < 1) throw new BadRequestException('Each mark needs a description')
  const surfaceId = String(row.surfaceId || '')
  if (!/^[a-z0-9-]{2,64}$/.test(surfaceId)) throw new BadRequestException('Invalid pain location')
  const kind = row.kind === 'region' ? 'region' : row.kind === 'point' ? 'point' : ''
  if (!kind) throw new BadRequestException('Invalid pain location')
  let id = typeof row.id === 'string' && /^[A-Za-z0-9_-]{6,48}$/.test(row.id) ? row.id : `mark${index + 1}`
  if (seen.has(id)) id = `${id}-${index + 1}`
  seen.add(id)
  const startedAt = row.startedAt == null || row.startedAt === '' ? null : Number(row.startedAt)
  if (startedAt != null && !Number.isFinite(startedAt)) throw new BadRequestException('Invalid pain location')
  const labelSource = row.labelSource === 'user' ? 'user' : 'auto'
  return {
    id,
    kind,
    regionId,
    detectedRegionId,
    regionLabel: clip(row.regionLabel || regionId, 80),
    labelSource,
    laterality,
    aspect,
    localPosition: localPoint(row.localPosition),
    normal: unitNormal(row.normal),
    surfaceId,
    intensity,
    startedAt,
    pattern,
    description,
    activity: clip(row.activity, 400),
    additionalSymptoms: clip(row.additionalSymptoms, 400),
    notes: clip(row.notes, 800),
  }
}

export function parsePainBody(input: unknown): PainWriteBody {
  const body = asRecord(input, 'Invalid pain report')
  if (body.modelId !== PAIN_MODEL_ID || String(body.modelVersion) !== PAIN_MODEL_VERSION) {
    throw new BadRequestException('This body model version is not supported')
  }
  if (body.origin != null && body.origin !== 'self_report') {
    throw new BadRequestException('A pain map is a self-report')
  }
  if (!Array.isArray(body.marks) || body.marks.length < 1 || body.marks.length > 8) {
    throw new BadRequestException('Mark between 1 and 8 locations')
  }
  const seen = new Set<string>()
  return {
    modelId: PAIN_MODEL_ID,
    modelVersion: PAIN_MODEL_VERSION,
    appointmentId: body.appointmentId == null || body.appointmentId === '' ? null : String(body.appointmentId),
    followsReportId: body.followsReportId == null || body.followsReportId === '' ? null : String(body.followsReportId),
    marks: body.marks.map((mark, index) => parseMark(mark, index, seen)),
  }
}

/** Linked symptom row. The highest number is only the person's own scale, not urgency. */
export function symptomSummary(marks: PainMark[]): {
  description: string
  intensity: number
  startedAt: number | null
  context: string
  bodyRegion: string
} {
  const ranked = [...marks].sort((a, b) => b.intensity - a.intensity)
  const top = ranked[0]
  const where = marks.map((mark) => `${mark.regionId} ${mark.laterality} ${mark.aspect} ${mark.intensity}/10`).join('; ')
  const started = marks.map((mark) => mark.startedAt).filter((item): item is number => item != null).sort((a, b) => a - b)
  return {
    description: `Self-reported pain on a body diagram (not an organ finding): ${where}. ${top?.description || ''}`.slice(0, 800),
    intensity: top?.intensity ?? 0,
    startedAt: started[0] ?? null,
    context: marks.find((mark) => mark.activity)?.activity || '',
    bodyRegion: top?.regionId || 'chest',
  }
}

export function painSelfReportView(reports: PainMapReport[]) {
  return [...reports]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 4)
    .map((report) => ({
      id: report.id,
      at: report.createdAt,
      status: report.status,
      followsReportId: report.followsReportId,
      origin: 'self_report' as const,
      disclaimer: 'Surface self-report on a body diagram. Not an organ localization, diagnosis, or urgency score.',
      marks: report.marks.map((mark) => ({
        regionId: mark.regionId,
        regionLabel: mark.regionLabel,
        laterality: mark.laterality,
        aspect: mark.aspect,
        intensity: mark.intensity,
        startedAt: mark.startedAt,
        pattern: mark.pattern,
        description: mark.description.slice(0, 400),
        activity: mark.activity.slice(0, 200),
        additionalSymptoms: mark.additionalSymptoms.slice(0, 200),
      })),
    }))
}

export function asksAboutPainReport(text: string): boolean {
  const q = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  return /pain map|body map|recorded pain|where (does|did) it hurt|where i (hurt|feel pain)|mapa (corporal|del cuerpo)|donde me duele|dolor registrado|marcas de dolor/.test(q)
}

export function localPainReportReply(reports: PainMapReport[], locale: 'en' | 'es'): string {
  const ordered = [...reports].sort((a, b) => b.createdAt - a.createdAt)
  if (!ordered.length) {
    return locale === 'en'
      ? 'I do not see a saved pain body-map report. You can mark an approximate spot in My Health. I will not infer a cause or an organ from a diagram.'
      : 'No veo un mapa de dolor guardado. Podés marcar un punto aproximado en Mi salud. No infiero una causa ni un órgano a partir del diagrama.'
  }
  const lines = ordered.slice(0, 3).map((report) => {
    const when = new Date(report.createdAt).toISOString().slice(0, 16).replace('T', ' ')
    const spots = report.marks.map((mark) => `${mark.regionLabel} (${mark.laterality}, ${mark.aspect}) ${mark.intensity}/10`).join('; ')
    const follow = report.followsReportId ? (locale === 'en' ? ' Follows an earlier report.' : ' Sigue un reporte anterior.') : ''
    return `${when} UTC: ${spots}.${follow} ${report.marks.map((mark) => mark.description).join(' ').slice(0, 180)}`
  })
  return locale === 'en'
    ? `This is your self-report on a body diagram, not a diagnosis and not an organ location. The intensity number is only what you reported. ${lines.join(' ')} I can help you draft a summary or request a visit. You review it before anything is shared.`
    : `Esto es tu autorreporte sobre un diagrama corporal, no un diagnóstico ni la ubicación de un órgano. El número de intensidad es solo lo que reportaste. ${lines.join(' ')} Puedo ayudarte a preparar un resumen o a pedir una cita. Lo revisás antes de compartir algo.`
}
