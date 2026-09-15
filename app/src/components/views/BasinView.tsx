'use client';

import { useMemo } from 'react';
import { GroupedStatsList } from '@/components/GroupedStatsList';
import { groupStats, type Filters } from '@/lib/stats';
import type { Sample } from '@/lib/types';

export function BasinView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const groups = useMemo(
    () => groupStats(samples, (s) => s.basin, filters.parameters),
    [samples, filters.parameters]
  );

  return (
    <GroupedStatsList
      groups={groups}
      emptyMessage="No samples match the current filters."
    />
  );
}
