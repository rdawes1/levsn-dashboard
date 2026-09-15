/**
 * Regression check: proves the dashboard reproduces the published LEVSN
 * Tableau figures, and that the canonical parameter labels have not drifted.
 *
 *   npm run verify          (dev server must be running on :4310)
 *   npm run verify -- --url https://levsn.example.org
 */
import { readFile } from 'node:fs/promises';
import { PARAMETERS, VISIBLE_PARAMETERS } from '../src/lib/parameters';
import { filterSamples, groupStats, EMPTY_FILTERS } from '../src/lib/stats';
import type { Snapshot } from '../src/lib/types';
import { decodeSnapshot, type WireSnapshot } from '../src/lib/wire';

/** Verify the local snapshot by default, or a deployed site with --url. */
const urlArg = process.argv.indexOf('--url');
const REMOTE = urlArg > -1 ? process.argv[urlArg + 1] : null;
const LOCAL_SNAPSHOT = 'public/data/snapshot.json';

/** Hidden from the public dashboard per LEVSN programme guidance. */
const HIDDEN_LABELS = ['Chloride', 'Total Dissolved Solids'];

/** Sourced from the published dashboard: Basin = Big Sister Creek, Year = 2025. */
const EXPECTED_BIG_SISTER_2025: Record<string, [number, number, number, number]> = {
  Chloride: [26.2, 24.95, 15.27, 39.73],
  Conductivity: [531.61, 506.3, 309.8, 806.3],
  'Conductivity Biocondition': [531.61, 506.3, 309.8, 806.3],
  'Conductivity TDS': [292.39, 278.47, 170.39, 443.47],
  'Dissolved Oxygen': [10.17, 10.16, 7.84, 12.34],
  pH: [7.96, 8.05, 7.48, 8.55],
  Salinity: [431.97, 408.04, 239.14, 676.92],
  'Total Dissolved Solids': [292.39, 278.47, 170.39, 443.47],
  'Water Temperature': [18.31, 21.15, 7.39, 25.27],
};

/** Headline figures shown beside the published dashboard. */
const EXPECTED_TOTALS = { samples: 5306, stationRecords: 225 };

/** Exceedance counts cross-checked against Airtable's own Basins rollups. */
const EXPECTED_EXCEEDANCES: { basin: string; year: number; label: string; count: number }[] = [
  { basin: 'Buffalo', year: 2025, label: 'Conductivity Biocondition', count: 21 },
  { basin: 'Buffalo', year: 2025, label: 'Salinity', count: 1 },
  { basin: 'Buffalo', year: 2025, label: 'Water Temperature', count: 0 },
  { basin: 'Buffalo', year: 2025, label: 'Dissolved Oxygen', count: 0 },
  { basin: 'Big Sister Creek', year: 2025, label: 'Conductivity Biocondition', count: 7 },
  { basin: 'Big Sister Creek', year: 2025, label: 'Salinity', count: 0 },
  { basin: 'Big Sister Creek', year: 2025, label: 'Water Temperature', count: 6 },
  { basin: 'Big Sister Creek', year: 2025, label: 'pH', count: 0 },
];

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function near(actual: number | null, expected: number, tol = 0.005): boolean {
  return actual !== null && Math.abs(actual - expected) <= tol;
}

async function loadWire(): Promise<WireSnapshot> {
  if (REMOTE) {
    const url = `${REMOTE.replace(/\/$/, '')}/data/snapshot.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return (await res.json()) as WireSnapshot;
  }
  return JSON.parse(await readFile(LOCAL_SNAPSHOT, 'utf8')) as WireSnapshot;
}

async function main() {
  console.log(`\nLEVSN verification against ${REMOTE ?? LOCAL_SNAPSHOT}\n`);

  const snap: Snapshot = decodeSnapshot(await loadWire());

  console.log('Totals');
  check(
    `samples = ${EXPECTED_TOTALS.samples}`,
    snap.samples.length === EXPECTED_TOTALS.samples,
    `got ${snap.samples.length}`
  );
  check(
    `station records = ${EXPECTED_TOTALS.stationRecords}`,
    snap.stations.length === EXPECTED_TOTALS.stationRecords,
    `got ${snap.stations.length}`
  );

  console.log('\nParameter registry (labels must match the published dashboard exactly)');
  const expectedLabels = Object.keys(EXPECTED_BIG_SISTER_2025);
  for (const label of expectedLabels) {
    check(label, PARAMETERS.some((p) => p.label === label), 'label missing or renamed');
  }
  check(
    `registry holds all ${expectedLabels.length} parameters`,
    PARAMETERS.length === expectedLabels.length,
    `got ${PARAMETERS.length}`
  );

  console.log('\nPublic visibility');
  for (const label of HIDDEN_LABELS) {
    check(
      `${label} hidden from public view`,
      !VISIBLE_PARAMETERS.some((p) => p.label === label),
      'still visible'
    );
  }
  check(
    `${expectedLabels.length - HIDDEN_LABELS.length} parameters shown publicly`,
    VISIBLE_PARAMETERS.length === expectedLabels.length - HIDDEN_LABELS.length,
    `got ${VISIBLE_PARAMETERS.length}`
  );
  check(
    'Conductivity TDS remains visible',
    VISIBLE_PARAMETERS.some((p) => p.label === 'Conductivity TDS'),
    'missing'
  );

  console.log('\nBig Sister Creek / 2025 summary statistics');
  const bs = filterSamples(snap.samples, {
    ...EMPTY_FILTERS,
    years: [2025],
    basins: ['Big Sister Creek'],
  });
  const [bsGroup] = groupStats(bs, (s) => s.basin, []);
  if (!bsGroup) {
    check('basin group present', false, 'no rows matched');
  } else {
    check(
      'summary table omits hidden parameters',
      !bsGroup.stats.some((s) => HIDDEN_LABELS.includes(s.label)),
      'a hidden parameter appeared in the table'
    );
    for (const stat of bsGroup.stats) {
      const exp = EXPECTED_BIG_SISTER_2025[stat.label];
      if (!exp) {
        check(stat.label, false, 'unexpected parameter label');
        continue;
      }
      const [mean, med, min, max] = exp;
      const ok =
        near(stat.mean, mean) && near(stat.median, med) && near(stat.min, min) && near(stat.max, max);
      check(
        `${stat.label}  mean/median/min/max`,
        ok,
        `expected ${exp.join(' / ')} | got ${[stat.mean, stat.median, stat.min, stat.max]
          .map((v) => (v === null ? 'null' : v.toFixed(2)))
          .join(' / ')}`
      );
    }
  }

  console.log('\nExceedance counts (cross-checked against Airtable rollups)');
  for (const e of EXPECTED_EXCEEDANCES) {
    const rows = filterSamples(snap.samples, {
      ...EMPTY_FILTERS,
      years: [e.year],
      basins: [e.basin],
    });
    const [g] = groupStats(rows, (s) => s.basin, []);
    const stat = g?.stats.find((s) => s.label === e.label);
    check(
      `${e.basin} ${e.year} ${e.label} = ${e.count}`,
      stat?.exceedanceCount === e.count,
      `got ${stat?.exceedanceCount ?? 'none'}`
    );
  }

  console.log(
    failures === 0
      ? '\nAll checks passed.\n'
      : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nVerification error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
