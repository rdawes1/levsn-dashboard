'use client';

import { useCallback, useMemo } from 'react';
import { GroupedStatsList } from '@/components/GroupedStatsList';
import { OrgLogo } from '@/components/OrgLogo';
import { groupStats, type Filters } from '@/lib/stats';
import type { Sample } from '@/lib/types';

export function StationView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const groups = useMemo(
    () => groupStats(samples, (s) => s.stationId, filters.parameters),
    [samples, filters.parameters]
  );

  // Station id -> friendly name and basin, for the section header.
  const meta = useMemo(() => {
    const m = new Map<string, { name: string | null; basin: string | null; org: string | null }>();
    for (const s of samples) {
      if (s.stationId && !m.has(s.stationId)) {
        m.set(s.stationId, { name: s.stationName, basin: s.basin, org: s.organization });
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

  const renderAside = useCallback(
    (stationId: string) => <OrgLogo org={meta.get(stationId)?.org} size="sm" />,
    [meta]
  );

  return (
    <GroupedStatsList
      groups={groups}
      renderMeta={renderMeta}
      renderAside={renderAside}
      emptyMessage="No samples match the current filters."
    />
  );
}
