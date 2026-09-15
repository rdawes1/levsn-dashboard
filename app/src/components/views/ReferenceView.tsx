'use client';

import { useMemo } from 'react';
import { fmt, fmtInt } from '@/lib/format';
import { percentile } from '@/lib/stats';
import type { Sample } from '@/lib/types';

/**
 * "Conductivity Results Compared to Ohio EPA Reference and Survey Data".
 *
 * The "Results" rows below are computed live from LEVSN samples. The
 * "Reference" and "Survey" percentile rows in the published dashboard come from
 * Ohio EPA reference datasets that are NOT present in the Airtable base - they
 * are keyed by ecoregion and stream size, not by our samples. Until that table
 * is supplied, this view shows Results only and says so plainly rather than
 * inventing comparison values.
 */

interface Row {
  year: number;
  basin: string;
  n: number;
  min: number | null;
  p25: number | null;
  p50: number | null;
  max: number | null;
}

const SEP = '||';

export function ReferenceView({ samples }: { samples: Sample[] }) {
  const rows = useMemo<Row[]>(() => {
    const groups = new Map<string, number[]>();

    for (const s of samples) {
      const v = s.values.conductivity;
      if (typeof v !== 'number' || !s.year || !s.basin) continue;
      const key = `${s.year}${SEP}${s.basin}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(v);
      else groups.set(key, [v]);
    }

    return [...groups.entries()]
      .map(([key, values]) => {
        const [year, basin] = key.split(SEP);
        values.sort((a, b) => a - b);
        return {
          year: Number(year),
          basin,
          n: values.length,
          min: values[0] ?? null,
          p25: percentile(values, 0.25),
          p50: percentile(values, 0.5),
          max: values[values.length - 1] ?? null,
        };
      })
      .sort((a, b) => a.year - b.year || a.basin.localeCompare(b.basin));
  }, [samples]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
        <p className="text-[12px] leading-relaxed text-amber-900">
          <strong className="font-semibold">Reference and Survey rows are not yet connected.</strong>{' '}
          The Ohio EPA reference and survey percentile benchmarks shown in the current dashboard are
          not stored in the LEVSN Airtable base. Supply them as a table keyed by ecoregion and stream
          size and they will slot in beneath each Results row.
        </p>
      </div>

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
