'use client';

import { useCallback, useMemo } from 'react';
import { GroupedStatsList } from '@/components/GroupedStatsList';
import { groupStats, type Filters } from '@/lib/stats';
import type { Sample } from '@/lib/types';

export function StationView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const groups = useMemo(
    () => groupStats(samples, (s) => s.stationId, filters.parameters),
    [samples, filters.parameters]
  );

  // Station id -> friendly name and basin, for the section header.
  const meta = useMemo(() => {
    const m = new Map<string, { name: string | null; basin: string | null }>();
    for (const s of samples) {
      if (s.stationId && !m.has(s.stationId)) {
        m.set(s.stationId, { name: s.stationName, basin: s.basin });
      }
    }
    return m;
  }, [samples]);

  const renderMeta = useCallback(
    (stationId: string) => {
      const info = meta.get(stationId);
      if (!info) return null;
      return (
        <>
          {info.name && <span className="text-[13px] text-cwa-ink">{info.name}</span>}
          {info.basin && (
            <span className="rounded bg-cwa-mist px-1.5 py-0.5 text-[11px] text-cwa-slate">
              {info.basin}
            </span>
          )}
        </>
      );
    },
    [meta]
  );

  return (
    <GroupedStatsList
      groups={groups}
      renderMeta={renderMeta}
      emptyMessage="No samples match the current filters."
    />
  );
}
