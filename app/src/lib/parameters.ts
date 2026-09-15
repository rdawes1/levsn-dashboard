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
  },
];

export const PARAMETER_BY_KEY: Record<ParameterKey, ParameterDef> = Object.fromEntries(
  PARAMETERS.map((p) => [p.key, p])
) as Record<ParameterKey, ParameterDef>;

/** Labels in the exact order the existing dashboard lists them. */
export const PARAMETER_LABELS = PARAMETERS.map((p) => p.label);

export const ALL_PARAMETER_KEYS = PARAMETERS.map((p) => p.key);
