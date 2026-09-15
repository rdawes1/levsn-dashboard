import { ALL_PARAMETER_KEYS, type ParameterKey } from './parameters';
import type { Sample, Snapshot, Station } from './types';

/**
 * Compact wire format for the snapshot.
 *
 * The plain JSON snapshot is ~4 MB, because every one of 5,306 samples repeats
 * long strings ("Huron River Watershed Council", "River/Stream", ...) and
 * verbose object keys. Interning those strings into dictionaries and storing
 * measurements as fixed-order arrays takes it to a fraction of the size, which
 * matters for a public dashboard people open on phones.
 *
 * Field order in `values` / `exceedances` follows ALL_PARAMETER_KEYS.
 */

export const WIRE_VERSION = 2;

type Dict = string[];

interface WireSample {
  /** Indices into the dictionaries; -1 means absent. */
  s: number; // station
  b: number; // basin
  o: number; // organization
  e: number; // ecoregion
  z: number; // stream size
  t: number; // temp regime
  l: number; // location type
  y: number; // year, 0 when absent
  d: number; // date index
  m: number; // month, 0 when absent
  /** Measured values, in ALL_PARAMETER_KEYS order. null when not sampled. */
  v: (number | null)[];
  /** Exceedance flags, same order. */
  x: (number | null)[];
}

export interface WireSnapshot {
  version: number;
  fetchedAt: string;
  dicts: {
    stationIds: Dict;
    stationNames: Dict;
    basins: Dict;
    organizations: Dict;
    ecoregions: Dict;
    streamSizes: Dict;
    tempRegimes: Dict;
    locationTypes: Dict;
    dates: Dict;
  };
  /** Per station index: [nameIdx, basinIdx, orgIdx, ecoIdx, sizeIdx, regimeIdx, typeIdx, lat, lon] */
  stations: (number | null)[][];
  samples: WireSample[];
  counts: Snapshot['counts'];
}

class Interner {
  private map = new Map<string, number>();
  readonly values: string[] = [];

  index(v: string | null | undefined): number {
    if (v === null || v === undefined) return -1;
    const hit = this.map.get(v);
    if (hit !== undefined) return hit;
    const i = this.values.length;
    this.values.push(v);
    this.map.set(v, i);
    return i;
  }
}

export function encodeSnapshot(snap: Snapshot): WireSnapshot {
  const stationIds = new Interner();
  const stationNames = new Interner();
  const basins = new Interner();
  const organizations = new Interner();
  const ecoregions = new Interner();
  const streamSizes = new Interner();
  const tempRegimes = new Interner();
  const locationTypes = new Interner();
  const dates = new Interner();

  // Stations first, so station indices are stable and samples can reference them.
  const stations = snap.stations.map((st) => [
    stationIds.index(st.stationId),
    stationNames.index(st.stationName),
    basins.index(st.basin),
    organizations.index(st.organization),
    ecoregions.index(st.ecoregion),
    streamSizes.index(st.streamSize),
    tempRegimes.index(st.tempRegime),
    locationTypes.index(st.locationType),
    st.lat,
    st.lon,
  ]);

  const samples: WireSample[] = snap.samples.map((s) => ({
    s: stationIds.index(s.stationId),
    b: basins.index(s.basin),
    o: organizations.index(s.organization),
    e: ecoregions.index(s.ecoregion),
    z: streamSizes.index(s.streamSize),
    t: tempRegimes.index(s.tempRegime),
    l: locationTypes.index(s.locationType),
    y: s.year ?? 0,
    d: dates.index(s.date),
    m: s.month ?? 0,
    v: ALL_PARAMETER_KEYS.map((k) => s.values[k] ?? null),
    x: ALL_PARAMETER_KEYS.map((k) => s.exceedances[k] ?? null),
  }));

  return {
    version: WIRE_VERSION,
    fetchedAt: snap.fetchedAt,
    dicts: {
      stationIds: stationIds.values,
      stationNames: stationNames.values,
      basins: basins.values,
      organizations: organizations.values,
      ecoregions: ecoregions.values,
      streamSizes: streamSizes.values,
      tempRegimes: tempRegimes.values,
      locationTypes: locationTypes.values,
      dates: dates.values,
    },
    stations,
    samples,
    counts: snap.counts,
  };
}

const at = (d: Dict, i: number): string | null => (i < 0 ? null : (d[i] ?? null));

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

export function decodeSnapshot(w: WireSnapshot): Snapshot {
  if (w.version !== WIRE_VERSION) {
    throw new Error(
      `Snapshot format v${w.version} does not match this build (v${WIRE_VERSION}). Re-run "npm run snapshot".`
    );
  }

  const d = w.dicts;

  const stations: Station[] = w.stations.map((row, i) => ({
    id: `st${i}`,
    stationId: at(d.stationIds, row[0] as number),
    stationName: at(d.stationNames, row[1] as number),
    basin: at(d.basins, row[2] as number),
    organization: at(d.organizations, row[3] as number),
    ecoregion: at(d.ecoregions, row[4] as number),
    streamSize: at(d.streamSizes, row[5] as number),
    tempRegime: at(d.tempRegimes, row[6] as number),
    locationType: at(d.locationTypes, row[7] as number),
    lat: (row[8] as number | null) ?? null,
    lon: (row[9] as number | null) ?? null,
  }));

  // Coordinates come from the station registry rather than being repeated per sample.
  const coords = new Map<string, { lat: number | null; lon: number | null }>();
  for (const st of stations) {
    if (st.stationId && !coords.has(st.stationId)) {
      coords.set(st.stationId, { lat: st.lat, lon: st.lon });
    }
  }

  const samples: Sample[] = w.samples.map((s, i) => {
    const stationId = at(d.stationIds, s.s);
    const values: Sample['values'] = {};
    const exceedances: Sample['exceedances'] = {};

    ALL_PARAMETER_KEYS.forEach((k: ParameterKey, idx) => {
      values[k] = s.v[idx];
      exceedances[k] = s.x[idx];
    });

    const ll = stationId ? coords.get(stationId) : undefined;

    return {
      id: `s${i}`,
      sampleId: null,
      stationId,
      stationName: null,
      basin: at(d.basins, s.b),
      organization: at(d.organizations, s.o),
      ecoregion: at(d.ecoregions, s.e),
      streamSize: at(d.streamSizes, s.z),
      tempRegime: at(d.tempRegimes, s.t),
      locationType: at(d.locationTypes, s.l),
      year: s.y || null,
      date: at(d.dates, s.d),
      month: s.m || null,
      lat: ll?.lat ?? null,
      lon: ll?.lon ?? null,
      values,
      exceedances,
    };
  });

  // Station names are looked up from the registry rather than stored per sample.
  const nameByStation = new Map<string, string | null>();
  for (const st of stations) {
    if (st.stationId && !nameByStation.has(st.stationId)) {
      nameByStation.set(st.stationId, st.stationName);
    }
  }
  for (const s of samples) {
    if (s.stationId) s.stationName = nameByStation.get(s.stationId) ?? null;
  }

  return {
    samples,
    stations,
    basins: uniqueSorted(d.basins),
    organizations: uniqueSorted(stations.map((s) => s.organization)),
    years: [...new Set(samples.map((s) => s.year).filter((y): y is number => y !== null))].sort(
      (a, b) => a - b
    ),
    ecoregions: uniqueSorted(stations.map((s) => s.ecoregion)),
    streamSizes: uniqueSorted(stations.map((s) => s.streamSize)),
    tempRegimes: uniqueSorted(stations.map((s) => s.tempRegime)),
    fetchedAt: w.fetchedAt,
    counts: w.counts,
  };
}
