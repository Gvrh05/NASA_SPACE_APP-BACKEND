import { RADLAB_EXAMPLE } from './radlab-example';
import { NasaHttp, provenance } from './nasa-http';
import { DonkiService, RadlabService, summarizeOsdr } from './nasa-services';
import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EVA_METABOLIC_BANDS,
  NASA_SOURCES,
  OSDR_DEMO_STUDIES,
} from '../simulation/shared/nasaSources';

const OSDR_BASE = 'https://visualization.osdr.nasa.gov/biodata/api/v2';

@Controller('api/nasa')
export class NasaController {
  constructor(
    private readonly http: NasaHttp,
    private readonly donki: DonkiService,
    private readonly radlab: RadlabService,
  ) {}
  @Get('donki/events')
  events(@Query() query: unknown) {
    return this.donki.events(query);
  }
  @Get('radlab/example')
  example() {
    return RADLAB_EXAMPLE;
  }
  @Get('radlab/measurements')
  measurements(@Query() query: unknown) {
    return this.radlab.measurements(query);
  }

  @Get('sources')
  sources() {
    return {
      courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
      sources: NASA_SOURCES,
      evaMetabolicBandsBtuHr: EVA_METABOLIC_BANDS,
      note: 'HELIOS usa estas fuentes como fundamento documental. No son instrucciones de tratamiento.',
    };
  }

  @Get('osdr/studies')
  listStudies() {
    return {
      courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
      studies: [...OSDR_DEMO_STUDIES],
      api: OSDR_BASE,
    };
  }

  @Get('osdr/studies/:id')
  async study(@Param('id') id: string) {
    const normalized = id.toUpperCase().startsWith('OSD-')
      ? id.toUpperCase()
      : `OSD-${id}`;
    if (!(OSDR_DEMO_STUDIES as readonly string[]).includes(normalized)) {
      throw new NotFoundException({
        code: 'unknown_study',
        message: `En este prototipo solo se consultan ${OSDR_DEMO_STUDIES.join(', ')}.`,
      });
    }
    const url = `${OSDR_BASE}/dataset/${normalized}/`;
    try {
      const response = await this.http.get(url);
      const payload = response.payload;
      return {
        courtesy: 'Data are courtesy of the NASA Open Science Data Repository',
        studyId: normalized,
        ...provenance('NASA OSDR', url, response, true),
        sourceUrl: url,
        repoUrl: `https://osdr.nasa.gov/bio/repo/data/studies/${normalized}`,
        metadata: summarizeOsdr(payload, normalized),
        rawKeys:
          payload && typeof payload === 'object'
            ? Object.keys(payload).slice(0, 40)
            : [],
        limitation:
          'HELIOS muestra metadatos para demostrar la integración. No interpreta paneles clínicos ni diagnostica.',
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException({
        code: 'osdr_unreachable',
        message:
          'No se pudo contactar la API pública de OSDR. Usá el enlace documental.',
        studyId: normalized,
        url: `https://osdr.nasa.gov/bio/repo/data/studies/${normalized}`,
      });
    }
  }
}

@Module({
  controllers: [NasaController],
  providers: [NasaHttp, DonkiService, RadlabService],
})
export class NasaModule {}
