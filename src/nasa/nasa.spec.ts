import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { NasaModule } from './nasa.module';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NasaHttp, range } from './nasa-http';
import { DonkiService, normalizeRadlab, summarizeOsdr } from './nasa-services';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name + '.json'), 'utf8'));
afterEach(() => jest.restoreAllMocks());
describe('NASA mappings and boundaries', () => {
  it('maps the verified OSDR accession envelope', () => {
    const human = summarizeOsdr(fixture('osdr'), 'OSD-575');
    expect(human.organism).toBe('Homo sapiens');
    expect(human.mission).toBe('SpaceX Inspiration4');
    expect(summarizeOsdr(fixture('osdr288'), 'OSD-288').organism).toBe(
      'Mus musculus',
    );
    expect(summarizeOsdr({}, 'OSD-575').title).toBeNull();
  });
  it('reads RadLab split tables without conflating dose quantities', () => {
    const rows = normalizeRadlab(fixture('radlab'));
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({
      instrument: 'REM-Lid',
      spacecraft: 'ISS',
      absorbedDoseRate: 9.175176,
      doseEquivalentRate: null,
    });
    expect(
      normalizeRadlab({ columns: ['timestamp', 'instrument_id'], data: [] }),
    ).toEqual([]);
    expect(() => normalizeRadlab({})).toThrow(ServiceUnavailableException);
  });
  it('rejects malformed dates, inversions, large ranges and injection', () => {
    const defaults = { startDate: '2023-05-16', endDate: '2023-05-16' };
    for (const q of [
      { startDate: '2023-02-30' },
      { startDate: '2024-01-01', endDate: '2023-01-01' },
      { endDate: '2024-01-01' },
      { instrument: 'REM|other' },
      { type: 'unknown' },
    ])
      expect(() => range(q, 1, defaults)).toThrow(BadRequestException);
  });
  it('normalizes verified DONKI events and never returns the API key', async () => {
    const http = new NasaHttp();
    jest.spyOn(http, 'get').mockResolvedValue({
      payload: fixture('donki'),
      fetchedAt: '2026-11-14T12:00:00Z',
      cached: false,
    });
    const result = await new DonkiService(http).events({
      type: 'FLR',
      startDate: '2024-05-10',
      endDate: '2024-05-10',
    });
    expect(result.events[0].type).toBe('FLR');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0]).toMatchObject({
      beginTime: expect.any(String),
      instruments: expect.any(Array),
    });
    expect(result.failures).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('api_key');
  });
  it('deduplicates, caches and reports external failures without fabricated data', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([])));
    const http = new NasaHttp();
    const first = await http.get('https://example.test');
    expect(first.cached).toBe(false);
    expect((await http.get('https://example.test')).cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new Error('offline'));
    await expect(http.get('https://offline.test')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
  it('expires cache and stops repeated upstream calls', async () => {
    let now = 1700000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response('[]')));
    const http = new NasaHttp();
    await http.get('https://example.test');
    now += 300001;
    await http.get('https://example.test');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 19; i++) await http.get(`https://example.test/${i}`);
    await expect(
      http.get('https://example.test/over-limit'),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('NASA HTTP contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [NasaModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('validates dates before making external requests', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/nasa/donki/events?startDate=invalid')
      .expect(400);
  });
  it('retains the existing OSDR catalog and unknown-study behavior', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/nasa/osdr/studies')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/nasa/osdr/studies/999999')
      .expect(404);
  });
  it('serves a verified historical example with explicit provenance', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/nasa/radlab/example')
      .expect(200);
    const body = response.body as {
      example: boolean;
      simulated: boolean;
      measurements: unknown[];
    };
    expect(body.example).toBe(true);
    expect(body.simulated).toBe(false);
    expect(body.measurements).toHaveLength(13);
    const units = (
      response.body as {
        units: { absorbedDoseRate: string; doseEquivalentRate: string };
      }
    ).units;
    expect(units).toEqual({
      absorbedDoseRate: '\u00b5Gy/h',
      doseEquivalentRate: '\u00b5Sv/h',
    });
  });
});
