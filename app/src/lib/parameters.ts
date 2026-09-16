/**
 * CANONICAL PARAMETER REGISTRY
 * ----------------------------------------------------------------------------
 * This is the ONLY place parameter labels are defined. Every table header,
 * filter checkbox, chart axis, legend, tooltip and CSV column reads from here.
 *
 * `label` strings are byte-for-byte identical to the labels used in the
 * existing LEVSN Tableau dashboard. Do not rename them without also renaming
 * them in the published dashboard - they are what users search and cite.
 *
 * `valueField` / `exceedanceField` / `countField` are the EXACT Airtable field
 * names in the `LEVSN Samples` table (tblWxcml55EzTJBrf).
 */

export type ParameterKey =
  | 'chloride'
  | 'conductivity'
  | 'conductivityBiocondition'
  | 'conductivityTds'
  | 'dissolvedOxygen'
  | 'ph'
  | 'salinity'
  | 'totalDissolvedSolids'
  | 'waterTemperature';

export interface ParameterDef {
  key: ParameterKey;
  /** Display label - must match the existing dashboard exactly. */
  label: string;
  /** Airtable field in `LEVSN Samples` holding the measured value. */
  valueField: string;
  /** Airtable field holding the per-sample exceedance flag (1 / 0). */
  exceedanceField: string;
  /** Airtable field holding the per-sample count flag. */
  countField: string;
  unit: string;
  /** Plain-language description of the exceedance rule, shown in the UI. */
  threshold: string;
  /** Number of decimal places used when displaying values. */
  precision: number;
  /**
   * Whether this parameter is shown in the public dashboard.
   *
   * Chloride and Total Dissolved Solids are computed and kept in the data, but
   * excluded from public view per LEVSN programme guidance - Chloride is to be
   * entered directly by volunteers rather than derived, and Conductivity TDS is
   * the TDS measure the programme reports. Flip these to true to restore them;
   * nothing else needs to change.
   */
  publicVisible: boolean;
  /**
   * Reference lines drawn on the chart. These mirror the exceedance rules in
   * `threshold`, which are applied in Airtable; they are for orientation only
   * and play no part in deciding whether a reading exceeds.
   */
  thresholdLines?: { value: number; label: string }[];
  /** Whether the value axis should start at zero. False for pH, which sits in a narrow band. */
  zeroBaseline: boolean;
}

export const PARAMETERS: ParameterDef[] = [
  {
    key: 'chloride',
    label: 'Chloride',
    valueField: 'Chloride',
    exceedanceField: 'Chloride_Ex',
    countField: 'Chloride_Sample Count',
    unit: 'mg/L',
    threshold: 'Exceedance when Chloride > 150 mg/L',
    precision: 2,
    thresholdLines: [{ value: 150, label: '150 limit' }],
    zeroBaseline: true,
    publicVisible: false,
  },
  {
    key: 'conductivity',
    label: 'Conductivity',
    valueField: 'Conductivity',
    exceedanceField: 'Conductivity_Ex',
    countField: 'Conductivity_Sample Count',
    unit: 'µS/cm',
    threshold: 'Exceedance when Conductivity ≥ 1,500 µS/cm',
    precision: 2,
    thresholdLines: [{ value: 1500, label: '1,500 limit' }],
    zeroBaseline: true,
    publicVisible: true,
  },
  {
    key: 'conductivityBiocondition',
    label: 'Conductivity Biocondition',
    valueField: 'ConductivityBiocondition',
    exceedanceField: 'ConductivityBiocondition_Ex',
    countField: 'ConductivityBiocondition_Sample Count',
    unit: 'µS/cm',
    threshold: 'Exceedance when Conductivity ≥ 412 µS/cm (biological condition benchmark)',
    precision: 2,
    thresholdLines: [{ value: 412, label: '412 benchmark' }],
    zeroBaseline: true,
    publicVisible: true,
  },
  {
    key: 'conductivityTds',
    label: 'Conductivity TDS',
    valueField: 'TDS',
    exceedanceField: 'ConductivityTDS_Ex',
    countField: 'TDS_Sample Count',
    unit: 'mg/L',
    threshold: 'Exceedance when TDS > 1,500 mg/L',
    precision: 2,
    thresholdLines: [{ value: 1500, label: '1,500 limit' }],
    zeroBaseline: true,
    publicVisible: true,
  },
  {
    key: 'dissolvedOxygen',
    label: 'Dissolved Oxygen',
    valueField: 'Dissolved Oxygen',
    exceedanceField: 'Dissolved Oxygen_Ex',
    countField: 'Dissolved Oxygen Sample Count',
    unit: 'mg/L',
    threshold: 'Exceedance when DO ≤ 5 mg/L (Warm) or ≤ 7 mg/L (Cold)',
    precision: 2,
    thresholdLines: [
      { value: 5, label: '5 Warm' },
      { value: 7, label: '7 Cold' },
    ],
    zeroBaseline: true,
    publicVisible: true,
  },
  {
    key: 'ph',
    label: 'pH',
    valueField: 'pH',
    exceedanceField: 'pH_Ex',
    countField: 'pH Sample Count',
    unit: 'su',
    threshold: 'Exceedance when pH < 6.5 or pH > 9',
    precision: 2,
    thresholdLines: [
      { value: 6.5, label: '6.5' },
      { value: 9, label: '9' },
    ],
    zeroBaseline: false,
    publicVisible: true,
  },
  {
    key: 'salinity',
    label: 'Salinity',
    valueField: 'Salinity',
    exceedanceField: 'Salinity Ex',
    countField: 'Salinity_Sample Count',
    unit: 'mg/L',
    threshold: 'Exceedance when Salinity ≥ 1,000 mg/L',
    precision: 2,
    thresholdLines: [{ value: 1000, label: '1,000 limit' }],
    zeroBaseline: true,
    publicVisible: true,
  },
  {
    key: 'totalDissolvedSolids',
    label: 'Total Dissolved Solids',
    valueField: 'TDS',
    exceedanceField: 'TDS_Ex',
    countField: 'TDS_Sample Count',
    unit: 'mg/L',
    threshold: 'Exceedance when TDS > 200 mg/L',
    precision: 2,
    thresholdLines: [{ value: 200, label: '200 limit' }],
    zeroBaseline: true,
    publicVisible: false,
  },
  {
    key: 'waterTemperature',
    label: 'Water Temperature',
    valueField: 'Water Temperature',
    exceedanceField: 'Water Temp_Ex',
    countField: 'Water Temp Sample Count',
    unit: '°C',
    threshold: 'Exceedance when temperature exceeds the month + temperature-regime threshold',
    precision: 2,
    zeroBaseline: true,
    publicVisible: true,
  },
];

export const PARAMETER_BY_KEY: Record<ParameterKey, ParameterDef> = Object.fromEntries(
  PARAMETERS.map((p) => [p.key, p])
) as Record<ParameterKey, ParameterDef>;

/**
 * The parameters the dashboard actually shows. Everything user-facing - tables,
 * filters, charts, exports - reads from this, while PARAMETERS stays the
 * complete registry so the wire format and stored data are unaffected.
 */
export const VISIBLE_PARAMETERS = PARAMETERS.filter((p) => p.publicVisible);

/** Labels in the exact order the existing dashboard lists them. */
export const PARAMETER_LABELS = VISIBLE_PARAMETERS.map((p) => p.label);

/** Every key, including hidden ones. Wire format ordering depends on this. */
export const ALL_PARAMETER_KEYS = PARAMETERS.map((p) => p.key);

/** Keys safe to display. */
export const VISIBLE_PARAMETER_KEYS = VISIBLE_PARAMETERS.map((p) => p.key);
