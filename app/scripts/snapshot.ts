/**
 * Builds the static data snapshot the dashboard reads.
 *
 *   npm run snapshot
 *
 * This is the ONLY place that talks to Airtable. Running it outside the request
 * path means:
 *   - no visitor ever waits on Airtable's ~55 paged requests;
 *   - the Airtable token never has to exist on the hosting platform;
 *   - the site is fully static, so it hosts free on Cloudflare.
 *
 * Refresh cadence is set by the GitHub Action in .github/workflows/snapshot.yml.
 */
import { config as loadEnv } from 'dotenv';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadSnapshot } from '../src/lib/airtable';
import { encodeSnapshot } from '../src/lib/wire';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'snapshot.json');

function kb(n: number) {
  return `${(n / 1024).toFixed(0)} KB`;
}

async function main() {
  const started = Date.now();
  console.log('Fetching LEVSN data from Airtable...');

  const snapshot = await loadSnapshot();
  const wire = encodeSnapshot(snapshot);
  const json = JSON.stringify(wire);

  await mkdir(OUT_DIR, { recursive: true });

  // Data is compared ignoring fetchedAt, so an unchanged base produces no commit.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ ...wire, fetchedAt: '' }))
    .digest('hex');

  let previous = '';
  try {
    const existing = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    previous = createHash('sha256')
      .update(JSON.stringify({ ...existing, fetchedAt: '' }))
      .digest('hex');
  } catch {
    /* first run */
  }

  await writeFile(OUT_FILE, json);

  const changed = fingerprint !== previous;
  console.log(
    [
      `  stations      ${snapshot.counts.stations}`,
      `  samples       ${snapshot.counts.samples}`,
      `  basins        ${snapshot.counts.basins}`,
      `  years         ${snapshot.years.join(', ')}`,
      `  payload       ${kb(Buffer.byteLength(json))}`,
      `  elapsed       ${((Date.now() - started) / 1000).toFixed(1)}s`,
      `  data changed  ${changed ? 'yes' : 'no'}`,
    ].join('\n')
  );

  // Consumed by CI to decide whether to deploy.
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
  }
}

main().catch((e) => {
  console.error('\nSnapshot failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
