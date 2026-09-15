'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { useCallback, useMemo, useState } from 'react';
import Map, {
  Layer,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  type MapLayerMouseEvent,
} from 'react-map-gl';
import { fmtInt, fmtPct } from '@/lib/format';
import { stationRollups, type Filters } from '@/lib/stats';
import type { Sample } from '@/lib/types';

/**
 * Mapbox token is a PUBLIC (pk.*) token by design - it is meant to ship to the
 * browser and is protected by URL restrictions set in the Mapbox account, not
 * by secrecy. Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local.
 */
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const MAP_STYLE = process.env.NEXT_PUBLIC_MAPBOX_STYLE ?? 'mapbox://styles/mapbox/light-v11';

const LAYER_ID = 'levsn-stations';

/**
 * Stations are drawn as a GL circle layer rather than DOM markers.
 *
 * With 215 markers as HTML elements, a PNG export took over 45 seconds -
 * html-to-image has to serialise and inline every node. Drawing them into the
 * map canvas means the export is just a canvas read, and panning gets smoother
 * as a side effect.
 */
const CIRCLE_PAINT = {
  // Colour by exceedance rate across the selected parameters.
  'circle-color': [
    'step',
    ['get', 'pct'],
    '#8B97A8', // pct < 0 sentinel: nothing evaluated
    0,
    '#2E7D57',
    0.0001,
    '#59A14F',
    25,
    '#E8A33D',
    50,
    '#D97428',
    75,
    '#B3261E',
  ],
  // Size by how many samples the station has contributed.
  'circle-radius': [
    'interpolate',
    ['linear'],
    ['sqrt', ['get', 'samples']],
    0,
    4,
    3,
    7,
    8,
    11,
    16,
    15,
  ],
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': 1.25,
  'circle-opacity': 0.9,
} as const;

const LEGEND = [
  { label: 'No exceedances', color: '#2E7D57' },
  { label: 'Under 25%', color: '#59A14F' },
  { label: '25–50%', color: '#E8A33D' },
  { label: '50–75%', color: '#D97428' },
  { label: 'Over 75%', color: '#B3261E' },
];

interface Selected {
  lat: number;
  lon: number;
  stationId: string;
  stationName: string | null;
  basin: string | null;
  organization: string | null;
  samples: number;
  pct: number | null;
}

function colorFor(pct: number | null): string {
  if (pct === null) return '#8B97A8';
  if (pct === 0) return '#2E7D57';
  if (pct < 25) return '#59A14F';
  if (pct < 50) return '#E8A33D';
  if (pct < 75) return '#D97428';
  return '#B3261E';
}

function MissingToken() {
  return (
    <div className="flex h-full items-center justify-center bg-cwa-mist px-8">
      <div className="max-w-md rounded-panel border border-cwa-silver bg-white p-5 text-center shadow-panel">
        <p className="text-[14px] font-semibold text-cwa-deep">Mapbox token needed</p>
        <p className="mt-2 text-[12px] leading-relaxed text-cwa-slate">
          Add a Mapbox public access token to{' '}
          <code className="rounded bg-cwa-mist px-1">.env.local</code> to render the monitoring map:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-cwa-navy px-3 py-2 text-left text-[11px] text-white">
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here
        </pre>
        <p className="mt-2 text-[11px] text-cwa-slate">Every other view works without it.</p>
      </div>
    </div>
  );
}

export function MapView({ samples, filters }: { samples: Sample[]; filters: Filters }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [cursor, setCursor] = useState<'auto' | 'pointer'>('auto');

  const geojson = useMemo(() => {
    const rollups = stationRollups(samples, filters.parameters);
    return {
      type: 'FeatureCollection' as const,
      features: rollups.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
        properties: {
          stationId: r.stationId,
          stationName: r.stationName ?? '',
          basin: r.basin ?? '',
          organization: r.organization ?? '',
          samples: r.sampleRows,
          // -1 marks "nothing evaluated", which the step expression paints grey.
          pct: r.exceedancePct ?? -1,
        },
      })),
    };
  }, [samples, filters.parameters]);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setSelected(null);
      return;
    }
    const p = f.properties as Record<string, unknown>;
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const pct = Number(p.pct);
    setSelected({
      lat,
      lon,
      stationId: String(p.stationId ?? ''),
      stationName: (p.stationName as string) || null,
      basin: (p.basin as string) || null,
      organization: (p.organization as string) || null,
      samples: Number(p.samples ?? 0),
      pct: pct < 0 ? null : pct,
    });
  }, []);

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
        interactiveLayerIds={[LAYER_ID]}
        onClick={onClick}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('auto')}
        cursor={cursor}
      >
        <NavigationControl position="top-left" showCompass={false} />
        <ScaleControl position="bottom-right" />

        <Source id="levsn-stations-src" type="geojson" data={geojson}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Layer id={LAYER_ID} type="circle" paint={CIRCLE_PAINT as any} />
        </Source>

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
                  <dd className="tnum text-cwa-ink">{fmtInt(selected.samples)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Exceedance rate</dt>
                  <dd className="tnum font-medium" style={{ color: colorFor(selected.pct) }}>
                    {fmtPct(selected.pct, 1)}
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
