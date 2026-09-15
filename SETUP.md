# Finishing setup

GitHub is done. What remains needs your Cloudflare account, so it has to be run
by you — I shouldn't be creating credentials on your behalf.

Everything below is free tier.

## Already done

- Repo: https://github.com/rdawes1/levsn-dashboard (public)
- Actions secrets set: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `NEXT_PUBLIC_MAPBOX_TOKEN`
- Pipeline proven: the workflow pulls Airtable, passes all 25 verification
  checks, and builds. Only the deploy step fails, because Cloudflare isn't
  connected yet.

---

## 1. Connect Cloudflare and do the first deploy

```bash
cd "/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network/app"
npx wrangler login
```

That opens a browser and asks you to authorise Wrangler. Then:

```bash
npm run build && npx wrangler deploy
```

It prints your live URL, something like
`https://levsn-dashboard.<your-subdomain>.workers.dev`. Open it — that's the
public dashboard.

## 2. Let CI deploy for you

Two more Actions secrets are needed so the scheduled refresh can publish.

**Account ID:**

```bash
cd app && npx wrangler whoami
```

Copy the Account ID it prints.

**API token:** go to
https://dash.cloudflare.com/profile/api-tokens → *Create Token* → use the
**Edit Cloudflare Workers** template → Create. Copy the token; it's shown once.

Then set both:

```bash
cd "/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo rdawes1/levsn-dashboard
gh secret set CLOUDFLARE_API_TOKEN  --repo rdawes1/levsn-dashboard
```

Each prompts you to paste the value.

Confirm it works:

```bash
gh workflow run refresh-and-deploy.yml --repo rdawes1/levsn-dashboard
gh run watch --repo rdawes1/levsn-dashboard
```

From here the site refreshes every 30 minutes and redeploys only when the
Airtable data actually changed.

## 3. The "Refresh from Airtable" button

The dashboard can trigger a refresh on demand instead of waiting for the
schedule. It's deliberately not visible to the public: it appears only at
`?admin=1`, and the key is checked by the Worker, not the browser.

**Make a GitHub token for it.** Go to
https://github.com/settings/personal-access-tokens/new

- Repository access: **Only select repositories** → `rdawes1/levsn-dashboard`
- Permissions → Repository → **Actions: Read and write**
- Generate, and copy the token.

**Give it to the Worker**, along with a passphrase of your choosing:

```bash
cd app
npx wrangler secret put GITHUB_TOKEN   # paste the GitHub token
npx wrangler secret put GITHUB_REPO    # rdawes1/levsn-dashboard
npx wrangler secret put REFRESH_KEY    # any passphrase you'll remember
npx wrangler deploy
```

Now open `https://your-url/?admin=1`. A **Refresh from Airtable** button appears
under the data timestamp. The first click asks for the passphrase and remembers
it in that browser.

There's also always the plain GitHub route, which needs no setup at all: the
repo's **Actions** tab → *Refresh LEVSN snapshot and deploy* → **Run workflow**.

## 4. Two things worth doing once it's public

**Restrict the Mapbox token.** It's public by design, but right now it would
work on any site. At https://account.mapbox.com/access-tokens/ edit the token
and add a URL restriction for your Workers domain.

**Rotate the Airtable token.** The current one has been sitting in
`Token/::LEVSN Airtable Token` in plain text on disk, and it grants read *and
write* to the base. Create a fresh one at https://airtable.com/create/tokens
with **data.records:read** scope only, then:

```bash
gh secret set AIRTABLE_TOKEN --repo rdawes1/levsn-dashboard
```

and update `app/.env.local`. Read-only is all this project ever needs.

## 5. Embed it on the CWA site

In Webflow, replace the Tableau Public iframe with your Workers URL. The
`Content-Security-Policy` in `app/public/_headers` already permits
`clevelandwateralliance.org` and Webflow staging domains.

Worth considering a dedicated full-width page first — the current embed frame is
noticeably cramped for the map and tables.

---

## Handy commands

| Command | Does |
| --- | --- |
| `gh run watch --repo rdawes1/levsn-dashboard` | Follow the current CI run |
| `gh workflow run refresh-and-deploy.yml --repo rdawes1/levsn-dashboard` | Refresh data now |
| `cd app && npm run snapshot && npm run verify` | Pull and check data locally |
| `cd app && npm run dev` | Local dev server on :4310 |
| `cd app && npx wrangler tail` | Live logs from the deployed Worker |
