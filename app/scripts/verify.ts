/**
 * Regression check: proves the dashboard reproduces the published LEVSN
 * Tableau figures, and that the canonical parameter labels have not drifted.
 *
 *   npm run verify          (dev server must be running on :4310)
 *   npm run verify -- --url https://levsn.example.org
 */
import { readFile } from 'node:fs/promises';
import { PARAMETER_BY_KEY, PARAMETERS, VISIBLE_PARAMETERS } from '../src/lib/parameters';
import { filterSamples, groupStats, EMPTY_FILTERS } from '../src/lib/stats';
import type { Snapshot } from '../src/lib/types';
import { decodeSnapshot, type WireSnapshot } from '../src/lib/wire';

/** Verify the local snapshot by default, or a deployed site with --url. */
const urlArg = process.argv.indexOf('--url');
const REMOTE = urlArg > -1 ? process.argv[urlArg + 1] : null;
const LOCAL_SNAPSHOT = 'public/data/snapshot.json';

/**
 * Hidden from the public dashboard per LEVSN programme guidance. All three are
 * calculated rather than measured: Salinity and TDS are Airtable formulas on
 * conductivity, and Conductivity TDS is the same TDS field under a second
 * threshold. Salinity replaced Chloride here on 12 Nov 2026.
 */
const HIDDEN_LABELS = ['Salinity', 'Total Dissolved Solids', 'Conductivity TDS'];

/**
 * Shown deliberately, and asserted so a future change cannot drop one by
 * accident. Conductivity carries the 1,500 uS/cm water quality standard and
 * Conductivity Biocondition the 412 uS/cm biological condition benchmark; the
 * partner organisations report against 412, so both must stay on the
 * dashboard (restored 9 Nov 2026 after Summit SWCD flagged the discrepancy).
 */
const VISIBLE_LABELS = ['Conductivity', 'Conductivity Biocondition', 'Chloride'];

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

/**
 * Floors, not exact totals. The base is expected to grow - new stations, new
 * sample years - so pinning exact counts fails the pipeline on perfectly good
 * data. What a floor still catches is the failure that matters: a truncated or
 * broken Airtable pull that silently loses records.
 */
const MINIMUM_TOTALS = { samples: 7430, stationRecords: 225 };

/**
 * The two years to compare in the dropped-sites report below. Bump these when
 * the current run year rolls over.
 */
const DROPOUT_YEARS = { previous: 2025, current: 2026 };

/**
 * Ceiling on 2026 readings whose station carries no coordinate, and so cannot
 * be drawn on the map. See the map-coverage check below for why this is a
 * ceiling rather than a floor. Zero since 12 Nov 2026, when River Raisin sent
 * the last four missing coordinates - every 2026 reading is now on the map,
 * and this check exists to keep it that way.
 */
const MAX_UNMAPPED_2026 = 0;

/** Exceedance counts cross-checked against Airtable's own Basins rollups. */
const EXPECTED_EXCEEDANCES: { basin: string; year: number; label: string; count: number }[] = [

  { basin: 'Buffalo', year: 2025, label: 'Conductivity Biocondition', count: 21 },
  { basin: 'Buffalo', year: 2025, label: 'Chloride', count: 0 },
  { basin: 'Buffalo', year: 2025, label: 'Water Temperature', count: 0 },
  { basin: 'Buffalo', year: 2025, label: 'Dissolved Oxygen', count: 0 },

  { basin: 'Big Sister Creek', year: 2025, label: 'Conductivity Biocondition', count: 7 },
  { basin: 'Big Sister Creek', year: 2025, label: 'Chloride', count: 0 },
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

  console.log('Totals (floors - the base should only grow)');
  check(
    `samples >= ${MINIMUM_TOTALS.samples} (now ${snap.samples.length})`,
    snap.samples.length >= MINIMUM_TOTALS.samples,
    `got ${snap.samples.length} - records may have been lost in the pull`
  );
  check(
    `station records >= ${MINIMUM_TOTALS.stationRecords} (now ${snap.stations.length})`,
    snap.stations.length >= MINIMUM_TOTALS.stationRecords,
    `got ${snap.stations.length} - records may have been lost in the pull`
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
  for (const label of VISIBLE_LABELS) {
    check(
      `${label} remains visible`,
      VISIBLE_PARAMETERS.some((p) => p.label === label),
      'missing'
    );
  }
  check(
    'the two conductivity measures carry different thresholds',
    PARAMETER_BY_KEY.conductivity.threshold !== PARAMETER_BY_KEY.conductivityBiocondition.threshold &&
      PARAMETER_BY_KEY.conductivity.threshold.includes('1,500') &&
      PARAMETER_BY_KEY.conductivityBiocondition.threshold.includes('412'),
    'the thresholds shown to users no longer distinguish 1,500 from 412'
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

  // PB001 is monitored by two groups from 2026. Attribution comes from each
  // reading's own `Sample Organization`, so if that field or the fallback
  // order in airtable.ts is disturbed, every reading silently reverts to the
  // station owner and one group loses credit for its work.
  console.log('\nShared sites (per-reading organization)');
  const pb001 = snap.samples.filter((s) => s.stationId === 'PB001' && s.year === 2026);
  const byOrg = new Map<string, number>();
  for (const s of pb001) byOrg.set(s.organization ?? '(none)', (byOrg.get(s.organization ?? '(none)') ?? 0) + 1);
  check(
    'PB001 2026 is split between two organizations',
    byOrg.size === 2,
    `got ${byOrg.size}: ${[...byOrg].map(([o, n]) => `${o}=${n}`).join(', ')}`
  );
  check(
    'PB001 2026 Summit SWCD = 19 readings',
    byOrg.get('Summit Soil and Water Conservation District') === 19,
    `got ${byOrg.get('Summit Soil and Water Conservation District') ?? 0}`
  );
  check(
    'PB001 2026 Tinkers Creek = 7 readings',
    byOrg.get('Tinkers Creek Watershed Partners') === 7,
    `got ${byOrg.get('Tinkers Creek Watershed Partners') ?? 0}`
  );

  // A station with no lat/lon publishes everywhere EXCEPT the map, because
  // `stationRollups` skips it. Partners read that as "my sites are missing"
  // even though every reading is present, so the gap has to stay visible to
  // us rather than waiting for someone to notice. This is a CEILING, not a
  // floor. It is now zero, so any new import that lands a reading at a
  // station without a coordinate fails here rather than quietly dropping that
  // site off the map - which is how Summit, Cuyahoga Falls and River Raisin
  // each went unnoticed until a partner wrote in.
  console.log('\nMap coverage (stations with no coordinate are absent from the map)');
  const unmapped = snap.samples.filter((s) => s.year === 2026 && (s.lat === null || s.lon === null));
  const unmappedStations = new Set(unmapped.map((s) => s.stationId));
  check(
    `2026 readings with no coordinate <= ${MAX_UNMAPPED_2026} (now ${unmapped.length})`,
    unmapped.length <= MAX_UNMAPPED_2026,
    `got ${unmapped.length} at ${unmappedStations.size} stations: ${[...unmappedStations].sort().join(', ')}`
  );

  // A site that reported last year and has gone quiet this year is either a
  // group that stopped monitoring - which is fine and worth knowing - or data
  // that never arrived. Defiance SWCD's Pontiac Park was the second kind: it
  // published 12 readings in 2025, none in 2026, and the gap went unnoticed
  // for a season because nothing here looked for it. This reports rather than
  // fails, because legitimate drop-outs are common and an allow-list would
  // rot; the point is that the list is in front of us on every run.
  console.log(
    `\nSites that reported in ${DROPOUT_YEARS.previous} but not ${DROPOUT_YEARS.current} (report only, never fails)`
  );
  const yearsByStation = new Map<string, Set<number>>();
  const orgByStation = new Map<string, string>();
  for (const s of snap.samples) {
    if (!s.stationId || s.year === null) continue;
    let years = yearsByStation.get(s.stationId);
    if (!years) yearsByStation.set(s.stationId, (years = new Set()));
    years.add(s.year);
    if (s.organization) orgByStation.set(s.stationId, s.organization);
  }
  const dropped = [...yearsByStation]
    .filter(([, y]) => y.has(DROPOUT_YEARS.previous) && !y.has(DROPOUT_YEARS.current))
    .map(([id]) => id)
    .sort();
  if (dropped.length === 0) {
    console.log('  none');
  } else {
    const byOrg = new Map<string, string[]>();
    for (const id of dropped) {
      const org = orgByStation.get(id) ?? '(no organization)';
      byOrg.set(org, [...(byOrg.get(org) ?? []), id]);
    }
    for (const [org, ids] of [...byOrg].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${org} (${ids.length}): ${ids.join(', ')}`);
    }
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
