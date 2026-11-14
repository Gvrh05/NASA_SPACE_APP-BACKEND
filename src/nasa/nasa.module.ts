import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  EVA_METABOLIC_BANDS,
  NASA_SOURCES,
  OSDR_DEMO_STUDIES,
} from '../simulation/shared/nasaSources'

const OSDR_BASE = 'https://visualization.osdr.nasa.gov/biodata/api/v2'

@Controller('api/nasa')
export class NasaController {
  @Get('sources')
  sources() {
    return {
      courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
      sources: NASA_SOURCES,
      evaMetabolicBandsBtuHr: EVA_METABOLIC_BANDS,
      note: 'HELIOS usa estas fuentes como fundamento documental. No son instrucciones de tratamiento.',
    }
  }

  @Get('osdr/studies')
  listStudies() {
    return {
      courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
      studies: [...OSDR_DEMO_STUDIES],
      api: OSDR_BASE,
    }
  }

  @Get('osdr/studies/:id')
  async study(@Param('id') id: string) {
    const normalized = id.toUpperCase().startsWith('OSD-') ? id.toUpperCase() : `OSD-${id}`
    if (!(OSDR_DEMO_STUDIES as readonly string[]).includes(normalized)) {
      throw new NotFoundException({
        code: 'unknown_study',
        message: `En este prototipo solo se consultan ${OSDR_DEMO_STUDIES.join(', ')}.`,
      })
    }
    const url = `${OSDR_BASE}/dataset/${normalized}/`
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) {
        throw new ServiceUnavailableException({
          code: 'osdr_unavailable',
          message: `OSDR respondió ${response.status}. Se conserva el enlace documental.`,
          studyId: normalized,
          url: `https://osdr.nasa.gov/bio/repo/data/studies/${normalized}`,
        })
      }
      const payload: unknown = await response.json()
      return {
        courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
        studyId: normalized,
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
        repoUrl: `https://osdr.nasa.gov/bio/repo/data/studies/${normalized}`,
        metadata: summarizeOsdr(payload),
        rawKeys: payload && typeof payload === 'object' ? Object.keys(payload as object).slice(0, 40) : [],
        limitation:
          'HELIOS muestra metadatos para demostrar la integración. No interpreta paneles clínicos ni diagnostica.',
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error
      throw new ServiceUnavailableException({
        code: 'osdr_unreachable',
        message: 'No se pudo contactar la API pública de OSDR. Usá el enlace documental.',
        studyId: normalized,
        url: `https://osdr.nasa.gov/bio/repo/data/studies/${normalized}`,
      })
    }
  }
}

function summarizeOsdr(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return { present: false }
  const root = payload as Record<string, unknown>
  const dataset = (root.dataset ?? root) as Record<string, unknown>
  return {
    present: true,
    title: pickString(dataset, ['title', 'study_title', 'name']),
    description: pickString(dataset, ['description', 'study_description', 'summary'])?.slice(0, 600) ?? null,
    organism: pickString(dataset, ['organism', 'organisms']),
    factor: pickString(dataset, ['factor_name', 'factors']),
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return null
}

@Module({ controllers: [NasaController] })
export class NasaModule {}
