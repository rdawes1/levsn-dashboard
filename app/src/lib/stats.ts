import {
  VISIBLE_PARAMETERS,
  VISIBLE_PARAMETER_KEYS,
  type ParameterDef,
  type ParameterKey,
} from './parameters';
import type { Sample } from './types';

/**
 * Aggregation engine. Every summary the dashboard shows is derived here from
 * raw `LEVSN Samples` rows - never from Airtable's per-year rollup fields.
 *
 * This is deliberate: the Stations and Basins tables carry ~265 hard-coded
 * "<Parameter> <Stat> <Year>" fields that must be hand-extended every season.
 * Deriving from raw rows means a new sample year appears with no schema work.
 *
 * Verified against the published Tableau dashboard: Big Sister Creek / 2025
 * reproduces mean, median, min and max for all nine parameters exactly.
 */

export interface ParameterStats {
  key: ParameterKey;
  /** Canonical display label - see lib/parameters.ts */
  label: string;
  unit: string;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sampleCount: number;
  exceedanceCount: number;
  /** Percentage 0-100, or null when there is nothing to evaluate. */
  exceedancePct: number | null;
}

export interface Filters {
  years: number[];
  basins: string[];
  stationIds: string[];
  organizations: string[];
  parameters: ParameterKey[];
  tempRegimes: string[];
  ecoregions: string[];
  streamSizes: string[];
}

export const EMPTY_FILTERS: Filters = {
  years: [],
  basins: [],
  stationIds: [],
  organizations: [],
  parameters: [],
  tempRegimes: [],
  ecoregions: [],
  streamSizes: [],
};

/** An empty selection means "no constraint", matching the dashboard's (All). */
function matches(selected: string[] | number[], value: string | number | null): boolean {
  if (!selected.length) return true;
  if (value === null) return false;
  return (selected as (string | number)[]).includes(value);
}

export function filterSamples(samples: Sample[], f: Filters): Sample[] {
  return samples.filter(
    (s) =>
      matches(f.years, s.year) &&
      matches(f.basins, s.basin) &&
      matches(f.stationIds, s.stationId) &&
      matches(f.organizations, s.organization) &&
      matches(f.tempRegimes, s.tempRegime) &&
      matches(f.ecoregions, s.ecoregion) &&
      matches(f.streamSizes, s.streamSize)
  );
}

export function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolation percentile, matching the convention used in EPA tables. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function statsFor(samples: Sample[], param: ParameterDef): ParameterStats {
  const values: number[] = [];
  let exceedanceCount = 0;
  let evaluated = 0;

  for (const s of samples) {
    const v = s.values[param.key];
    if (typeof v === 'number') values.push(v);

    const e = s.exceedances[param.key];
    if (typeof e === 'number') {
      evaluated += 1;
      exceedanceCount += e;
    }
  }

  values.sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);

  return {
    key: param.key,
    label: param.label,
    unit: param.unit,
    mean: values.length ? sum / values.length : null,
    median: median(values),
    min: values.length ? values[0] : null,
    max: values.length ? values[values.length - 1] : null,
    sampleCount: values.length,
    exceedanceCount,
    exceedancePct: evaluated ? (exceedanceCount / evaluated) * 100 : null,
  };
}

/** Stats for a set of parameters, in canonical registry order. Hidden
 *  parameters never appear, whatever is passed in. */
export function statsTable(samples: Sample[], keys: ParameterKey[]): ParameterStats[] {
  const wanted = keys.length ? new Set<ParameterKey>(keys) : null;
  return VISIBLE_PARAMETERS.filter((p) => !wanted || wanted.has(p.key)).map((p) =>
    statsFor(samples, p)
  );
}

export interface GroupedStats<T> {
  group: T;
  sampleRows: number;
  stats: ParameterStats[];
}

/** Groups samples by an arbitrary key, then builds a stats table per group. */
export function groupStats<T extends string>(
  samples: Sample[],
  keyOf: (s: Sample) => T | null,
  parameters: ParameterKey[]
): GroupedStats<T>[] {
  const groups = new Map<T, Sample[]>();
  for (const s of samples) {
    const k = keyOf(s);
    if (k === null) continue;
    const bucket = groups.get(k);
    if (bucket) bucket.push(s);
    else groups.set(k, [s]);
  }

  return [...groups.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([group, rows]) => ({
      group,
      sampleRows: rows.length,
      stats: statsTable(rows, parameters),
    }));
}

/** Time-ordered points for the results scatter / line view. */
export interface SeriesPoint {
  date: string;
  timestamp: number;
  value: number;
  exceeds: boolean;
  stationId: string | null;
  stationName: string | null;
  basin: string | null;
}

export function seriesFor(samples: Sample[], key: ParameterKey): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const s of samples) {
    const v = s.values[key];
    if (typeof v !== 'number' || !s.date) continue;
    const timestamp = Date.parse(s.date);
    if (Number.isNaN(timestamp)) continue;
    points.push({
      date: s.date,
      timestamp,
      value: v,
      exceeds: s.exceedances[key] === 1,
      stationId: s.stationId,
      stationName: s.stationName,
      basin: s.basin,
    });
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

/** Per-station rollup used to colour and size the map markers. */
export interface StationRollup {
  stationId: string;
  stationName: string | null;
  basin: string | null;
  organization: string | null;
  lat: number;
  lon: number;
  sampleRows: number;
  exceedanceCount: number;
  evaluated: number;
  exceedancePct: number | null;
}

export function stationRollups(samples: Sample[], keys: ParameterKey[]): StationRollup[] {
  const active = keys.length ? keys : VISIBLE_PARAMETER_KEYS;
  const map = new Map<string, StationRollup>();

  for (const s of samples) {
    if (!s.stationId || s.lat === null || s.lon === null) continue;

    let row = map.get(s.stationId);
    if (!row) {
      row = {
        stationId: s.stationId,
        stationName: s.stationName,
        basin: s.basin,
        organization: s.organization,
        lat: s.lat,
        lon: s.lon,
        sampleRows: 0,
        exceedanceCount: 0,
        evaluated: 0,
        exceedancePct: null,
      };
      map.set(s.stationId, row);
    }

    row.sampleRows += 1;
    for (const k of active) {
      const e = s.exceedances[k];
      if (typeof e === 'number') {
        row.evaluated += 1;
        row.exceedanceCount += e;
      }
    }
  }

  for (const row of map.values()) {
    row.exceedancePct = row.evaluated ? (row.exceedanceCount / row.evaluated) * 100 : null;
  }

  return [...map.values()];
}

/* ---------------------------------------------------------------------------
 * Conductivity percentiles, shared by the OH EPA reference view and its export.
 * ------------------------------------------------------------------------- */

export interface ConductivityRow {
  year: number;
  basin: string;
  n: number;
  min: number | null;
  p25: number | null;
  p50: number | null;
  max: number | null;
}

export function conductivityPercentiles(samples: Sample[]): ConductivityRow[] {
  const groups = new Map<string, { year: number; basin: string; values: number[] }>();

  for (const s of samples) {
    const v = s.values.conductivity;
    if (typeof v !== 'number' || !s.year || !s.basin) continue;
    const key = `${s.year}||${s.basin}`;
    const bucket = groups.get(key);
    if (bucket) bucket.values.push(v);
    else groups.set(key, { year: s.year, basin: s.basin, values: [v] });
  }

  return [...groups.values()]
    .map(({ year, basin, values }) => {
      values.sort((a, b) => a - b);
      return {
        year,
        basin,
        n: values.length,
        min: values[0] ?? null,
        p25: percentile(values, 0.25),
        p50: percentile(values, 0.5),
        max: values[values.length - 1] ?? null,
      };
    })
    .sort((a, b) => a.year - b.year || a.basin.localeCompare(b.basin));
}

/* ---------------------------------------------------------------------------
 * Faceted filter options.
 *
 * Stops the filters offering combinations that return nothing. For each
 * dimension we apply every OTHER active filter, then collect the values that
 * actually survive - so choosing a station immediately narrows the year list to
 * the years that station was sampled.
 * ------------------------------------------------------------------------- */

export type FacetKey = Exclude<keyof Filters, 'parameters'>;

export interface Facets {
  years: Set<number>;
  basins: Set<string>;
  stationIds: Set<string>;
  organizations: Set<string>;
  tempRegimes: Set<string>;
  ecoregions: Set<string>;
  streamSizes: Set<string>;
}

const FACET_VALUE: Record<FacetKey, (s: Sample) => string | number | null> = {
  years: (s) => s.year,
  basins: (s) => s.basin,
  stationIds: (s) => s.stationId,
  organizations: (s) => s.organization,
  tempRegimes: (s) => s.tempRegime,
  ecoregions: (s) => s.ecoregion,
  streamSizes: (s) => s.streamSize,
};

const FACET_KEYS = Object.keys(FACET_VALUE) as FacetKey[];

export function availableFacets(samples: Sample[], filters: Filters): Facets {
  const facets = {
    years: new Set<number>(),
    basins: new Set<string>(),
    stationIds: new Set<string>(),
    organizations: new Set<string>(),
    tempRegimes: new Set<string>(),
    ecoregions: new Set<string>(),
    streamSizes: new Set<string>(),
  } as Facets;

  for (const target of FACET_KEYS) {
    // Every filter except the one whose options we are computing.
    const others: Filters = { ...filters, [target]: [] } as Filters;
    const subset = filterSamples(samples, others);
    const bucket = facets[target] as Set<string | number>;
    const read = FACET_VALUE[target];
    for (const s of subset) {
      const v = read(s);
      if (v !== null) bucket.add(v);
    }
  }

  return facets;
}

/**
 * Chart series for several parameters, optionally limited to a set of
 * compared stations and a date range. Every panel shares the same sample set,
 * so the stacked charts always describe the same readings.
 */
export function comparisonSeries(
  samples: Sample[],
  keys: ParameterKey[],
  stations: string[],
  dateRange: [number, number] | null
): Record<ParameterKey, SeriesPoint[]> {
  const scoped = stations.length
    ? samples.filter((s) => s.stationId !== null && stations.includes(s.stationId))
    : samples;

  const out = {} as Record<ParameterKey, SeriesPoint[]>;
  for (const key of keys) {
    const points = seriesFor(scoped, key);
    out[key] = dateRange
      ? points.filter((p) => p.timestamp >= dateRange[0] && p.timestamp <= dateRange[1])
      : points;
  }
  return out;
}
