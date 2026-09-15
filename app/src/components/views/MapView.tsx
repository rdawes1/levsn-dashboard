'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { useMemo, useState } from 'react';
import Map, { Marker, NavigationControl, Popup, ScaleControl } from 'react-map-gl';
import { fmtInt, fmtPct } from '@/lib/format';
import { stationRollups, type Filters, type StationRollup } from '@/lib/stats';
import type { Sample } from '@/lib/types';

/**
 * Mapbox token is a PUBLIC (pk.*) token by design - it is meant to ship to the
 * browser and is protected by URL restrictions set in the Mapbox account, not
 * by secrecy. Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local.
 */
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAPBOX_STYLE ?? 'mapbox://styles/mapbox/light-v11';

/** Marker colour encodes the exceedance rate across the selected parameters. */
function colorFor(pct: number | null): string {
  if (pct === null) return '#8B97A8';
  if (pct === 0) return '#2E7D57';
  if (pct < 25) return '#59A14F';
  if (pct < 50) return '#E8A33D';
  if (pct < 75) return '#D97428';
  return '#B3261E';
}

function sizeFor(rows: number): number {
  return Math.max(10, Math.min(28, 8 + Math.sqrt(rows) * 1.8));
}

const LEGEND = [
  { label: 'No exceedances', color: '#2E7D57' },
  { label: 'Under 25%', color: '#59A14F' },
  { label: '25–50%', color: '#E8A33D' },
  { label: '50–75%', color: '#D97428' },
  { label: 'Over 75%', color: '#B3261E' },
];

function MissingToken() {
  return (
    <div className="flex h-full items-center justify-center bg-cwa-mist px-8">
      <div className="max-w-md rounded-panel border border-cwa-silver bg-white p-5 text-center shadow-panel">
        <p className="text-[14px] font-semibold text-cwa-deep">Mapbox token needed</p>
        <p className="mt-2 text-[12px] leading-relaxed text-cwa-slate">
          Add a Mapbox public access token to <code className="rounded bg-cwa-mist px-1">.env.local</code> to
          render the monitoring map:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-cwa-navy px-3 py-2 text-left text-[11px] text-white">
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here
        </pre>
        <p className="mt-2 text-[11px] text-cwa-slate">
          Every other view works without it.
        </p>
      </div>
    </div>
  );
}

export function MapView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const [selected, setSelected] = useState<StationRollup | null>(null);

  const rollups = useMemo(
    () => stationRollups(samples, filters.parameters),
    [samples, filters.parameters]
  );

  // Draw the busiest stations last so they sit on top of sparser neighbours.
  const ordered = useMemo(
    () => [...rollups].sort((a, b) => a.sampleRows - b.sampleRows),
    [rollups]
  );

  if (!MAPBOX_TOKEN) return <MissingToken />;

  return (
    <div className="relative h-full w-full">
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: -81.6, latitude: 42.0, zoom: 6.2 }}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        reuseMaps
        /* Without this the WebGL buffer is cleared after each frame and the
           basemap reads back blank in PNG exports. */
        preserveDrawingBuffer
      >
        <NavigationControl position="top-left" showCompass={false} />
        <ScaleControl position="bottom-right" />

        {ordered.map((r) => {
          const size = sizeFor(r.sampleRows);
          return (
            <Marker
              key={r.stationId}
              longitude={r.lon}
              latitude={r.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelected(r);
              }}
            >
              <button
                aria-label={`${r.stationId}${r.stationName ? ` - ${r.stationName}` : ''}`}
                title={`${r.stationId}${r.stationName ? ` · ${r.stationName}` : ''}`}
                className="block cursor-pointer rounded-full ring-[1.5px] ring-white transition-transform hover:scale-125"
                style={{
                  width: size,
                  height: size,
                  background: colorFor(r.exceedancePct),
                  opacity: 0.9,
                  boxShadow: '0 1px 3px rgba(8,20,52,.35)',
                }}
              />
            </Marker>
          );
        })}

        {selected && (
          <Popup
            longitude={selected.lon}
            latitude={selected.lat}
            anchor="bottom"
            offset={14}
            closeButton
            closeOnClick={false}
            onClose={() => setSelected(null)}
            maxWidth="260px"
          >
            <div className="min-w-[190px] font-sans text-[12px] leading-relaxed">
              <p className="text-[13px] font-semibold text-cwa-deep">{selected.stationId}</p>
              {selected.stationName && <p className="text-cwa-ink">{selected.stationName}</p>}
              <dl className="mt-1.5 space-y-0.5 text-cwa-slate">
                {selected.basin && (
                  <div className="flex justify-between gap-3">
                    <dt>Basin</dt>
                    <dd className="text-cwa-ink">{selected.basin}</dd>
                  </div>
                )}
                {selected.organization && (
                  <div className="flex justify-between gap-3">
                    <dt>Organization</dt>
                    <dd className="text-right text-cwa-ink">{selected.organization}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Samples</dt>
                  <dd className="tnum text-cwa-ink">{fmtInt(selected.sampleRows)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Exceedance rate</dt>
                  <dd
                    className="tnum font-medium"
                    style={{ color: colorFor(selected.exceedancePct) }}
                  >
                    {fmtPct(selected.exceedancePct, 1)}
                  </dd>
                </div>
              </dl>
            </div>
          </Popup>
        )}
      </Map>

      <div className="pointer-events-none absolute bottom-5 left-3 z-10 rounded-panel bg-white/95 px-3 py-2.5 shadow-panel">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cwa-slate">
          Exceedance rate
        </p>
        <ul className="space-y-1">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-2 text-[11px] text-cwa-ink">
              <span
                className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
                style={{ background: l.color }}
              />
              {l.label}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 border-t border-cwa-mist pt-1.5 text-[10px] text-cwa-slate">
          Marker size = samples collected
        </p>
      </div>

      <p className="pointer-events-none absolute bottom-1 right-2 z-10 text-[9px] text-cwa-slate/80">
        &copy; Mapbox &copy; OpenStreetMap
      </p>
    </div>
  );
}
