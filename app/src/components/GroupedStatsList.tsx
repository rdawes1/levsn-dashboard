'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtInt } from '@/lib/format';
import type { GroupedStats } from '@/lib/stats';
import { STAT_HEADERS, StatRows } from '@/components/StatTable';

/**
 * Shared scrolling list behind the "by Basin" and "by Station" views.
 *
 * Two things this fixes, both of which bit the first cut:
 *
 * 1. SCROLLING. The scroll container must be bounded by its flex parent
 *    (`h-full` + `min-h-0`). Without it the container grows to its content
 *    height - 129,000px for all 224 stations - and the parent's `overflow-hidden`
 *    clips it, so no scrollbar appears anywhere and the data below is unreachable.
 *
 * 2. MOUNT COST. All stations at once is 1,935 table rows, which is ~0.5s of
 *    layout every time the tab is opened. Groups are rendered in pages instead,
 *    with more appended as the sentinel scrolls into view.
 */

const PAGE = 12;

interface Props<T extends string> {
  groups: GroupedStats<T>[];
  /** Extra detail rendered beside the group name, e.g. station name + basin. */
  renderMeta?: (group: T) => React.ReactNode;
  emptyMessage: string;
}

export function GroupedStatsList<T extends string>({
  groups,
  renderMeta,
  emptyMessage,
}: Props<T>) {
  const [visible, setVisible] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Reset paging and scroll position whenever the filtered result set changes.
  useEffect(() => {
    setVisible(PAGE);
    scroller.current?.scrollTo({ top: 0 });
  }, [groups]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || visible >= groups.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + PAGE, groups.length));
        }
      },
      { root: scroller.current, rootMargin: '600px' }
    );

    io.observe(node);
    return () => io.disconnect();
  }, [visible, groups.length]);

  if (!groups.length) {
    return <p className="px-6 py-16 text-center text-[13px] text-cwa-slate">{emptyMessage}</p>;
  }

  const shown = groups.slice(0, visible);

  return (
    <div ref={scroller} className="h-full min-h-0 overflow-y-auto scroll-light">
      {shown.map(({ group, sampleRows, stats }) => (
        <section key={group} className="mb-6 last:mb-0">
          <header className="sticky top-0 z-20 flex flex-wrap items-baseline gap-x-2 border-b border-cwa-silver bg-white px-5 py-2.5">
            <h3 className="text-[15px] font-semibold text-cwa-deep">{group}</h3>
            {renderMeta?.(group)}
            <span className="text-[12px] text-cwa-slate">
              {fmtInt(sampleRows)} sample{sampleRows === 1 ? '' : 's'}
            </span>
          </header>

          <div className="overflow-x-auto">
            <table className="stat-table">
              <thead>
                <tr>
                  {STAT_HEADERS.map((h, i) => (
                    <th key={h} className={i === 0 ? '' : '!text-right'}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <StatRows stats={stats} />
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {visible < groups.length && (
        <div ref={sentinel} className="px-5 py-6 text-center text-[12px] text-cwa-slate">
          Showing {fmtInt(visible)} of {fmtInt(groups.length)} &mdash; scroll for more
        </div>
      )}
    </div>
  );
}
