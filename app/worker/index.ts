/**
 * Cloudflare Worker fronting the static dashboard.
 *
 * Everything is served straight from static assets except:
 *
 *   POST /api/refresh   Pull the latest data from Airtable now. Starts the
 *                       GitHub Actions refresh job, which rebuilds the snapshot
 *                       and redeploys; the page picks up the new data itself.
 *   scheduled()         The same, every 30 minutes, on Cloudflare's clock.
 *
 * Why the pull isn't done here: a full Airtable read is ~58 requests (past the
 * free plan's 50-subrequest limit per invocation) and reshaping 5,306 samples
 * would blow the 10ms CPU limit. Starting the job is one or two small requests.
 *
 * The button is public, so a click never stacks jobs: if a refresh is already
 * running, or finished within the cooldown, the click joins it instead.
 *
 * The GitHub token lives as a Worker secret and never reaches the browser.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Fine-grained PAT, this repo only, Actions: read and write. */
  GITHUB_TOKEN?: string;
  /** "owner/repo". */
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_REF?: string;
}

/** A refresh that started this recently is joined rather than repeated. */
const COOLDOWN_MS = 3 * 60 * 1000;

type RefreshState = 'started' | 'running' | 'recent' | 'unavailable' | 'error';

interface WorkflowRun {
  status: string;
  created_at: string;
  run_started_at?: string;
  html_url: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function githubHeaders(env: Env): Record<string, string> {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    // GitHub rejects API requests without a User-Agent.
    'user-agent': 'levsn-dashboard-worker',
  };
}

async function latestRun(env: Env): Promise<WorkflowRun | null> {
  const workflow = env.GITHUB_WORKFLOW ?? 'refresh-and-deploy.yml';
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/runs?per_page=1`,
    { headers: githubHeaders(env) }
  );
  if (!res.ok) throw new Error(`GitHub runs lookup returned ${res.status}`);
  const body = (await res.json()) as { workflow_runs?: WorkflowRun[] };
  return body.workflow_runs?.[0] ?? null;
}

/**
 * Starts a refresh unless one is already underway or has just happened.
 * `reason` tells the workflow whether to redeploy unconditionally (a person
 * asked for fresh data) or only when the data actually changed (the timer).
 */
async function requestRefresh(
  env: Env,
  reason: 'manual' | 'schedule'
): Promise<{ state: RefreshState; message: string }> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { state: 'unavailable', message: 'Live refresh is not configured yet.' };
  }

  const last = await latestRun(env);
  if (last) {
    if (last.status === 'queued' || last.status === 'in_progress' || last.status === 'waiting') {
      return { state: 'running', message: 'A refresh is already in progress.' };
    }
    const started = Date.parse(last.run_started_at ?? last.created_at);
    if (Number.isFinite(started) && Date.now() - started < COOLDOWN_MS) {
      return { state: 'recent', message: 'Data was refreshed moments ago.' };
    }
  }

  const workflow = env.GITHUB_WORKFLOW ?? 'refresh-and-deploy.yml';
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: { ...githubHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ ref: env.GITHUB_REF ?? 'main', inputs: { reason } }),
    }
  );

  if (res.status === 204) {
    return { state: 'started', message: 'Pulling the latest data from Airtable.' };
  }
  const detail = await res.text().catch(() => '');
  return { state: 'error', message: `GitHub returned ${res.status}. ${detail.slice(0, 200)}` };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') {
        return json({ state: 'error', message: 'Use POST to request a refresh.' }, 405);
      }
      try {
        const result = await requestRefresh(env, 'manual');
        const status = result.state === 'error' ? 502 : result.state === 'unavailable' ? 503 : 200;
        return json(result, status);
      } catch (e) {
        return json(
          { state: 'error', message: e instanceof Error ? e.message : 'Refresh request failed.' },
          502
        );
      }
    }

    return env.ASSETS.fetch(request);
  },

  /** Cloudflare Cron Trigger - see [triggers] in wrangler.toml. */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(
      requestRefresh(env, 'schedule').catch((e) =>
        console.error('scheduled refresh failed', e instanceof Error ? e.message : e)
      )
    );
  },
};
