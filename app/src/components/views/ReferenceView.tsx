'use client';

import { useMemo } from 'react';
import { fmt, fmtInt } from '@/lib/format';
import { conductivityPercentiles } from '@/lib/stats';
import type { Sample } from '@/lib/types';

/**
 * "Conductivity Results Compared to Ohio EPA Reference and Survey Data".
 *
 * Rows are computed live from LEVSN samples. The Reference and Survey
 * percentile rows from the published dashboard come from Ohio EPA datasets that
 * are not in the Airtable base; once supplied as a table keyed by ecoregion and
 * stream size they slot in beneath each Results row.
 */
export function ReferenceView({ samples }: { samples: Sample[] }) {
  const rows = useMemo(() => conductivityPercentiles(samples), [samples]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto scroll-light">
        <table className="stat-table">
          <thead>
            <tr>
              <th>Sample Year</th>
              <th>Basin</th>
              <th>Percentiles</th>
              <th className="!text-right">Minimum</th>
              <th className="!text-right">25Th</th>
              <th className="!text-right">50Th</th>
              <th className="!text-right">Max</th>
              <th className="!text-right">Sample Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.year}-${r.basin}`}>
                <td className="tnum text-cwa-slate">{r.year}</td>
                <td className="font-medium text-cwa-ink">{r.basin}</td>
                <td className="text-cwa-slate">Results</td>
                <td className="num">{fmt(r.min)}</td>
                <td className="num">{fmt(r.p25)}</td>
                <td className="num">{fmt(r.p50)}</td>
                <td className="num">{fmt(r.max)}</td>
                <td className="num text-cwa-slate">{fmtInt(r.n)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center text-[13px] text-cwa-slate">
                  No conductivity readings match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
