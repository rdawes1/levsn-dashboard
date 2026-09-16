'use client';

import { useEffect, useMemo, useState } from 'react';
import { StackedChart, type PanelSpec } from '@/components/StackedChart';
import { StationPicker, type StationOption } from '@/components/StationPicker';
import { fmtDate } from '@/lib/format';
import { PARAMETER_BY_KEY, VISIBLE_PARAMETERS, type ParameterKey } from '@/lib/parameters';
import { seriesFor } from '@/lib/stats';
import type { Sample } from '@/lib/types';
import { MAX_COMPARE, useDashboard } from '@/store/useDashboard';

export function ResultsView({ samples }: { samples: Sample[] }) {
  const focusParameters = useDashboard((s) => s.focusParameters);
  const pickFocusParameter = useDashboard((s) => s.pickFocusParameter);
  const multiParameter = useDashboard((s) => s.multiParameter);
  const setMultiParameter = useDashboard((s) => s.setMultiParameter);
  const compareStations = useDashboard((s) => s.compareStations);
  const setCompareStations = useDashboard((s) => s.setCompareStations);
  const dateRange = useDashboard((s) => s.chartDateRange);
  const setDateRange = useDashboard((s) => s.setChartDateRange);

  const [yZoom, setYZoom] = useState<Partial<Record<ParameterKey, [number, number]>>>({});

  // A value zoom belongs to a specific panel; drop it if that panel goes away.
  const panelKey = focusParameters.join('|');
  useEffect(() => {
    setYZoom((z) =>
      Object.fromEntries(Object.entries(z).filter(([k]) => focusParameters.includes(k as ParameterKey)))
    );
  }, [panelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stations offered by the picker: only those with readings under the current filters.
  const stationOptions = useMemo<StationOption[]>(() => {
    const seen = new Map<string, StationOption>();
    for (const s of samples) {
      if (s.stationId && !seen.has(s.stationId)) {
        seen.set(s.stationId, { id: s.stationId, name: s.stationName, basin: s.basin });
      }
    }
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [samples]);

  const stationNames = useMemo(() => {
    const names: Record<string, string | null> = {};
    for (const s of useDashboard.getState().snapshot?.stations ?? []) {
      if (s.stationId && !(s.stationId in names)) names[s.stationId] = s.stationName;
    }
    return names;
  }, []);

  const scoped = useMemo(
    () =>
      compareStations.length
        ? samples.filter((s) => s.stationId !== null && compareStations.includes(s.stationId))
        : samples,
    [samples, compareStations]
  );

  const panels = useMemo<PanelSpec[]>(
    () =>
      focusParameters.map((key) => {
        const p = PARAMETER_BY_KEY[key];
        return {
          key,
          label: p.label,
          unit: p.unit,
          precision: p.precision,
          zeroBaseline: p.zeroBaseline,
          thresholds: p.thresholdLines ?? [],
          points: seriesFor(scoped, key),
        };
      }),
    [focusParameters, scoped]
  );

  const zoomed = dateRange !== null || Object.keys(yZoom).length > 0;
  const atMax = multiParameter && focusParameters.length >= MAX_COMPARE;
  const comparing = compareStations.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-cwa-mist px-3 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-cwa-slate">
            {multiParameter ? 'Parameters' : 'Parameter'}
          </span>
          {VISIBLE_PARAMETERS.map((p) => {
            const on = focusParameters.includes(p.key);
            const blocked = !on && atMax;
            return (
              <button
                key={p.key}
                onClick={() => pickFocusParameter(p.key)}
                aria-pressed={on}
                disabled={blocked}
                title={
                  blocked
                    ? `Up to ${MAX_COMPARE} parameters - remove one to add ${p.label}`
                    : multiParameter && on && focusParameters.length === 1
                      ? 'At least one parameter is always shown'
                      : undefined
                }
                className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                  on
                    ? 'border-cwa-deep bg-cwa-deep font-medium text-white'
                    : blocked
                      ? 'cursor-not-allowed border-cwa-mist text-cwa-slate/45'
                      : 'border-cwa-silver text-cwa-slate hover:border-cwa-cyan hover:text-cwa-deep'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <label
            className="ml-1 flex cursor-pointer select-none items-center gap-1.5 rounded-full border border-cwa-silver px-2.5 py-1 text-[12px] text-cwa-slate hover:border-cwa-cyan"
            data-export-ignore="true"
          >
            <input
              id="compare-multiple-parameters"
              type="checkbox"
              checked={multiParameter}
              onChange={(e) => setMultiParameter(e.target.checked)}
              className="h-3.5 w-3.5 accent-cwa-deep"
            />
            Compare multiple
            {multiParameter && <span className="text-cwa-slate/70">(up to {MAX_COMPARE})</span>}
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <StationPicker
            options={stationOptions}
            selected={compareStations}
            onChange={setCompareStations}
            max={MAX_COMPARE}
            names={stationNames}
          />

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-cwa-slate">
            {comparing ? (
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="3" fill="#8B97A8" />
                  <circle cx="7" cy="7" r="5.6" fill="none" stroke="#B3261E" strokeWidth="1.6" />
                </svg>
                Exceedance
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-ok" /> Non Exceedance
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-alert" /> Exceedance
                </span>
              </>
            )}
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="18" y2="3" stroke="#B3261E" strokeOpacity="0.6" strokeDasharray="4 3" />
              </svg>
              Threshold
            </span>
            {zoomed ? (
              <button
                onClick={() => {
                  setYZoom({});
                  setDateRange(null);
                }}
                className="rounded border border-cwa-silver px-2 py-0.5 font-medium text-cwa-deep hover:border-cwa-cyan"
                data-export-ignore="true"
              >
                Reset zoom
              </button>
            ) : (
              <span className="hidden text-cwa-slate/70 md:inline" data-export-ignore="true">
                Drag on a chart to zoom · double-click to reset
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 py-2 sm:px-4">
        <StackedChart
          panels={panels}
          stations={compareStations}
          dateRange={dateRange}
          onDateRange={setDateRange}
          yZoom={yZoom}
          onYZoom={setYZoom}
          formatDate={fmtDate}
        />
      </div>

      <p className="shrink-0 border-t border-cwa-mist px-3 py-1.5 text-[11px] leading-snug text-cwa-slate sm:px-5">
        {focusParameters.map((k) => PARAMETER_BY_KEY[k].threshold).join(' · ')}
      </p>
    </div>
  );
}
