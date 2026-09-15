'use client';

import { useMemo } from 'react';
import { PARAMETERS } from '@/lib/parameters';
import { availableFacets, type Facets, type Filters } from '@/lib/stats';
import { useDashboard } from '@/store/useDashboard';

interface GroupProps {
  title: string;
  filterKey: keyof Filters;
  options: (string | number)[];
  selected: (string | number)[];
  /** Values that still return data given every other active filter. */
  available?: Set<string | number>;
  /** Cap the visible height for long lists (basins, stations). */
  scroll?: boolean;
  labels?: Record<string, string>;
}

function FilterGroup({
  title,
  filterKey,
  options,
  selected,
  available,
  scroll,
  labels,
}: GroupProps) {
  const toggleFilter = useDashboard((s) => s.toggleFilter);
  const setFilter = useDashboard((s) => s.setFilter);
  const allSelected = selected.length === 0;

  // An option that returns nothing is disabled rather than hidden, so the list
  // does not jump around as filters change. Selected values always stay
  // enabled, otherwise you could not untick your way back out.
  const rows = options.map((opt) => ({
    opt,
    checked: selected.includes(opt),
    enabled: !available || available.has(opt) || selected.includes(opt),
  }));

  const hiddenCount = rows.filter((r) => !r.enabled).length;

  return (
    <section className="mb-5">
      <h3 className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.09em] text-cwa-cyan">
        {title}
        {hiddenCount > 0 && (
          <span
            className="text-[9px] font-normal normal-case tracking-normal text-white/40"
            title={`${hiddenCount} option${hiddenCount === 1 ? '' : 's'} would return no data with the current filters`}
          >
            {hiddenCount} unavailable
          </span>
        )}
      </h3>

      <div className={`${scroll ? 'max-h-44 overflow-y-auto pr-1 scroll-thin' : ''} text-white/90`}>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setFilter(filterKey, [] as never)}
            className="h-3.5 w-3.5 shrink-0 accent-cwa-cyan"
          />
          <span className={allSelected ? 'font-medium text-white' : ''}>(All)</span>
        </label>

        {rows.map(({ opt, checked, enabled }) => (
          <label
            key={String(opt)}
            className={`filter-check ${enabled ? '' : 'cursor-not-allowed opacity-35'}`}
            title={
              enabled
                ? String(opt)
                : `${opt} — no data with the current filters`
            }
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!enabled}
              onChange={() => toggleFilter(filterKey, opt)}
              className="h-3.5 w-3.5 shrink-0 accent-cwa-cyan disabled:cursor-not-allowed"
            />
            <span className={`truncate ${checked ? 'font-medium text-white' : ''}`}>
              {labels?.[String(opt)] ?? String(opt)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function FilterRail() {
  const snapshot = useDashboard((s) => s.snapshot);
  const filters = useDashboard((s) => s.filters);
  const resetFilters = useDashboard((s) => s.resetFilters);
  const view = useDashboard((s) => s.view);

  // For each dimension, which values still return data given the others.
  const facets: Facets | null = useMemo(
    () => (snapshot ? availableFacets(snapshot.samples, filters) : null),
    [snapshot, filters]
  );

  const stationOptions = useMemo(() => {
    if (!snapshot) return [];
    return [
      ...new Set(snapshot.stations.map((s) => s.stationId).filter((s): s is string => Boolean(s))),
    ].sort();
  }, [snapshot]);

  const stationLabels = useMemo(() => {
    if (!snapshot) return {};
    return Object.fromEntries(
      snapshot.stations
        .filter((s) => s.stationId)
        .map((s) => [
          s.stationId as string,
          s.stationName ? `${s.stationId} · ${s.stationName}` : (s.stationId as string),
        ])
    );
  }, [snapshot]);

  if (!snapshot || !facets) return null;

  const activeCount = Object.values(filters).reduce((n, v) => n + (v as unknown[]).length, 0);

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-l border-white/10 bg-cwa-deeper print-hide">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-[13px] font-semibold text-white">Filters</h2>
        {activeCount > 0 && (
          <button
            onClick={resetFilters}
            className="rounded border border-white/25 px-2 py-0.5 text-[11px] text-white/80
                       transition-colors hover:border-cwa-cyan hover:text-cwa-cyan"
          >
            Clear {activeCount}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        <FilterGroup
          title="Sample Run Year"
          filterKey="years"
          options={snapshot.years}
          selected={filters.years}
          available={facets.years as Set<string | number>}
        />
        <FilterGroup
          title="Basin"
          filterKey="basins"
          options={snapshot.basins}
          selected={filters.basins}
          available={facets.basins as Set<string | number>}
          scroll
        />
        {view !== 'locations' && (
          <FilterGroup
            title="Station Id"
            filterKey="stationIds"
            options={stationOptions}
            selected={filters.stationIds}
            available={facets.stationIds as Set<string | number>}
            labels={stationLabels}
            scroll
          />
        )}
        <FilterGroup
          title="Parameter"
          filterKey="parameters"
          options={PARAMETERS.map((p) => p.key)}
          selected={filters.parameters}
          labels={Object.fromEntries(PARAMETERS.map((p) => [p.key, p.label]))}
        />
        <FilterGroup
          title="Temp Regime"
          filterKey="tempRegimes"
          options={snapshot.tempRegimes}
          selected={filters.tempRegimes}
          available={facets.tempRegimes as Set<string | number>}
        />
        <FilterGroup
          title="Organization"
          filterKey="organizations"
          options={snapshot.organizations}
          selected={filters.organizations}
          available={facets.organizations as Set<string | number>}
          scroll
        />
        <FilterGroup
          title="Ecoregion"
          filterKey="ecoregions"
          options={snapshot.ecoregions}
          selected={filters.ecoregions}
          available={facets.ecoregions as Set<string | number>}
        />
        <FilterGroup
          title="Stream Size"
          filterKey="streamSizes"
          options={snapshot.streamSizes}
          selected={filters.streamSizes}
          available={facets.streamSizes as Set<string | number>}
        />
      </div>
    </aside>
  );
}
