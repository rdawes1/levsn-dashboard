# LEVSN Water Quality Dashboard

A live, brand-aligned rebuild of the Lake Erie Volunteer Science Network monitoring
dashboard, reading from the LEVSN Airtable base (`appVBC2SUwFcom2p5`).

The site is **fully static**. Airtable is read on a schedule by CI, not on every
page view, which is what makes it load instantly and host for free.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the tokens
npm run snapshot             # pull data from Airtable -> public/data/snapshot.json
npm run dev                  # http://localhost:4310
```

| Variable | Where it lives | Purpose |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | Your shell / CI secret only | Read token. Never reaches the browser or the host. |
| `AIRTABLE_BASE_ID` | Same | Defaults to `appVBC2SUwFcom2p5`. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Build env | Mapbox **public** (`pk.*`) token. Restrict it by URL in the Mapbox account. |
| `NEXT_PUBLIC_DATA_URL` | Optional | Override where the snapshot is fetched from. |

## Commands

| Command | Does |
| --- | --- |
| `npm run snapshot` | Pull Airtable into `public/data/snapshot.json`. The only thing that touches Airtable. |
| `npm run dev` | Dev server on :4310. |
| `npm run build` | Static export into `out/`. |
| `npm run preview` | Serve the built `out/` on :4311. |
| `npm run verify` | Check the data against the published Tableau figures. |

## Verifying correctness

```bash
npm run verify                              # checks public/data/snapshot.json
npm run verify -- --url https://your.site   # checks a deployed site
```

Asserts that totals still match (5,306 samples / 225 station records), that the
nine parameter labels have not drifted, that Big Sister Creek / 2025 reproduces
mean, median, min and max exactly, and that exceedance counts agree with
Airtable's own rollups. CI runs this before every deploy.

## How the data flows

```
Airtable ──► scripts/snapshot.ts ──► public/data/snapshot.json  (CI, every 30 min)
                                            │
                                            ▼
                              static site on Cloudflare
                                            │
     store/useDashboard ◄── lib/wire.ts ◄───┘   decode
              │
              ▼
        lib/stats.ts ──► views
```

Every figure is derived from raw `LEVSN Samples` rows. The Airtable `Stations`
and `Basins` tables carry ~265 hand-maintained `"<Parameter> <Stat> <Year>"`
rollup fields; none are used, so a new sample year needs no schema work.

**Why the snapshot is prebuilt.** Cloudflare Workers' free plan allows 10 ms of
CPU per invocation — including Cron Triggers — which is nowhere near enough to
parse and reshape 5,306 samples. Doing it in CI keeps the site static and free,
and means no visitor ever waits on Airtable's ~55 paged requests. Data is live
to within the refresh interval, set in
`.github/workflows/refresh-and-deploy.yml`.

## Deploying to Cloudflare (free)

One-time setup:

1. `npx wrangler login` — authorises your Cloudflare account.
2. `npm run build && npx wrangler deploy` — publishes to
   `levsn-dashboard.<your-subdomain>.workers.dev`.
3. Add a custom domain in the Cloudflare dashboard if you want one.

For the scheduled refresh, add these repository secrets in GitHub:

- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`
- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `CLOUDFLARE_API_TOKEN` (needs the *Edit Cloudflare Workers* template)
- `CLOUDFLARE_ACCOUNT_ID`

The workflow then refreshes every 30 minutes, verifies the data, and deploys
only when the data actually changed — so scheduled runs rarely consume a build.

Everything used here is free tier: Workers Static Assets (unlimited requests for
static assets), and GitHub Actions.

## Parameter naming

`src/lib/parameters.ts` is the single source of truth. Its labels are
byte-for-byte identical to the published dashboard and flow into every table
header, filter, axis, legend and CSV column. Change them there only, then
re-run `npm run verify`.

## State, sharing and export

Filter state lives in the query string, so every view is a shareable link:

```
/?view=basin&y=2025&b=Big%20Sister%20Creek
```

Export offers **PNG** (the panel as shown, including the basemap), **CSV** (the
filtered rows, with canonical labels as headers) and **Copy shareable link**.

## Performance notes

Three things that matter if you edit the rendering code:

- **Scroll containers must be bounded** (`h-full min-h-0`). An unbounded one
  grows to content height and the parent clips it, so no scrollbar appears.
- **Grouped tables render in pages** (`GroupedStatsList`). All 224 stations at
  once is 1,935 rows and about half a second of layout.
- **The scatter is canvas, not SVG** (`ScatterPlot`). 5,300 SVG nodes blocked
  the main thread for ~870 ms per tab switch; canvas draws it in ~0 ms.

## Known data issues

See the implementation plan: https://claude.ai/artifact/WoqW2fUPv2zL4b1P5qyRX8

1. `station_id` "LL" is duplicated across two records ("Lower Lake", ~65 m
   apart) — station-level stats merge them, and distinct sites read 224 vs the
   225 records Tableau counts.
2. `Water Temp_Ex` is a manually entered number, not a formula; 57 of 5,306
   samples disagree with the Temperature Regimes thresholds.
3. Ohio EPA Reference/Survey percentiles are not in the base, so that view shows
   Results rows only.
4. 8 of 225 stations have no latitude/longitude and cannot be mapped.
5. Basin name `"Cuyahoga "` has a trailing space.
