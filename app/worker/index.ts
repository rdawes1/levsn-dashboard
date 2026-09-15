/**
 * Cloudflare Worker fronting the static dashboard.
 *
 * Everything is served straight from static assets except one endpoint:
 * POST /api/refresh, which asks GitHub Actions to re-pull Airtable now rather
 * than waiting for the next scheduled run.
 *
 * This stays comfortably inside the Workers free plan. The 10ms CPU limit
 * applies to time spent executing, not to time awaiting a network call, and
 * this handler does almost nothing but await one fetch to GitHub.
 *
 * The GitHub token lives as a Worker secret and never reaches the browser.
 */

interface Env {
  /** Static assets binding - the built `out/` directory. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Fine-grained PAT with Actions: read and write on the dashboard repo. */
  GITHUB_TOKEN?: string;
  /** "owner/repo", e.g. "rdawes1/levsn-dashboard". */
  GITHUB_REPO?: string;
  /** Workflow filename to dispatch. */
  GITHUB_WORKFLOW?: string;
  /** Branch to run the workflow on. */
  GITHUB_REF?: string;
  /** Shared key the dashboard must present. Without it, refresh is disabled. */
  REFRESH_KEY?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Length-safe comparison so the key cannot be probed a character at a time. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Use POST to trigger a refresh.' }, 405);
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.REFRESH_KEY) {
    return json(
      {
        ok: false,
        error:
          'Refresh is not configured. Set GITHUB_TOKEN, GITHUB_REPO and REFRESH_KEY as Worker secrets.',
      },
      503
    );
  }

  const provided = request.headers.get('x-levsn-key') ?? '';
  if (!secretsMatch(provided, env.REFRESH_KEY)) {
    return json({ ok: false, error: 'Incorrect refresh key.' }, 401);
  }

  const workflow = env.GITHUB_WORKFLOW ?? 'refresh-and-deploy.yml';
  const ref = env.GITHUB_REF ?? 'main';

  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        // GitHub rejects API requests without a User-Agent.
        'user-agent': 'levsn-dashboard-worker',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    }
  );

  if (res.status === 204) {
    return json({
      ok: true,
      message:
        'Refresh started. Airtable is being re-read and the site redeploys in a couple of minutes.',
    });
  }

  const detail = await res.text().catch(() => '');
  return json(
    {
      ok: false,
      error: `GitHub returned ${res.status}.`,
      detail: detail.slice(0, 300),
    },
    502
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/refresh') {
      return handleRefresh(request, env);
    }

    // Lets the dashboard show or hide the admin control without exposing the key.
    if (url.pathname === '/api/refresh-available') {
      return json({
        available: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO && env.REFRESH_KEY),
      });
    }

    return env.ASSETS.fetch(request);
  },
};
