'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerSwatch, STATION_STYLES } from '@/components/StackedChart';

export interface StationOption {
  id: string;
  name: string | null;
  basin: string | null;
}

interface Props {
  /** Stations that have readings under the current filters. */
  options: StationOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
  /** Friendly names for selected stations that are no longer in `options`. */
  names: Record<string, string | null>;
}

/**
 * Up to `max` stations to compare. Each chip doubles as the chart legend: it
 * shows the station's colour and marker shape exactly as plotted.
 */
export function StationPicker({ options, selected, onChange, max, names }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => new Set(options.map((o) => o.id)), [options]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !selected.includes(o.id))
      .filter(
        (o) =>
          !q ||
          o.id.toLowerCase().includes(q) ||
          (o.name ?? '').toLowerCase().includes(q) ||
          (o.basin ?? '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [options, selected, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setActive(0), [query, open]);

  function add(id: string) {
    onChange([...selected, id].slice(0, max));
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-cwa-slate">
        Compare stations
      </span>

      {selected.map((id, i) => {
        const style = STATION_STYLES[i];
        const missing = !available.has(id);
        return (
          <span
            key={id}
            title={missing ? `${id} has no readings with the current filters` : undefined}
            className={`flex max-w-[260px] items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-[12px] ${
              missing ? 'border-dashed border-cwa-silver text-cwa-slate/70' : 'border-cwa-silver text-cwa-ink'
            }`}
            style={missing ? undefined : { borderColor: style.color }}
          >
            <MarkerSwatch color={style.color} shape={style.shape} size={11} />
            <span className="truncate">
              <span className="font-medium">{id}</span>
              {names[id] ? <span className="text-cwa-slate"> · {names[id]}</span> : null}
            </span>
            <button
              onClick={() => onChange(selected.filter((s) => s !== id))}
              aria-label={`Stop comparing ${id}`}
              className="rounded-full p-0.5 text-cwa-slate hover:bg-cwa-mist hover:text-cwa-deep"
              data-export-ignore="true"
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        );
      })}

      {selected.length < max && (
        <div ref={boxRef} className="relative" data-export-ignore="true">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="rounded-full border border-dashed border-cwa-silver px-2.5 py-1 text-[12px] text-cwa-slate
                       transition-colors hover:border-cwa-cyan hover:text-cwa-deep"
          >
            + Add station
          </button>

          {open && (
            <div className="absolute left-0 z-30 mt-1 w-[280px] overflow-hidden rounded-panel border border-cwa-silver bg-white shadow-panel">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, matches.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter' && matches[active]) {
                    e.preventDefault();
                    add(matches[active].id);
                  } else if (e.key === 'Escape') {
                    setOpen(false);
                  }
                }}
                placeholder="Search by ID, name or basin"
                aria-label="Search stations"
                className="w-full border-b border-cwa-mist px-3 py-2 text-[12px] outline-none placeholder:text-cwa-slate/70"
              />
              <ul role="listbox" className="max-h-60 overflow-y-auto py-1 scroll-light">
                {matches.map((o, i) => (
                  <li key={o.id} role="option" aria-selected={i === active}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(o.id)}
                      className={`block w-full px-3 py-1.5 text-left text-[12px] ${
                        i === active ? 'bg-cwa-mist' : ''
                      }`}
                    >
                      <span className="font-medium text-cwa-ink">{o.id}</span>
                      {o.name && <span className="text-cwa-slate"> · {o.name}</span>}
                      {o.basin && <span className="block text-[11px] text-cwa-slate/80">{o.basin}</span>}
                    </button>
                  </li>
                ))}
                {!matches.length && (
                  <li className="px-3 py-3 text-[12px] text-cwa-slate">
                    No stations match{query ? ` “${query}”` : ''} with the current filters.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
