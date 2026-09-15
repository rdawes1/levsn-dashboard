'use client';

import { fmtInt, fmtPct, fmtTimestamp } from '@/lib/format';
import { RefreshFromAirtable } from '@/components/RefreshFromAirtable';

interface Props {
  /** 'rail' is the desktop column; 'strip' is the horizontal band used below lg. */
  layout?: 'rail' | 'strip';
  sitesMonitored: number;
  samplesCollected: number;
  basinsCovered: number;
  exceedancePct: number | null;
  fetchedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}

function Kpi({
  label,
  value,
  hint,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="shrink-0 px-4 py-2 text-center">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/70">{label}</p>
        <p className="tnum text-[20px] font-bold leading-tight text-white">{value}</p>
      </div>
    );
  }
  return (
    <div className="px-6 py-7 text-center">
      <p className="text-[13px] font-medium leading-snug text-white/85">{label}</p>
      <p className="tnum mt-2 text-[44px] font-bold leading-none tracking-tight text-white">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-white/55">{hint}</p>}
    </div>
  );
}

export function KpiRail({
  layout = 'rail',
  sitesMonitored,
  samplesCollected,
  basinsCovered,
  exceedancePct,
  fetchedAt,
  onRefresh,
  refreshing,
}: Props) {
  if (layout === 'strip') {
    return (
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-y border-white/10 bg-cwa-deep/60 scroll-thin print-hide">
        <Kpi compact label="Sites" value={fmtInt(sitesMonitored)} />
        <span className="h-7 w-px shrink-0 bg-white/15" />
        <Kpi compact label="Samples" value={fmtInt(samplesCollected)} />
        <span className="h-7 w-px shrink-0 bg-white/15" />
        <Kpi compact label="Basins" value={fmtInt(basinsCovered)} />
        <span className="h-7 w-px shrink-0 bg-white/15" />
        <Kpi compact label="Exceedance" value={fmtPct(exceedancePct, 1)} />
        <div className="ml-auto flex shrink-0 items-center gap-2 px-3">
          <span className="whitespace-nowrap text-[10px] text-white/45">
            {fetchedAt ? fmtTimestamp(fetchedAt) : 'Loading\u2026'}
          </span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Check for updated data"
            className="rounded border border-white/25 p-1 text-white/80 transition-colors
                       hover:border-cwa-cyan hover:text-cwa-cyan disabled:opacity-50"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M14 8a6 6 0 1 1-1.8-4.3M14 2v3.5h-3.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside className="hidden w-[200px] shrink-0 flex-col justify-between border-l border-white/10 bg-cwa-deep lg:flex print-hide">
      <div className="divide-y divide-white/10">
        <Kpi label="Sites Monitored" value={fmtInt(sitesMonitored)} />
        <Kpi label="Samples Collected" value={fmtInt(samplesCollected)} />
        <Kpi label="Basins Covered" value={fmtInt(basinsCovered)} />
        <Kpi
          label="Exceedance Rate"
          value={fmtPct(exceedancePct, 1)}
          hint="across selected parameters"
        />
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-white/25
                     px-2 py-1.5 text-[11px] font-medium text-white/85 transition-colors
                     hover:border-cwa-cyan hover:text-cwa-cyan disabled:opacity-50"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M14 8a6 6 0 1 1-1.8-4.3M14 2v3.5h-3.5" strokeLinecap="round" />
          </svg>
          {refreshing ? 'Checking' : 'Check for updates'}
        </button>
        <p className="mt-2 text-center text-[10px] leading-tight text-white/45">
          {fetchedAt ? `Airtable data as of ${fmtTimestamp(fetchedAt)}` : 'Loading…'}
        </p>

        {/* Admin-only: appears with ?admin=1 when the Worker has it configured. */}
        <RefreshFromAirtable />
      </div>
    </aside>
  );
}
