'use client';

import { useMemo } from 'react';
import { ScatterPlot } from '@/components/ScatterPlot';
import { fmt, fmtDate, fmtInt } from '@/lib/format';
import { PARAMETERS, PARAMETER_BY_KEY, type ParameterKey } from '@/lib/parameters';
import { seriesFor } from '@/lib/stats';
import type { Sample } from '@/lib/types';

interface Props {
  samples: Sample[];
  focusParameter: ParameterKey;
  onFocusChange: (key: ParameterKey) => void;
}

export function ResultsView({ samples, focusParameter, onFocusChange }: Props) {
  const param = PARAMETER_BY_KEY[focusParameter];
  const points = useMemo(() => seriesFor(samples, focusParameter), [samples, focusParameter]);

  const exceedingCount = useMemo(() => points.reduce((n, p) => n + (p.exceeds ? 1 : 0), 0), [points]);
  const passingCount = points.length - exceedingCount;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cwa-mist px-5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-cwa-slate">
            Parameter
          </span>
          {PARAMETERS.map((p) => (
            <button
              key={p.key}
              onClick={() => onFocusChange(p.key)}
              aria-pressed={p.key === focusParameter}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                p.key === focusParameter
                  ? 'border-cwa-deep bg-cwa-deep font-medium text-white'
                  : 'border-cwa-silver text-cwa-slate hover:border-cwa-cyan hover:text-cwa-deep'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[12px]">
          <span className="flex items-center gap-1.5 text-cwa-slate">
            <span className="h-2.5 w-2.5 rounded-full bg-status-ok" />
            Non Exceedance {fmtInt(passingCount)}
          </span>
          <span className="flex items-center gap-1.5 text-cwa-slate">
            <span className="h-2.5 w-2.5 rounded-full bg-status-alert" />
            Exceedance {fmtInt(exceedingCount)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-3">
        <ScatterPlot
          points={points}
          yLabel={`${param.label} (${param.unit})`}
          formatValue={(v) => fmt(v, param.precision)}
          formatDate={fmtDate}
        />
      </div>

      <p className="shrink-0 border-t border-cwa-mist px-5 py-2 text-[11px] text-cwa-slate">
        {param.threshold}
      </p>
    </div>
  );
}
