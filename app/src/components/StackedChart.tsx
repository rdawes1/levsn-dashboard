'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParameterKey } from '@/lib/parameters';
import type { SeriesPoint } from '@/lib/stats';

/**
 * Stacked comparison chart.
 *
 * Parameters have incompatible units and scales (conductivity in the
 * thousands, pH between 6 and 9), so they cannot honestly share a value axis.
 * Instead every parameter gets its own panel and value axis, and all panels
 * share one time axis - dates line up vertically, and zooming the dates on one
 * panel zooms them on all.
 *
 * Two colour modes:
 *   - no stations compared: green / red by exceedance, as in the original chart
 *   - stations compared: each station has its own colour AND marker shape, so
 *     stations stay distinguishable in greyscale and for colour-blind readers.
 *     Red is reserved for exceedance, drawn as a ring around the marker.
 *
 * Points are drawn on canvas; an SVG layer carries axes, threshold lines and
 * the zoom box. (An SVG node per reading blocked the main thread for ~870ms.)
 */

export interface PanelSpec {
  key: ParameterKey;
  label: string;
  unit: string;
  precision: number;
  zeroBaseline: boolean;
  thresholds: { value: number; label: string }[];
  points: SeriesPoint[];
}

type Shape = 'circle' | 'square' | 'triangle';

/** Per compared station: colour and shape. Avoids green and red, which mean pass / exceed. */
export const STATION_STYLES: { color: string; shape: Shape }[] = [
  { color: '#2458B3', shape: 'circle' },
  { color: '#D9861C', shape: 'square' },
  { color: '#7B4FB5', shape: 'triangle' },
];

const OK = '#2E7D57';
const ALERT = '#B3261E';
const AXIS = '#3A4B64';
const GRID = '#E9EAEB';

/** A gap longer than this breaks a station's connecting line (e.g. over winter). */
const LINE_BREAK_MS = 45 * 86_400_000;

interface Props {
  panels: PanelSpec[];
  /** Compared station ids, in picker order. Empty = colour by exceedance. */
  stations: string[];
  dateRange: [number, number] | null;
  onDateRange: (range: [number, number] | null) => void;
  /** Value-axis zoom per panel. Controlled, so the parent can offer Reset zoom. */
  yZoom: Partial<Record<ParameterKey, [number, number]>>;
  onYZoom: (zoom: Partial<Record<ParameterKey, [number, number]>>) => void;
  formatDate: (iso: string) => string;
}

/* --------------------------------------------------------------------------- */

function niceScale(min: number, max: number, ticks = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.25 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function compactTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(abs < 10 ? 1 : 0);
}

function fullTick(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 });
}

function formatTimeTick(t: number, spanMs: number): string {
  const opts: Intl.DateTimeFormatOptions =
    spanMs > 300 * 86_400_000 ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' };
  return new Date(t).toLocaleDateString('en-US', opts);
}

function drawMarker(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number) {
  ctx.moveTo(x + r, y);
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === 'square') {
    const s = r * 0.9;
    ctx.moveTo(x - s, y - s);
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else {
    const s = r * 1.15;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y + s * 0.8);
    ctx.lineTo(x - s, y + s * 0.8);
    ctx.closePath();
  }
}

/** SVG twin of drawMarker, for legends and the tooltip. */
export function MarkerSwatch({ color, shape, size = 12 }: { color: string; shape: Shape; size?: number }) {
  const c = size / 2;
  const r = size * 0.36;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      {shape === 'circle' && <circle cx={c} cy={c} r={r} fill={color} />}
      {shape === 'square' && <rect x={c - r * 0.9} y={c - r * 0.9} width={r * 1.8} height={r * 1.8} fill={color} />}
      {shape === 'triangle' && (
        <polygon points={`${c},${c - r * 1.15} ${c + r * 1.15},${c + r * 0.92} ${c - r * 1.15},${c + r * 0.92}`} fill={color} />
      )}
    </svg>
  );
}

/* --------------------------------------------------------------------------- */

interface PanelProps {
  spec: PanelSpec;
  xDomain: [number, number];
  showDates: boolean;
  stationIndex: Map<string, number>;
  yZoom: [number, number] | null;
  onZoom: (x: [number, number] | null, y: [number, number] | null) => void;
  onReset: () => void;
  formatDate: (iso: string) => string;
}

interface Hover {
  point: SeriesPoint;
  x: number;
  y: number;
}

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function Panel({ spec, xDomain, showDates, stationIndex, yZoom, onZoom, onReset, formatDate }: PanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  // `drag` state only draws the zoom box. The live coordinates live in a ref,
  // because pointer events can arrive faster than React re-renders - reading
  // state on release would then see a stale (empty) box and drop the zoom.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = size.w < 520;
  const pad = useMemo(
    () => ({
      top: 22,
      right: narrow ? 10 : 18,
      bottom: showDates ? (narrow ? 22 : 26) : 8,
      left: narrow ? 44 : 64,
    }),
    [narrow, showDates]
  );

  const compare = stationIndex.size > 0;

  const scales = useMemo(() => {
    if (size.w <= 0 || size.h <= 0) return null;
    const plotW = Math.max(1, size.w - pad.left - pad.right);
    const plotH = Math.max(1, size.h - pad.top - pad.bottom);
    const [x0, x1] = xDomain;

    // Auto-fit values to what is visible; a drawn zoom box overrides this.
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of spec.points) {
      if (p.timestamp < x0 || p.timestamp > x1) continue;
      if (p.value < lo) lo = p.value;
      if (p.value > hi) hi = p.value;
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    // Show a threshold only if it sits near the data - a limit far above the
    // readings would squash them into a flat band at the bottom.
    const span = Math.max(hi - lo, Math.abs(hi) * 0.1, 1e-6);
    const visibleThresholds = spec.thresholds.filter(
      (t) => t.value >= lo - span * 0.6 && t.value <= hi + span * 0.6
    );
    for (const t of visibleThresholds) {
      lo = Math.min(lo, t.value);
      hi = Math.max(hi, t.value);
    }

    const y = yZoom
      ? { lo: yZoom[0], hi: yZoom[1], step: niceScale(yZoom[0], yZoom[1]).step }
      : niceScale(spec.zeroBaseline ? Math.min(0, lo) : lo, hi);

    const xOf = (t: number) => pad.left + ((t - x0) / (x1 - x0)) * plotW;
    const yOf = (v: number) => pad.top + plotH - ((v - y.lo) / (y.hi - y.lo)) * plotH;
    const tOf = (px: number) => x0 + ((px - pad.left) / plotW) * (x1 - x0);
    const vOf = (py: number) => y.lo + ((pad.top + plotH - py) / plotH) * (y.hi - y.lo);

    const yTicks: number[] = [];
    const first = Math.ceil(y.lo / y.step) * y.step;
    for (let v = first; v <= y.hi + y.step / 1000; v += y.step) yTicks.push(Number(v.toFixed(10)));

    const tickCount = Math.max(2, Math.min(8, Math.floor(plotW / (narrow ? 90 : 120))));
    const xTicks = Array.from({ length: tickCount }, (_, i) => x0 + ((x1 - x0) * i) / (tickCount - 1));

    return { plotW, plotH, xOf, yOf, tOf, vOf, yTicks, xTicks, visibleThresholds, yLo: y.lo, yHi: y.hi };
  }, [size, pad, xDomain, spec, yZoom, narrow]);

  // Draw the readings.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scales || size.w <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top - 2, scales.plotW, scales.plotH + 4);
    ctx.clip();

    const [x0, x1] = xDomain;
    const visible = spec.points.filter(
      (p) => p.timestamp >= x0 && p.timestamp <= x1 && p.value >= scales.yLo && p.value <= scales.yHi
    );

    if (!compare) {
      const dense = visible.length > 900;
      const r = (dense ? 2.4 : 4.5) * (narrow ? 0.85 : 1);
      for (const pass of [false, true]) {
        ctx.fillStyle = pass ? ALERT : OK;
        ctx.globalAlpha = dense ? 0.5 : 0.75;
        ctx.beginPath();
        for (const p of visible) {
          if (p.exceeds !== pass) continue;
          drawMarker(ctx, 'circle', scales.xOf(p.timestamp), scales.yOf(p.value), r);
        }
        ctx.fill();
      }
    } else {
      const r = narrow ? 3.8 : 4.6;
      const byStation = new Map<number, SeriesPoint[]>();
      for (const p of spec.points) {
        const idx = p.stationId ? stationIndex.get(p.stationId) : undefined;
        if (idx === undefined) continue;
        const list = byStation.get(idx);
        if (list) list.push(p);
        else byStation.set(idx, [p]);
      }

      // Faint connecting line per station, broken across long gaps.
      for (const [idx, pts] of byStation) {
        const style = STATION_STYLES[idx];
        ctx.strokeStyle = style.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        let prev: SeriesPoint | null = null;
        for (const p of pts) {
          const px = scales.xOf(p.timestamp);
          const py = scales.yOf(p.value);
          if (prev && p.timestamp - prev.timestamp <= LINE_BREAK_MS) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          prev = p;
        }
        ctx.stroke();
      }

      for (const [idx, pts] of byStation) {
        const style = STATION_STYLES[idx];
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = style.color;
        ctx.beginPath();
        for (const p of pts) drawMarker(ctx, style.shape, scales.xOf(p.timestamp), scales.yOf(p.value), r);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Exceedances: a red ring on top of the station's marker.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ALERT;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (const p of visible) {
        if (!p.exceeds || !p.stationId || !stationIndex.has(p.stationId)) continue;
        const px = scales.xOf(p.timestamp);
        const py = scales.yOf(p.value);
        ctx.moveTo(px + r + 3, py);
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }, [scales, size, pad, spec, xDomain, compare, stationIndex, narrow]);

  /* -------------------- pointer: hover and box zoom -------------------- */

  const localPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clampToPlot = (x: number, y: number) =>
    scales
      ? {
          x: Math.max(pad.left, Math.min(pad.left + scales.plotW, x)),
          y: Math.max(pad.top, Math.min(pad.top + scales.plotH, y)),
        }
      : { x, y };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !scales) return;
    const { x, y } = clampToPlot(localPoint(e).x, localPoint(e).y);
    dragging.current = true;
    try {
      // Keeps the drag alive if the pointer leaves the panel mid-drag.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (some touch / synthetic inputs) - the drag still works */
    }
    dragRef.current = { x0: x, y0: y, x1: x, y1: y };
    setDrag(dragRef.current);
    setHover(null);
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scales) return;
      const raw = localPoint(e);

      if (dragging.current) {
        const { x, y } = clampToPlot(raw.x, raw.y);
        if (dragRef.current) {
          dragRef.current = { ...dragRef.current, x1: x, y1: y };
          setDrag(dragRef.current);
        }
        return;
      }

      const [x0, x1] = xDomain;
      let best: SeriesPoint | null = null;
      let bestD = 14 * 14;
      let bx = 0;
      let by = 0;
      for (const p of spec.points) {
        if (p.timestamp < x0 || p.timestamp > x1) continue;
        if (compare && (!p.stationId || !stationIndex.has(p.stationId))) continue;
        if (p.value < scales.yLo || p.value > scales.yHi) continue;
        const px = scales.xOf(p.timestamp);
        const py = scales.yOf(p.value);
        const d = (px - raw.x) ** 2 + (py - raw.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
          bx = px;
          by = py;
        }
      }
      setHover(best ? { point: best, x: bx, y: by } : null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scales, spec, xDomain, compare, stationIndex]
  );

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* was never captured */
    }
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !scales) return;

    const wide = Math.abs(d.x1 - d.x0) > 6;
    const tall = Math.abs(d.y1 - d.y0) > 6;
    if (!wide && !tall) return; // a click, not a drag

    const x: [number, number] | null = wide
      ? [scales.tOf(Math.min(d.x0, d.x1)), scales.tOf(Math.max(d.x0, d.x1))]
      : null;
    const y: [number, number] | null = tall
      ? [scales.vOf(Math.max(d.y0, d.y1)), scales.vOf(Math.min(d.y0, d.y1))]
      : null;
    onZoom(x, y);
  };

  const spanMs = xDomain[1] - xDomain[0];
  const style = hover?.point.stationId ? STATION_STYLES[stationIndex.get(hover.point.stationId) ?? -1] : undefined;
  const hasPoints = spec.points.some((p) => p.timestamp >= xDomain[0] && p.timestamp <= xDomain[1]);

  return (
    <div
      ref={wrapRef}
      className="relative min-h-[150px] flex-1 select-none"
      style={{ touchAction: 'pan-y', cursor: drag ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragging.current = false;
        dragRef.current = null;
        setDrag(null);
      }}
      onPointerLeave={() => !dragging.current && setHover(null)}
      onDoubleClick={onReset}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {scales && (
        <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden="true">
          <text x={pad.left} y={14} fill={AXIS} fontSize={narrow ? 10.5 : 12} fontWeight={600}>
            {spec.label}
            <tspan fontWeight={400} fill="#6B7A90">{` (${spec.unit})`}</tspan>
          </text>

          {scales.xTicks.map((t) => (
            <line key={`gx${t}`} x1={scales.xOf(t)} x2={scales.xOf(t)} y1={pad.top} y2={pad.top + scales.plotH} stroke={GRID} />
          ))}

          {scales.yTicks.map((v) => {
            const y = scales.yOf(v);
            return (
              <g key={`gy${v}`}>
                <line x1={pad.left} x2={pad.left + scales.plotW} y1={y} y2={y} stroke={GRID} strokeDasharray="2 4" />
                <text
                  x={pad.left - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  fill={AXIS}
                  fontSize={narrow ? 9.5 : 10.5}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {narrow ? compactTick(v) : fullTick(v)}
                </text>
              </g>
            );
          })}

          {scales.visibleThresholds.map((t) => {
            const y = scales.yOf(t.value);
            if (y < pad.top || y > pad.top + scales.plotH) return null;
            return (
              <g key={`th${t.value}`}>
                <line
                  x1={pad.left}
                  x2={pad.left + scales.plotW}
                  y1={y}
                  y2={y}
                  stroke={ALERT}
                  strokeOpacity={0.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={pad.left + scales.plotW - 3}
                  y={y - 3}
                  textAnchor="end"
                  fill={ALERT}
                  fillOpacity={0.8}
                  fontSize={narrow ? 9 : 10}
                >
                  {t.label}
                </text>
              </g>
            );
          })}

          <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + scales.plotH} stroke="#D0D3D4" />
          <line
            x1={pad.left}
            x2={pad.left + scales.plotW}
            y1={pad.top + scales.plotH}
            y2={pad.top + scales.plotH}
            stroke="#D0D3D4"
          />

          {showDates &&
            scales.xTicks.map((t, i) => (
              <text
                key={`tx${t}`}
                x={scales.xOf(t)}
                y={pad.top + scales.plotH + (narrow ? 14 : 17)}
                textAnchor={i === 0 ? 'start' : i === scales.xTicks.length - 1 ? 'end' : 'middle'}
                fill={AXIS}
                fontSize={narrow ? 9.5 : 10.5}
              >
                {formatTimeTick(t, spanMs)}
              </text>
            ))}

          {drag && (
            <rect
              x={Math.min(drag.x0, drag.x1)}
              y={Math.min(drag.y0, drag.y1)}
              width={Math.abs(drag.x1 - drag.x0)}
              height={Math.abs(drag.y1 - drag.y0)}
              fill="#00B4E5"
              fillOpacity={0.12}
              stroke="#0092BC"
              strokeDasharray="4 3"
            />
          )}

          {hover && (
            <circle
              cx={hover.x}
              cy={hover.y}
              r={8}
              fill="none"
              stroke={style?.color ?? (hover.point.exceeds ? ALERT : OK)}
              strokeWidth={2}
            />
          )}

          {!hasPoints && (
            <text x={pad.left + scales.plotW / 2} y={pad.top + scales.plotH / 2} textAnchor="middle" fill="#6B7A90" fontSize={12}>
              No {spec.label} readings in this range
            </text>
          )}
        </svg>
      )}

      {hover && !drag && (
        <div
          className="pointer-events-none absolute z-10 w-[190px] rounded-panel border border-cwa-silver bg-white px-3 py-2 text-[12px] shadow-panel"
          style={{
            left: Math.min(Math.max(hover.x + 12, 4), Math.max(size.w - 196, 4)),
            top: Math.min(Math.max(hover.y - 76, 4), Math.max(size.h - 120, 4)),
          }}
        >
          <p className="flex items-center gap-1.5 font-semibold text-cwa-deep">
            {style && <MarkerSwatch color={style.color} shape={style.shape} size={11} />}
            {hover.point.stationId ?? 'Station'}
          </p>
          {hover.point.stationName && <p className="truncate text-cwa-ink">{hover.point.stationName}</p>}
          <p className="mt-1 text-cwa-slate">{formatDate(hover.point.date)}</p>
          <p className="tnum mt-0.5 text-[13px] font-medium text-cwa-ink">
            {hover.point.value.toLocaleString('en-US', { maximumFractionDigits: spec.precision })}{' '}
            <span className="text-[11px] font-normal text-cwa-slate">{spec.unit}</span>
          </p>
          <p className={`mt-0.5 font-medium ${hover.point.exceeds ? 'text-status-alert' : 'text-status-ok'}`}>
            {hover.point.exceeds ? 'Exceedance' : 'Non Exceedance'}
          </p>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- */

export function StackedChart({
  panels,
  stations,
  dateRange,
  onDateRange,
  yZoom,
  onYZoom,
  formatDate,
}: Props) {
  const stationIndex = useMemo(() => new Map(stations.map((id, i) => [id, i])), [stations]);

  // Full extent across every panel, so all panels share identical dates.
  const fullDomain = useMemo<[number, number] | null>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const panel of panels) {
      for (const p of panel.points) {
        if (p.timestamp < lo) lo = p.timestamp;
        if (p.timestamp > hi) hi = p.timestamp;
      }
    }
    if (!Number.isFinite(lo)) return null;
    const pad = Math.max((hi - lo) * 0.02, 86_400_000);
    return [lo - pad, hi + pad];
  }, [panels]);

  const xDomain = dateRange ?? fullDomain;

  const reset = useCallback(() => {
    onYZoom({});
    onDateRange(null);
  }, [onDateRange, onYZoom]);

  if (!xDomain) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-cwa-slate">
        {stations.length
          ? 'None of the selected stations have readings for these parameters with the current filters.'
          : 'No readings match the current filters.'}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto">
      {panels.map((spec, i) => (
        <Panel
          key={spec.key}
          spec={spec}
          xDomain={xDomain}
          showDates={i === panels.length - 1}
          stationIndex={stationIndex}
          yZoom={yZoom[spec.key] ?? null}
          onZoom={(x, y) => {
            if (x) onDateRange(x);
            if (y) onYZoom({ ...yZoom, [spec.key]: y });
          }}
          onReset={reset}
          formatDate={formatDate}
        />
      ))}
    </div>
  );
}
