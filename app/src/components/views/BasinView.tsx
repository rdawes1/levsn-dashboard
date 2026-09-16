'use client';

import { useCallback, useMemo } from 'react';
import { GroupedStatsList } from '@/components/GroupedStatsList';
import { OrgLogo } from '@/components/OrgLogo';
import { groupStats, type Filters } from '@/lib/stats';
import type { Sample } from '@/lib/types';

export function BasinView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const groups = useMemo(
    () => groupStats(samples, (s) => s.basin, filters.parameters),
    [samples, filters.parameters]
  );

  // Organisations with readings in each basin under the current filters,
  // busiest first, so the logos credit who actually produced these numbers.
  const orgsByBasin = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const s of samples) {
      if (!s.basin || !s.organization) continue;
      const byOrg = counts.get(s.basin) ?? new Map<string, number>();
      byOrg.set(s.organization, (byOrg.get(s.organization) ?? 0) + 1);
      counts.set(s.basin, byOrg);
    }
    return new Map(
      [...counts].map(([basin, byOrg]) => [
        basin,
        [...byOrg].sort((a, b) => b[1] - a[1]).map(([org]) => org),
      ])
    );
  }, [samples]);

  const renderAside = useCallback(
    (basin: string) => {
      const orgs = orgsByBasin.get(basin) ?? [];
      if (!orgs.length) return null;
      return (
        <>
          <span className="text-[10px] font-medium uppercase tracking-wider text-cwa-slate/80">
            Monitored by
          </span>
          {orgs.map((org) => (
            <OrgLogo key={org} org={org} size="sm" />
          ))}
        </>
      );
    },
    [orgsByBasin]
  );

  return (
    <GroupedStatsList
      groups={groups}
      renderAside={renderAside}
      emptyMessage="No samples match the current filters."
    />
  );
}
