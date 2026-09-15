'use client';

import { useEffect, useState } from 'react';

/**
 * Admin control that asks GitHub Actions to re-pull Airtable immediately
 * instead of waiting for the next scheduled run.
 *
 * Hidden from ordinary visitors: it only appears with `?admin=1` in the URL,
 * AND only when the Worker reports that refresh is configured. The key is
 * checked server-side by the Worker, so hiding the button is convenience, not
 * the security boundary.
 */

const KEY_STORAGE = 'levsn.refreshKey';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

export function RefreshFromAirtable() {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('admin') !== '1') return;

    let cancelled = false;
    fetch('/api/refresh-available')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(d.available));
      })
      .catch(() => {
        /* running statically without the Worker - stay hidden */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  async function trigger() {
    let key = '';
    try {
      key = window.localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      /* storage blocked - prompt each time */
    }

    if (!key) {
      key = window.prompt('Refresh key') ?? '';
      if (!key) return;
    }

    setStatus({ kind: 'working' });

    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'x-levsn-key': key },
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string };

      if (res.ok && body.ok) {
        try {
          window.localStorage.setItem(KEY_STORAGE, key);
        } catch {
          /* fine */
        }
        setStatus({ kind: 'ok', message: body.message ?? 'Refresh started.' });
      } else {
        if (res.status === 401) {
          try {
            window.localStorage.removeItem(KEY_STORAGE);
          } catch {
            /* fine */
          }
        }
        setStatus({ kind: 'error', message: body.error ?? `Request failed (${res.status}).` });
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the refresh endpoint.' });
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => void trigger()}
        disabled={status.kind === 'working'}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-cwa-cyan/60
                   px-2 py-1.5 text-[11px] font-medium text-cwa-cyan transition-colors
                   hover:bg-cwa-cyan/10 disabled:opacity-50"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`h-3 w-3 ${status.kind === 'working' ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M8 3.5v9M4.5 8l3.5-4.5L11.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {status.kind === 'working' ? 'Starting…' : 'Refresh from Airtable'}
      </button>

      {status.kind === 'ok' && (
        <p className="mt-1.5 text-[10px] leading-snug text-cwa-cyan">{status.message}</p>
      )}
      {status.kind === 'error' && (
        <p className="mt-1.5 text-[10px] leading-snug text-red-300">{status.message}</p>
      )}
    </div>
  );
}
