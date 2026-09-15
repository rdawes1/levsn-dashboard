import type { ParameterKey } from './parameters';

/** One measured sample, normalised and flattened out of Airtable. */
export interface Sample {
  id: string;
  sampleId: number | null;
  stationId: string | null;
  stationName: string | null;
  basin: string | null;
  organization: string | null;
  ecoregion: string | null;
  streamSize: string | null;
  tempRegime: string | null;
  locationType: string | null;
  year: number | null;
  /** ISO yyyy-mm-dd */
  date: string | null;
  month: number | null;
  lat: number | null;
  lon: number | null;
  /** Measured value per parameter; null when not sampled. */
  values: Partial<Record<ParameterKey, number | null>>;
  /** Exceedance flag per parameter (1 / 0); null when not evaluated. */
  exceedances: Partial<Record<ParameterKey, number | null>>;
}

export interface Station {
  id: string;
  stationId: string | null;
  stationName: string | null;
  basin: string | null;
  organization: string | null;
  ecoregion: string | null;
  streamSize: string | null;
  tempRegime: string | null;
  locationType: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Snapshot {
  samples: Sample[];
  stations: Station[];
  basins: string[];
  organizations: string[];
  years: number[];
  ecoregions: string[];
  streamSizes: string[];
  tempRegimes: string[];
  /** ISO timestamp of when this snapshot was pulled from Airtable. */
  fetchedAt: string;
  counts: { stations: number; samples: number; basins: number; organizations: number };
}
