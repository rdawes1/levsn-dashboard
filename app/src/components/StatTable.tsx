'use client';

import { fmt, fmtInt, fmtPct } from '@/lib/format';
import { PARAMETER_BY_KEY } from '@/lib/parameters';
import type { ParameterStats } from '@/lib/stats';

/** Column headers mirror the published dashboard exactly. */
export const STAT_HEADERS = [
  'Parameter',
  'Mean Reading',
  'Median Reading',
  'Min Reading',
  'Max Reading',
  'Sample Count',
  'Exceedance Count',
  '% Exceedance',
] as const;

function ExceedanceCell({ pct }: { pct: number | null }) {
  if (pct === null) return <td className="num text-cwa-slate">&mdash;</td>;

  const tone =
    pct === 0
      ? 'bg-status-okSoft text-status-ok'
      : pct < 25
        ? 'bg-status-warnSoft text-status-warn'
        : 'bg-status-alertSoft text-status-alert';

  return (
    <td className="num">
      <span className={`inline-block min-w-[58px] rounded px-1.5 py-0.5 font-medium ${tone}`}>
        {fmtPct(pct, 1)}
      </span>
    </td>
  );
}

export function StatRows({ stats }: { stats: ParameterStats[] }) {
  return (
    <>
      {stats.map((s) => {
        const precision = PARAMETER_BY_KEY[s.key].precision;
        return (
          <tr key={s.key}>
            <td className="font-medium text-cwa-ink">
              {s.label}
              <span className="ml-1.5 text-[11px] font-normal text-cwa-slate">{s.unit}</span>
            </td>
            <td className="num">{fmt(s.mean, precision)}</td>
            <td className="num">{fmt(s.median, precision)}</td>
            <td className="num">{fmt(s.min, precision)}</td>
            <td className="num">{fmt(s.max, precision)}</td>
            <td className="num text-cwa-slate">{fmtInt(s.sampleCount)}</td>
            <td className="num text-cwa-slate">{fmtInt(s.exceedanceCount)}</td>
            <ExceedanceCell pct={s.exceedancePct} />
          </tr>
        );
      })}
    </>
  );
}

/** Turns a stats table into CSV rows, using the canonical labels as-is. */
export function statsToCsvRows(stats: ParameterStats[], prefix: unknown[] = []): unknown[][] {
  return stats.map((s) => [
    ...prefix,
    s.label,
    s.mean,
    s.median,
    s.min,
    s.max,
    s.sampleCount,
    s.exceedanceCount,
    s.exceedancePct,
  ]);
}
