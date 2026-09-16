import { PARAMETER_BY_KEY, type ParameterKey } from './parameters';
import {
  conductivityPercentiles,
  groupStats,
  comparisonSeries,
  stationRollups,
  statsTable,
  type Filters,
  type ParameterStats,
} from './stats';
import type { Sample } from './types';
import type { ViewId } from '@/store/useDashboard';

/**
 * CSV export, scoped to the view on screen.
 *
 * Every tab exports the table it is actually showing, over the currently
 * filtered rows - not a generic summary. Column headers use the canonical
 * parameter labels from lib/parameters.ts.
 */

export interface CsvPayload {
  headers: string[];
  rows: unknown[][];
}

/** Summary statistics are derived, so they export at the precision shown. */
function round(value: number | null, precision: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(precision));
}

const STAT_COLUMNS = [
  'Parameter',
  'Unit',
  'Mean Reading',
  'Median Reading',
  'Min Reading',
  'Max Reading',
  'Sample Count',
  'Exceedance Count',
  '% Exceedance',
];

function statRow(s: ParameterStats, prefix: unknown[]): unknown[] {
  const p = PARAMETER_BY_KEY[s.key].precision;
  return [
    ...prefix,
    s.label,
    s.unit,
    round(s.mean, p),
    round(s.median, p),
    round(s.min, p),
    round(s.max, p),
    s.sampleCount,
    s.exceedanceCount,
    round(s.exceedancePct, 1),
  ];
}

export interface ChartState {
  focusParameters: ParameterKey[];
  compareStations: string[];
  /** Zoomed date range on the results chart, epoch ms. */
  chartDateRange: [number, number] | null;
}

export function buildCsv(
  view: ViewId,
  samples: Sample[],
  filters: Filters,
  chart: ChartState
): CsvPayload {
  switch (view) {
    /* Map: one row per monitoring station, matching the markers on screen. */
    case 'locations': {
      const rows = stationRollups(samples, filters.parameters).sort((a, b) =>
        a.stationId.localeCompare(b.stationId)
      );
      return {
        headers: [
          'Station Id',
          'Station Name',
          'Basin',
          'Organization',
          'Latitude',
          'Longitude',
          'Samples',
          'Exceedance Count',
          '% Exceedance',
        ],
        rows: rows.map((r) => [
          r.stationId,
          r.stationName,
          r.basin,
          r.organization,
          r.lat,
          r.lon,
          r.sampleRows,
          r.exceedanceCount,
          round(r.exceedancePct, 1),
        ]),
      };
    }

    case 'basin': {
      const groups = groupStats(samples, (s) => s.basin, filters.parameters);
      return {
        headers: ['Basin', 'Samples In Basin', ...STAT_COLUMNS],
        rows: groups.flatMap((g) => g.stats.map((s) => statRow(s, [g.group, g.sampleRows]))),
      };
    }

    case 'station': {
      const groups = groupStats(samples, (s) => s.stationId, filters.parameters);

      const meta = new Map<string, { name: string | null; basin: string | null }>();
      for (const s of samples) {
        if (s.stationId && !meta.has(s.stationId)) {
          meta.set(s.stationId, { name: s.stationName, basin: s.basin });
        }
      }

      return {
        headers: ['Station Id', 'Station Name', 'Basin', 'Samples At Station', ...STAT_COLUMNS],
        rows: groups.flatMap((g) => {
          const m = meta.get(g.group);
          return g.stats.map((s) =>
            statRow(s, [g.group, m?.name ?? null, m?.basin ?? null, g.sampleRows])
          );
        }),
      };
    }

    /*
     * Results: exactly the readings the chart shows - the charted parameters,
     * the compared stations if any, and the zoomed date range if zoomed.
     * One row per reading, so several parameters share a column layout.
     */
    case 'results': {
      const series = comparisonSeries(
        samples,
        chart.focusParameters,
        chart.compareStations,
        chart.chartDateRange
      );
      const rows = chart.focusParameters.flatMap((key) => {
        const param = PARAMETER_BY_KEY[key];
        return series[key].map((p) => [
          p.stationId,
          p.stationName,
          p.basin,
          p.date,
          param.label,
          p.value,
          param.unit,
          p.exceeds ? 'Exceedance' : 'Non Exceedance',
        ]);
      });
      rows.sort((a, b) =>
        String(a[3]).localeCompare(String(b[3])) || String(a[0]).localeCompare(String(b[0]))
      );
      return {
        headers: [
          'Station Id',
          'Station Name',
          'Basin',
          'Collection Date',
          'Parameter',
          'Reading',
          'Unit',
          'Exceedance',
        ],
        rows,
      };
    }

    case 'reference': {
      return {
        headers: [
          'Sample Year',
          'Basin',
          'Percentiles',
          'Minimum',
          '25Th',
          '50Th',
          'Max',
          'Sample Count',
        ],
        rows: conductivityPercentiles(samples).map((r) => [
          r.year,
          r.basin,
          'Results',
          round(r.min, 2),
          round(r.p25, 2),
          round(r.p50, 2),
          round(r.max, 2),
          r.n,
        ]),
      };
    }

    default: {
      return {
        headers: STAT_COLUMNS,
        rows: statsTable(samples, filters.parameters).map((s) => statRow(s, [])),
      };
    }
  }
}

/** Human-readable note describing the filters behind an export. */
export function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.years.length) parts.push(`Years: ${filters.years.join(', ')}`);
  if (filters.basins.length) parts.push(`Basins: ${filters.basins.join(', ')}`);
  if (filters.stationIds.length) parts.push(`Stations: ${filters.stationIds.join(', ')}`);
  if (filters.organizations.length) parts.push(`Organizations: ${filters.organizations.join(', ')}`);
  if (filters.tempRegimes.length) parts.push(`Temp Regime: ${filters.tempRegimes.join(', ')}`);
  if (filters.ecoregions.length) parts.push(`Ecoregion: ${filters.ecoregions.join(', ')}`);
  if (filters.streamSizes.length) parts.push(`Stream Size: ${filters.streamSizes.join(', ')}`);
  if (filters.parameters.length) {
    parts.push(
      `Parameters: ${filters.parameters.map((k) => PARAMETER_BY_KEY[k].label).join(', ')}`
    );
  }
  return parts.length ? parts.join(' | ') : 'No filters applied (all data)';
}
