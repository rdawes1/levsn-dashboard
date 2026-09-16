'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExportMenu } from '@/components/ExportMenu';
import { FilterRail } from '@/components/FilterRail';
import { KpiRail } from '@/components/KpiRail';

import { BasinView } from '@/components/views/BasinView';
import { ReferenceView } from '@/components/views/ReferenceView';
import { ResultsView } from '@/components/views/ResultsView';
import { StationView } from '@/components/views/StationView';
import { buildCsv, describeFilters } from '@/lib/exports';
import { fmtInt, fmtTimestamp } from '@/lib/format';
import { VISIBLE_PARAMETER_KEYS } from '@/lib/parameters';
import { filterSamples } from '@/lib/stats';
import { useDashboard, VIEWS } from '@/store/useDashboard';

// Leaflet touches `window` at import time, so the map is client-only.
const MapView = dynamic(() => import('@/components/views/MapView').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-cwa-slate">
      Loading map&hellip;
    </div>
  ),
});

export default function DashboardPage() {
  const {
    snapshot,
    loading,
    error,
    view,
    filters,
    focusParameter,
    load,
    setView,
    setFocusParameter,
    hydrateFromUrl,
  } = useDashboard();

  const panelRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Close the filter drawer on Escape.
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtersOpen]);

  useEffect(() => {
    hydrateFromUrl();
    void load();
  }, [hydrateFromUrl, load]);

  const samples = useMemo(
    () => (snapshot ? filterSamples(snapshot.samples, filters) : []),
    [snapshot, filters]
  );

  // KPI rail reflects the current filter state, not the whole base.
  //
  // "Sites Monitored" counts the station REGISTRY (not stations that happen to
  // have samples) so that, unfiltered, it reports 225 - the same headline figure
  // as the published dashboard. A year filter additionally narrows it to
  // stations actually sampled in those years.
  const kpis = useMemo(() => {
    if (!snapshot) {
      return { sites: 0, samples: 0, basins: 0, exceedancePct: null as number | null };
    }

    const sampledStationIds = new Set(samples.map((s) => s.stationId).filter(Boolean));

    const registry = snapshot.stations.filter(
      (st) =>
        (!filters.basins.length || (st.basin && filters.basins.includes(st.basin))) &&
        (!filters.stationIds.length ||
          (st.stationId && filters.stationIds.includes(st.stationId))) &&
        (!filters.organizations.length ||
          (st.organization && filters.organizations.includes(st.organization))) &&
        (!filters.tempRegimes.length ||
          (st.tempRegime && filters.tempRegimes.includes(st.tempRegime))) &&
        (!filters.ecoregions.length ||
          (st.ecoregion && filters.ecoregions.includes(st.ecoregion))) &&
        (!filters.streamSizes.length ||
          (st.streamSize && filters.streamSizes.includes(st.streamSize))) &&
        // Only stations sampled in the selected years count once a year is chosen.
        (!filters.years.length || (st.stationId && sampledStationIds.has(st.stationId)))
    );

    const stationIds = new Set(registry.map((st) => st.stationId).filter(Boolean));
    const basins = new Set(registry.map((st) => st.basin).filter(Boolean));

    const active = filters.parameters.length ? filters.parameters : VISIBLE_PARAMETER_KEYS;

    let evaluated = 0;
    let exceeded = 0;
    for (const s of samples) {
      for (const k of active) {
        const e = s.exceedances[k];
        if (typeof e === 'number') {
          evaluated += 1;
          exceeded += e;
        }
      }
    }

    return {
      sites: stationIds.size,
      samples: samples.length,
      basins: basins.size,
      exceedancePct: evaluated ? (exceeded / evaluated) * 100 : null,
    };
  }, [snapshot, samples, filters]);

  const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? '';

  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((n, v) => n + (v as unknown[]).length, 0),
    [filters]
  );

  const filenameStem = useMemo(() => {
    const parts = ['levsn', view];
    if (filters.years.length) parts.push(filters.years.join('-'));
    if (filters.basins.length === 1) {
      parts.push(filters.basins[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    }
    return parts.join('-');
  }, [view, filters.years, filters.basins]);

  /** Each tab exports the table it is showing, over the current filters. */
  function getCsv() {
    if (!snapshot) return null;
    return buildCsv(view, samples, filters, focusParameter);
  }

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-cwa-deep">
      {/* Paper header: only rendered when printing. */}
      <div className="print-only mb-4 border-b-2 border-cwa-deep pb-2">
        <h1 className="text-[16px] font-bold uppercase tracking-wide text-cwa-deep">
          Lake Erie Volunteer Science Network
        </h1>
        <p className="mt-0.5 text-[12px] font-semibold text-cwa-ink">{viewLabel}</p>
        <p className="mt-1 text-[10px] text-cwa-slate">{describeFilters(filters)}</p>
        <p className="text-[10px] text-cwa-slate">
          {fmtInt(kpis.samples)} samples &middot; {fmtInt(kpis.sites)} stations
          {snapshot ? ` \u00B7 Airtable data as of ${fmtTimestamp(snapshot.fetchedAt)}` : ''}
        </p>
      </div>

      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 px-3 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-5 print-hide">
        <h1 className="text-[14px] font-bold uppercase tracking-wide text-white sm:text-[19px]">
          Lake Erie Volunteer Science Network
        </h1>
        <span className="text-[11px] text-cwa-cyan sm:text-[13px]">Water Quality Dashboard</span>
      </header>

      {/* Compact KPI band, below the desktop breakpoint only. */}
      <div className="lg:hidden">
        <KpiRail
          layout="strip"
          sitesMonitored={kpis.sites}
          samplesCollected={kpis.samples}
          basinsCovered={kpis.basins}
          exceedancePct={kpis.exceedancePct}
          fetchedAt={snapshot?.fetchedAt ?? null}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-0 px-0 pb-0 sm:px-3 lg:px-6 lg:pb-2">
        {/* Main panel */}
        <div className="print-surface flex min-w-0 flex-1 flex-col overflow-hidden bg-white sm:rounded-l-panel">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-cwa-mist px-3 py-2 sm:px-5 sm:py-3 print-hide">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-cwa-deep sm:text-[16px]">
                {viewLabel}
              </h2>
              <p className="truncate text-[11px] text-cwa-slate sm:text-[12px]">
                {fmtInt(kpis.samples)} samples &middot; {fmtInt(kpis.sites)} stations
                {filters.basins.length === 1 ? ` · ${filters.basins[0].trim()}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Filters live in a drawer below the desktop breakpoint. */}
              <button
                onClick={() => setFiltersOpen(true)}
                className="flex items-center gap-1.5 rounded border border-cwa-silver px-2.5 py-1.5
                           text-[12px] font-medium text-cwa-slate transition-colors
                           hover:border-cwa-cyan hover:text-cwa-deep lg:hidden"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4h12M4.5 8h7M6.5 12h3" strokeLinecap="round" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-cwa-deep px-1.5 text-[10px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <ExportMenu targetRef={panelRef} filename={filenameStem} getCsv={getCsv} />
            </div>
          </div>

          <div ref={panelRef} className="print-flow min-h-0 flex-1 overflow-hidden bg-white">
            {loading && (
              <div className="flex h-full items-center justify-center text-[13px] text-cwa-slate">
                Loading LEVSN data from Airtable&hellip;
              </div>
            )}

            {error && !loading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="text-[14px] font-medium text-status-alert">
                  Could not load LEVSN data
                </p>
                <p className="max-w-md text-[12px] text-cwa-slate">{error}</p>
                <button
                  onClick={() => void load()}
                  className="rounded border border-cwa-silver px-3 py-1.5 text-[12px] text-cwa-deep hover:border-cwa-cyan"
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && snapshot && (
              <>
                {view === 'locations' && <MapView samples={samples} filters={filters} />}
                {view === 'basin' && <BasinView samples={samples} filters={filters} />}
                {view === 'station' && <StationView samples={samples} filters={filters} />}
                {view === 'results' && (
                  <ResultsView
                    samples={samples}
                    focusParameter={focusParameter}
                    onFocusChange={setFocusParameter}
                  />
                )}
                {view === 'reference' && <ReferenceView samples={samples} />}
              </>
            )}
          </div>
        </div>

        <FilterRail />

        <KpiRail
          sitesMonitored={kpis.sites}
          samplesCollected={kpis.samples}
          basinsCovered={kpis.basins}
          exceedancePct={kpis.exceedancePct}
          fetchedAt={snapshot?.fetchedAt ?? null}
        />
      </div>

      {/* View tabs, mirroring the sheet tabs in the existing dashboard */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto px-3 pb-2 pt-1 sm:px-6 sm:pb-4 scroll-thin print-hide">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            title={v.label}
            className={`shrink-0 rounded-b border-t-2 px-2.5 py-2 text-[12px] transition-colors sm:px-3.5 ${
              v.id === view
                ? 'border-cwa-cyan bg-white/10 font-medium text-white'
                : 'border-transparent text-white/65 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className="lg:hidden">{v.short}</span>
            <span className="hidden lg:inline">{v.label}</span>
          </button>
        ))}
      </nav>

      {/* Filter drawer, below the desktop breakpoint. */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden print-hide">
          <div
            className="absolute inset-0 bg-cwa-navy/60"
            onClick={() => setFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="relative h-full w-[86%] max-w-[320px] shadow-panel">
            <FilterRail variant="drawer" onClose={() => setFiltersOpen(false)} />
          </div>
        </div>
      )}
    </main>
  );
}
