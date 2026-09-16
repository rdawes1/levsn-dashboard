'use client';

import { create } from 'zustand';
import { VISIBLE_PARAMETER_KEYS, type ParameterKey } from '@/lib/parameters';
import { EMPTY_FILTERS, type Filters } from '@/lib/stats';
import type { Snapshot } from '@/lib/types';
import { decodeSnapshot, type WireSnapshot } from '@/lib/wire';

export type ViewId = 'locations' | 'basin' | 'station' | 'results' | 'reference';

/** `short` is used where the full sheet name will not fit - phone tabs. */
export const VIEWS: { id: ViewId; label: string; short: string }[] = [
  { id: 'locations', label: 'LEVSN Monitoring Locations', short: 'Map' },
  { id: 'basin', label: 'Summary Statistics and Exceedances by Basin', short: 'By Basin' },
  { id: 'station', label: 'Summary Statistics and Exceedances by Station', short: 'By Station' },
  { id: 'results', label: 'Sampling Results by Basin, Station and Temp Regime', short: 'Results' },
  { id: 'reference', label: 'Conductivity Results to OH EPA Ref. Survey', short: 'OH EPA' },
];

/**
 * Lifecycle of a "Refresh data" click.
 *   starting   - asking the Worker to start a refresh
 *   refreshing - a refresh job is running; watching for the new snapshot
 *   updated    - new data arrived and is on screen
 *   pending    - still running after the wait window; it will land shortly
 *   reloaded   - live refresh unavailable, so only re-read the published data
 *   error      - the request itself failed
 */
export type RefreshPhase =
  | 'idle'
  | 'starting'
  | 'refreshing'
  | 'updated'
  | 'pending'
  | 'reloaded'
  | 'error';

interface DashboardState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  view: ViewId;
  filters: Filters;
  /** Parameters charted in the results view, stacked on a shared timeline (1-3). */
  focusParameters: ParameterKey[];
  /**
   * "Compare multiple" checkbox. Off: clicking a parameter charts only that
   * parameter. On: parameters toggle, up to MAX_COMPARE at once.
   */
  multiParameter: boolean;
  /** Stations compared on the results chart (0-3). Empty = every filtered station. */
  compareStations: string[];
  /**
   * Date range the results chart is zoomed to, as epoch ms, or null for the
   * full range. Shared by every stacked panel and by the CSV export. Not put in
   * the URL: it is a momentary view, not a filter someone would share.
   */
  chartDateRange: [number, number] | null;
  /**
   * While true, grouped tables render every row rather than paging them in.
   * Used for printing and PNG capture, where "what you can see" has to mean
   * the whole table rather than the first screenful.
   */
  exportMode: boolean;
  refresh: { phase: RefreshPhase; message: string | null };

  load: (opts?: { bust?: boolean }) => Promise<void>;
  setView: (view: ViewId) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  toggleFilter: (key: keyof Filters, value: string | number) => void;
  /** Charts a parameter: replaces the selection, or toggles it when comparing multiple. */
  pickFocusParameter: (key: ParameterKey) => void;
  setMultiParameter: (on: boolean) => void;
  setCompareStations: (ids: string[]) => void;
  setChartDateRange: (range: [number, number] | null) => void;
  resetFilters: () => void;
  hydrateFromUrl: () => void;
  setExportMode: (on: boolean) => void;
  /** Pull the latest data from Airtable, then show it when it lands. */
  refreshFromAirtable: () => Promise<void>;
}

/** First publicly visible parameter, used as the default chart selection. */
const DEFAULT_FOCUS: ParameterKey = VISIBLE_PARAMETER_KEYS[0];

/** Most parameters, and most stations, the results chart compares at once. */
export const MAX_COMPARE = 3;

/** Where the prebuilt snapshot lives. Overridable for a CDN or preview build. */
const DATA_URL = process.env.NEXT_PUBLIC_DATA_URL ?? '/data/snapshot.json';

/* ---------------------------------------------------------------------------
 * URL synchronisation.
 * Filter state lives in the query string so any dashboard view is a shareable,
 * bookmarkable link - and so an exported PNG can be traced back to the exact
 * state that produced it.
 * ------------------------------------------------------------------------- */

const LIST_KEYS: (keyof Filters)[] = [
  'years',
  'basins',
  'stationIds',
  'organizations',
  'parameters',
  'tempRegimes',
  'ecoregions',
  'streamSizes',
];

const SHORT: Record<string, string> = {
  years: 'y',
  basins: 'b',
  stationIds: 's',
  organizations: 'o',
  parameters: 'p',
  tempRegimes: 'tr',
  ecoregions: 'er',
  streamSizes: 'ss',
};

interface UrlState {
  view: ViewId;
  filters: Filters;
  focusParameters: ParameterKey[];
  multiParameter: boolean;
  compareStations: string[];
}

export function buildQuery({
  view,
  filters,
  focusParameters,
  multiParameter,
  compareStations,
}: UrlState): string {
  const params = new URLSearchParams();
  params.set('view', view);
  params.set('focus', focusParameters.join('~'));
  if (multiParameter) params.set('multi', '1');
  if (compareStations.length) params.set('cmp', compareStations.join('~'));
  for (const key of LIST_KEYS) {
    const value = filters[key] as (string | number)[];
    if (value.length) params.set(SHORT[key], value.join('~'));
  }
  return params.toString();
}

function pushUrl(state: UrlState) {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', `${window.location.pathname}?${buildQuery(state)}`);
}

export const useDashboard = create<DashboardState>((set, get) => ({
  snapshot: null,
  loading: true,
  error: null,
  view: 'locations',
  filters: { ...EMPTY_FILTERS },
  focusParameters: [DEFAULT_FOCUS],
  multiParameter: false,
  compareStations: [],
  chartDateRange: null,
  exportMode: false,
  refresh: { phase: 'idle', message: null },

  load: async (opts) => {
    set({ loading: true, error: null });
    try {
      // A static edge asset: no Airtable round-trip, no cold start, no server.
      // `cache: 'no-cache'` still revalidates, so a refreshed snapshot is picked
      // up without a hard reload.
      const res = await fetch(`${DATA_URL}${opts?.bust ? `?t=${Date.now()}` : ''}`, {
        cache: opts?.bust ? 'reload' : 'no-cache',
      });
      if (!res.ok) throw new Error(`Could not load the data snapshot (${res.status}).`);
      const snapshot = decodeSnapshot((await res.json()) as WireSnapshot);
      set({ snapshot, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load LEVSN data.',
      });
    }
  },

  setView: (view) => {
    set({ view });
    pushUrl(get());
  },

  setFilter: (key, value) => {
    const filters = { ...get().filters, [key]: value };
    set({ filters });
    pushUrl(get());
  },

  toggleFilter: (key, value) => {
    const current = get().filters[key] as (string | number)[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const filters = { ...get().filters, [key]: next } as Filters;
    set({ filters });
    pushUrl(get());
  },

  pickFocusParameter: (key) => {
    const current = get().focusParameters;
    let next: ParameterKey[];

    if (!get().multiParameter) {
      next = [key];
    } else if (current.includes(key)) {
      if (current.length === 1) return; // always chart at least one
      next = current.filter((k) => k !== key);
    } else {
      if (current.length >= MAX_COMPARE) return;
      // Keep registry order so panels don't reshuffle as parameters are added.
      next = VISIBLE_PARAMETER_KEYS.filter((k) => k === key || current.includes(k));
    }

    set({ focusParameters: next });
    pushUrl(get());
  },

  setMultiParameter: (on) => {
    // Leaving compare mode keeps the first charted parameter.
    set(
      on
        ? { multiParameter: true }
        : { multiParameter: false, focusParameters: get().focusParameters.slice(0, 1) }
    );
    pushUrl(get());
  },

  setChartDateRange: (chartDateRange) => set({ chartDateRange }),

  setCompareStations: (ids) => {
    set({ compareStations: [...new Set(ids)].slice(0, MAX_COMPARE) });
    pushUrl(get());
  },

  resetFilters: () => {
    const filters = { ...EMPTY_FILTERS };
    set({ filters });
    pushUrl(get());
  },

  setExportMode: (exportMode) => set({ exportMode }),

  refreshFromAirtable: async () => {
    const phase = get().refresh.phase;
    if (phase === 'starting' || phase === 'refreshing') return;

    set({ refresh: { phase: 'starting', message: 'Contacting Airtable\u2026' } });

    let state: string;
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      // No Worker (e.g. local static preview) - treat as unavailable.
      const body = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as { state?: string; message?: string })
        : { state: 'unavailable' };
      state = body.state ?? 'error';
      if (state === 'error') {
        set({ refresh: { phase: 'error', message: 'Could not start a refresh. Try again shortly.' } });
        return;
      }
    } catch {
      state = 'unavailable';
    }

    if (state === 'unavailable') {
      await get().load({ bust: true });
      set({
        refresh: {
          phase: 'reloaded',
          message: 'Live refresh isn\u2019t set up yet \u2014 showing the latest published data.',
        },
      });
      return;
    }

    if (state === 'recent') {
      await get().load({ bust: true });
      set({ refresh: { phase: 'updated', message: 'Already up to date.' } });
      return;
    }

    // 'started' or 'running': watch for the redeployed snapshot.
    set({
      refresh: { phase: 'refreshing', message: 'Pulling the latest data from Airtable \u2014 usually 1\u20132 minutes.' },
    });

    const before = get().snapshot?.fetchedAt ?? null;
    const url = DATA_URL;
    const deadline = Date.now() + 5 * 60 * 1000;
    let etag: string | null = null;

    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      etag = head.headers.get('etag');
    } catch {
      /* fall back to comparing fetchedAt */
    }

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));

      let changed = false;
      try {
        // A HEAD request is a few hundred bytes; only fetch the full snapshot
        // once it has actually changed.
        const head = await fetch(`${url}?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
        const next = head.headers.get('etag');
        changed = etag !== null && next !== null ? next !== etag : true;
      } catch {
        continue;
      }
      if (!changed) continue;

      await get().load({ bust: true });
      const after = get().snapshot?.fetchedAt ?? null;
      if (after && after !== before) {
        set({ refresh: { phase: 'updated', message: 'Updated with the latest Airtable data.' } });
        return;
      }
    }

    set({
      refresh: {
        phase: 'pending',
        message: 'Still refreshing \u2014 the new data will appear on your next visit.',
      },
    });
  },

  hydrateFromUrl: () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);

    const view = params.get('view') as ViewId | null;
    const focus = (params.get('focus') ?? '')
      .split('~')
      .filter((k): k is ParameterKey => (VISIBLE_PARAMETER_KEYS as string[]).includes(k));
    const cmp = (params.get('cmp') ?? '').split('~').filter(Boolean);
    const filters: Filters = { ...EMPTY_FILTERS };

    for (const key of LIST_KEYS) {
      const raw = params.get(SHORT[key]);
      if (!raw) continue;
      const parts = raw.split('~').filter(Boolean);
      if (key === 'years') filters.years = parts.map(Number).filter((n) => !Number.isNaN(n));
      else if (key === 'parameters')
        filters.parameters = parts.filter((p): p is ParameterKey =>
          (VISIBLE_PARAMETER_KEYS as string[]).includes(p)
        );
      else (filters[key] as string[]) = parts;
    }

    // A shared link with several parameters opens in compare mode.
    const multi = params.get('multi') === '1' || focus.length > 1;

    set({
      filters,
      multiParameter: multi,
      view: VIEWS.some((v) => v.id === view) ? (view as ViewId) : 'locations',
      focusParameters: focus.length
        ? VISIBLE_PARAMETER_KEYS.filter((k) => focus.includes(k)).slice(0, multi ? MAX_COMPARE : 1)
        : [DEFAULT_FOCUS],
      compareStations: [...new Set(cmp)].slice(0, MAX_COMPARE),
    });
  },
}));
