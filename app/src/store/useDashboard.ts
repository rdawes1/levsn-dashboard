'use client';

import { create } from 'zustand';
import { ALL_PARAMETER_KEYS, type ParameterKey } from '@/lib/parameters';
import { EMPTY_FILTERS, type Filters } from '@/lib/stats';
import type { Snapshot } from '@/lib/types';
import { decodeSnapshot, type WireSnapshot } from '@/lib/wire';

export type ViewId = 'locations' | 'basin' | 'station' | 'results' | 'reference';

export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'locations', label: 'LEVSN Monitoring Locations' },
  { id: 'basin', label: 'Summary Statistics and Exceedances by Basin' },
  { id: 'station', label: 'Summary Statistics and Exceedances by Station' },
  { id: 'results', label: 'Sampling Results by Basin, Station and Temp Regime' },
  { id: 'reference', label: 'Conductivity Results to OH EPA Ref. Survey' },
];

interface DashboardState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  view: ViewId;
  filters: Filters;
  /** Parameter charted in the results view (single-select, as in the original). */
  focusParameter: ParameterKey;
  /**
   * While true, grouped tables render every row rather than paging them in.
   * Used for printing and PNG capture, where "what you can see" has to mean
   * the whole table rather than the first screenful.
   */
  exportMode: boolean;

  load: (opts?: { bust?: boolean }) => Promise<void>;
  setView: (view: ViewId) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  toggleFilter: (key: keyof Filters, value: string | number) => void;
  setFocusParameter: (key: ParameterKey) => void;
  resetFilters: () => void;
  hydrateFromUrl: () => void;
  setExportMode: (on: boolean) => void;
}

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

export function buildQuery(view: ViewId, filters: Filters, focus: ParameterKey): string {
  const params = new URLSearchParams();
  params.set('view', view);
  params.set('focus', focus);
  for (const key of LIST_KEYS) {
    const value = filters[key] as (string | number)[];
    if (value.length) params.set(SHORT[key], value.join('~'));
  }
  return params.toString();
}

function pushUrl(view: ViewId, filters: Filters, focus: ParameterKey) {
  if (typeof window === 'undefined') return;
  const qs = buildQuery(view, filters, focus);
  window.history.replaceState(null, '', `${window.location.pathname}?${qs}`);
}

export const useDashboard = create<DashboardState>((set, get) => ({
  snapshot: null,
  loading: true,
  error: null,
  view: 'locations',
  filters: { ...EMPTY_FILTERS },
  focusParameter: 'chloride',
  exportMode: false,

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
    const { filters, focusParameter } = get();
    pushUrl(view, filters, focusParameter);
  },

  setFilter: (key, value) => {
    const filters = { ...get().filters, [key]: value };
    set({ filters });
    pushUrl(get().view, filters, get().focusParameter);
  },

  toggleFilter: (key, value) => {
    const current = get().filters[key] as (string | number)[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const filters = { ...get().filters, [key]: next } as Filters;
    set({ filters });
    pushUrl(get().view, filters, get().focusParameter);
  },

  setFocusParameter: (focusParameter) => {
    set({ focusParameter });
    pushUrl(get().view, get().filters, focusParameter);
  },

  resetFilters: () => {
    const filters = { ...EMPTY_FILTERS };
    set({ filters });
    pushUrl(get().view, filters, get().focusParameter);
  },

  setExportMode: (exportMode) => set({ exportMode }),

  hydrateFromUrl: () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);

    const view = params.get('view') as ViewId | null;
    const focus = params.get('focus') as ParameterKey | null;
    const filters: Filters = { ...EMPTY_FILTERS };

    for (const key of LIST_KEYS) {
      const raw = params.get(SHORT[key]);
      if (!raw) continue;
      const parts = raw.split('~').filter(Boolean);
      if (key === 'years') filters.years = parts.map(Number).filter((n) => !Number.isNaN(n));
      else if (key === 'parameters')
        filters.parameters = parts.filter((p): p is ParameterKey =>
          (ALL_PARAMETER_KEYS as string[]).includes(p)
        );
      else (filters[key] as string[]) = parts;
    }

    set({
      filters,
      view: VIEWS.some((v) => v.id === view) ? (view as ViewId) : 'locations',
      focusParameter:
        focus && (ALL_PARAMETER_KEYS as string[]).includes(focus) ? focus : 'chloride',
    });
  },
}));
