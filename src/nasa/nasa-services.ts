import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  NasaHttp,
  record,
  text,
  nasaLink,
  provenance,
  range,
} from './nasa-http';
@Injectable()
export class DonkiService {
  constructor(private readonly http: NasaHttp) {}
  async events(query: unknown) {
    const today = new Date().toISOString().slice(0, 10);
    const q = range(query, 30, {
      startDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: today,
    });
    const key =
      process.env.NASA_API_KEY ||
      (process.env.NODE_ENV !== 'production' ? 'DEMO_KEY' : '');
    if (!key || (key === 'DEMO_KEY' && process.env.NODE_ENV === 'production'))
      throw new ServiceUnavailableException('NASA_API_KEY required');
    const groups = await Promise.all(
      (q.type ? [q.type] : ['SEP', 'FLR', 'CME']).map(async (type) => {
        // CCMC official service after the September 2026 migration. NASA key stays server-side.
        const url = new URL(`https://ccmc.gsfc.nasa.gov/DONKI/WS/get/${type}`);
        url.search = new URLSearchParams({
          startDate: q.startDate,
          endDate: q.endDate,
          api_key: key,
        }).toString();
        const response = await this.http.get(url.href);
        if (!Array.isArray(response.payload))
          throw new ServiceUnavailableException('Invalid DONKI response');
        const sourceUrl = `https://ccmc.gsfc.nasa.gov/DONKI/WS/get/${type}?startDate=${q.startDate}&endDate=${q.endDate}`;
        return {
          ...provenance('NASA DONKI', sourceUrl, response, true),
          events: response.payload
            .map(record)
            .map((row) => ({
              id: text(row.flrID ?? row.sepID ?? row.activityID),
              type,
              timestamp: text(row.beginTime ?? row.eventTime ?? row.startTime),
              classification: text(row.classType),
              description: text(row.note),
              sourceUrl: nasaLink(row.link),
            }))
            .filter((row) => row.id && row.timestamp),
        };
      }),
    );
    return {
      events: groups
        .flatMap((g) => g.events)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
      sources: groups.map((group) => ({
        source: group.source,
        sourceUrl: group.sourceUrl,
        fetchedAt: group.fetchedAt,
        cached: group.cached,
        historical: group.historical,
        simulated: group.simulated,
      })),
      query: q,
    };
  }
}
@Injectable()
export class RadlabService {
  constructor(private readonly http: NasaHttp) {}
  async measurements(query: unknown) {
    const q = range(query, 1, {
      startDate: '2023-05-16',
      endDate: '2023-05-16',
    });
    const end = new Date(Date.parse(q.endDate) + 86400000)
      .toISOString()
      .slice(0, 10);
    const url = new URL('https://visualization.osdr.nasa.gov/radlab/api');
    url.search = new URLSearchParams({
      instrument_id: q.instrument,
      'timestamp>': q.startDate,
      'timestamp<': end,
      absorbed_dose_rate: '',
      dose_equivalent_rate: '',
      spacecraft: '',
      format: 'json',
    }).toString();
    const response = await this.http.get(url.href, 30000);
    return {
      ...provenance('NASA RadLab', url.href, response, true),
      measurements: normalizeRadlab(response.payload).filter(
        (row) => row.timestamp! < `${end}T00:00:00`,
      ),
      units: { absorbedDoseRate: 'µGy/h', doseEquivalentRate: 'µSv/h' },
      query: q,
    };
  }
}
export function normalizeRadlab(payload: unknown) {
  const root = record(payload);
  if (!Array.isArray(root.columns) || !Array.isArray(root.data))
    throw new ServiceUnavailableException('Invalid RadLab table');
  const columns = root.columns as unknown[];
  if (!columns.includes('timestamp') || !columns.includes('instrument_id'))
    throw new ServiceUnavailableException('Missing RadLab columns');
  const number = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return root.data
    .map((values: unknown) => {
      if (!Array.isArray(values))
        throw new ServiceUnavailableException('Invalid RadLab row');
      const row = Object.fromEntries(
        columns.map((key, i) => [String(key), values[i] as unknown]),
      );
      return {
        timestamp: text(row.timestamp),
        instrument: text(row.instrument_id),
        spacecraft: text(row.spacecraft),
        absorbedDoseRate: number(row.absorbed_dose_rate),
        doseEquivalentRate: number(row.dose_equivalent_rate),
      };
    })
    .filter(
      (row) =>
        row.timestamp &&
        Number.isFinite(Date.parse(row.timestamp)) &&
        row.instrument &&
        (row.absorbedDoseRate !== null || row.doseEquivalentRate !== null),
    )
    .slice(0, 5000);
}
export function summarizeOsdr(payload: unknown, id: string) {
  const root = record(payload);
  const dataset = record(root[id]);
  const metadata = record(dataset.metadata);
  return {
    present: Object.keys(metadata).length > 0,
    title: text(metadata['study title']),
    description: text(metadata['study description']),
    organism: text(metadata.organism),
    factor: text(metadata['study factor name']),
    researchType: text(metadata['study assay measurement type']),
    conditions:
      text(record(metadata['factor value']).spaceflight) ??
      text(metadata['study factor type']),
    mission: text(record(metadata.mission).name),
  };
}
