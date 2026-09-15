'use client';

import { PARAMETERS } from '@/lib/parameters';
import type { Filters } from '@/lib/stats';
import { useDashboard } from '@/store/useDashboard';

interface GroupProps {
  title: string;
  filterKey: keyof Filters;
  options: (string | number)[];
  selected: (string | number)[];
  /** Cap the visible height for long lists (basins, stations). */
  scroll?: boolean;
  labels?: Record<string, string>;
}

function FilterGroup({ title, filterKey, options, selected, scroll, labels }: GroupProps) {
  const toggleFilter = useDashboard((s) => s.toggleFilter);
  const setFilter = useDashboard((s) => s.setFilter);
  const allSelected = selected.length === 0;

  return (
    <section className="mb-5">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-cwa-cyan">
        {title}
      </h3>

      <div
        className={`${scroll ? 'max-h-44 overflow-y-auto pr-1 scroll-thin' : ''} text-white/90`}
      >
        <label className="filter-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setFilter(filterKey, [] as never)}
            className="h-3.5 w-3.5 shrink-0 accent-cwa-cyan"
          />
          <span className={allSelected ? 'font-medium text-white' : ''}>(All)</span>
        </label>

        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <label key={String(opt)} className="filter-check" title={String(opt)}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleFilter(filterKey, opt)}
                className="h-3.5 w-3.5 shrink-0 accent-cwa-cyan"
              />
              <span className={`truncate ${checked ? 'font-medium text-white' : ''}`}>
                {labels?.[String(opt)] ?? String(opt)}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function FilterRail() {
  const snapshot = useDashboard((s) => s.snapshot);
  const filters = useDashboard((s) => s.filters);
  const resetFilters = useDashboard((s) => s.resetFilters);
  const view = useDashboard((s) => s.view);

  if (!snapshot) return null;

  // Station list narrows to the chosen basins, so the list stays usable.
  const stationOptions = [
    ...new Set(
      snapshot.stations
        .filter((s) => !filters.basins.length || (s.basin && filters.basins.includes(s.basin)))
        .map((s) => s.stationId)
        .filter((s): s is string => Boolean(s))
    ),
  ].sort();

  const stationLabels = Object.fromEntries(
    snapshot.stations
      .filter((s) => s.stationId)
      .map((s) => [s.stationId as string, s.stationName ? `${s.stationId} · ${s.stationName}` : s.stationId as string])
  );

  const activeCount = Object.values(filters).reduce((n, v) => n + (v as unknown[]).length, 0);

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-l border-white/10 bg-cwa-deeper">
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
        />
        <FilterGroup
          title="Basin"
          filterKey="basins"
          options={snapshot.basins}
          selected={filters.basins}
          scroll
        />
        {view !== 'locations' && (
          <FilterGroup
            title="Station Id"
            filterKey="stationIds"
            options={stationOptions}
            selected={filters.stationIds}
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
        />
        <FilterGroup
          title="Organization"
          filterKey="organizations"
          options={snapshot.organizations}
          selected={filters.organizations}
          scroll
        />
        <FilterGroup
          title="Ecoregion"
          filterKey="ecoregions"
          options={snapshot.ecoregions}
          selected={filters.ecoregions}
        />
        <FilterGroup
          title="Stream Size"
          filterKey="streamSizes"
          options={snapshot.streamSizes}
          selected={filters.streamSizes}
        />
      </div>
    </aside>
  );
}
