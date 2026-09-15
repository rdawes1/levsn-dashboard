import { PARAMETERS } from './parameters';
import type { Sample, Snapshot, Station } from './types';

const BASE_ID = process.env.AIRTABLE_BASE_ID ?? 'appVBC2SUwFcom2p5';
const API = 'https://api.airtable.com/v0';

const TABLES = {
  stations: 'tblmIktd5JMIUhbK2',
  samples: 'tblWxcml55EzTJBrf',
  basins: 'tblG8RDGgnko4zXIX',
} as const;

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

/** Airtable returns `{ specialValue: 'NaN' }` for empty rollups - treat as null. */
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v) && v.length) return str(v[0]);
  return null;
}

function firstNum(v: unknown): number | null {
  if (Array.isArray(v) && v.length) return num(v[0]);
  return num(v);
}

/**
 * Pages through an Airtable table. Airtable allows 5 requests/second/base, so
 * requests are spaced out. Because this runs server-side behind a cache, a
 * single pass serves every visitor for the whole revalidation window.
 */
async function fetchTable(table: string, token: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${API}/${BASE_ID}/${table}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Airtable ${table} responded ${res.status}: ${body.slice(0, 200)}`);
    }

    const page = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...page.records);
    offset = page.offset;

    if (offset) await new Promise((r) => setTimeout(r, 220));
  } while (offset);

  return records;
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

export async function loadSnapshot(): Promise<Snapshot> {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error('AIRTABLE_TOKEN is not set. Copy .env.example to .env.local.');

  const [stationRecs, sampleRecs, basinRecs] = await Promise.all([
    fetchTable(TABLES.stations, token),
    fetchTable(TABLES.samples, token),
    fetchTable(TABLES.basins, token),
  ]);

  // Basin record id -> basin name, so samples and stations can resolve their basin.
  const basinName = new Map<string, string>();
  for (const r of basinRecs) {
    const name = str(r.fields['Basin Name']);
    if (name) basinName.set(r.id, name);
  }

  const resolveBasin = (v: unknown): string | null => {
    if (!Array.isArray(v) || !v.length) return null;
    const first = v[0];
    if (typeof first !== 'string') return null;
    return basinName.get(first) ?? null;
  };

  const stations: Station[] = stationRecs.map((r) => {
    const f = r.fields;
    return {
      id: r.id,
      stationId: str(f['station_id']),
      stationName: str(f['Station Name (from station_id)']),
      basin: resolveBasin(f['Basin']),
      organization: str(f['Organization (from station_id)']),
      ecoregion: str(f['Ecoregion (from station_id) 2']),
      streamSize: str(f['StreamSize (from station_id) 2']),
      tempRegime: str(f['Temp Regime Name']),
      locationType: str(f['Monitoring Location Type']),
      lat: num(f['Latitude (from station_id)']),
      lon: num(f['Longitude (from station_id)']),
    };
  });

  const stationByRecId = new Map(stations.map((s) => [s.id, s]));

  const samples: Sample[] = sampleRecs.map((r) => {
    const f = r.fields;
    const linked = Array.isArray(f['station_id']) ? (f['station_id'] as string[])[0] : undefined;
    const station = linked ? stationByRecId.get(linked) : undefined;

    const values: Sample['values'] = {};
    const exceedances: Sample['exceedances'] = {};
    for (const p of PARAMETERS) {
      values[p.key] = num(f[p.valueField]);
      exceedances[p.key] = num(f[p.exceedanceField]);
    }

    const date = str(f['collection_date']);

    return {
      id: r.id,
      sampleId: num(f['SampleID']),
      stationId: station?.stationId ?? null,
      stationName: station?.stationName ?? str(f['Station Name (from station_id) (from station_id)']),
      basin: resolveBasin(f['Basin-Sample']) ?? resolveBasin(f['Basin']) ?? station?.basin ?? null,
      organization:
        str(f['Organization (from station_id) (from station_id)']) ?? station?.organization ?? null,
      ecoregion:
        str(f['Ecoregion (from station_id) 2 (from station_id)']) ?? station?.ecoregion ?? null,
      streamSize:
        str(f['StreamSize (from station_id) 2 (from station_id)']) ?? station?.streamSize ?? null,
      tempRegime: str(f['Temp Regime']) ?? station?.tempRegime ?? null,
      locationType: str(f['Monitoring Location Type']) ?? station?.locationType ?? null,
      year: num(f['Sample Run Year']),
      date,
      month: num(f['collection_month']),
      lat: firstNum(f['Latitude (from station_id) (from station_id)']) ?? station?.lat ?? null,
      lon: firstNum(f['Longitude (from station_id) (from station_id)']) ?? station?.lon ?? null,
      values,
      exceedances,
    };
  });

  const years = [...new Set(samples.map((s) => s.year).filter((y): y is number => y !== null))].sort(
    (a, b) => a - b
  );

  return {
    samples,
    stations,
    basins: uniqueSorted([...basinName.values()]),
    organizations: uniqueSorted(stations.map((s) => s.organization)),
    years,
    ecoregions: uniqueSorted(stations.map((s) => s.ecoregion)),
    streamSizes: uniqueSorted(stations.map((s) => s.streamSize)),
    tempRegimes: uniqueSorted(stations.map((s) => s.tempRegime)),
    fetchedAt: new Date().toISOString(),
    counts: {
      stations: stations.length,
      samples: samples.length,
      // Basins with at least one station - i.e. basins the dashboard can
      // actually show data for, not every row in the Basins table.
      basins: new Set(stations.map((s) => s.basin).filter(Boolean)).size,
      organizations: uniqueSorted(stations.map((s) => s.organization)).length,
    },
  };
}
