'use client';

import { fmtInt, fmtPct, fmtTimestamp } from '@/lib/format';
import { RefreshFromAirtable } from '@/components/RefreshFromAirtable';

interface Props {
  sitesMonitored: number;
  samplesCollected: number;
  basinsCovered: number;
  exceedancePct: number | null;
  fetchedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
  sitesMonitored,
  samplesCollected,
  basinsCovered,
  exceedancePct,
  fetchedAt,
  onRefresh,
  refreshing,
}: Props) {
  return (
    <aside className="flex w-[200px] shrink-0 flex-col justify-between border-l border-white/10 bg-cwa-deep">
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
