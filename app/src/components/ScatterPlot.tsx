'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeriesPoint } from '@/lib/stats';

/**
 * Canvas scatter plot.
 *
 * An SVG scatter is the wrong primitive here: an unfiltered parameter is ~5,300
 * readings, and creating that many SVG nodes blocked the main thread for 873ms
 * every time the tab was opened. Canvas draws the same cloud in a few
 * milliseconds and alpha-blends overlapping points into a readable density.
 *
 * Axes, grid and labels stay in SVG above the canvas - there are only a few of
 * them, and they stay crisp and selectable.
 */

const PAD = { top: 10, right: 18, bottom: 44, left: 68 };
const OK = '#2E7D57';
const ALERT = '#B3261E';

interface Props {
  points: SeriesPoint[];
  yLabel: string;
  formatValue: (v: number) => string;
  formatDate: (iso: string) => string;
}

interface Hover {
  point: SeriesPoint;
  x: number;
  y: number;
}

/** "Nice" axis bounds so tick labels land on round numbers. */
function niceScale(min: number, max: number, ticks = 5): { lo: number; hi: number; step: number } {
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

export function ScatterPlot({ points, yLabel, formatValue, formatDate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);

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

  const scales = useMemo(() => {
    if (!points.length || size.w <= 0 || size.h <= 0) return null;

    const xs = points[0].timestamp;
    const xe = points[points.length - 1].timestamp;
    const xMin = xs;
    const xMax = xe > xs ? xe : xs + 86_400_000;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
      if (p.value < yMin) yMin = p.value;
      if (p.value > yMax) yMax = p.value;
    }
    const y = niceScale(Math.min(0, yMin), yMax);

    const plotW = Math.max(1, size.w - PAD.left - PAD.right);
    const plotH = Math.max(1, size.h - PAD.top - PAD.bottom);

    const xOf = (t: number) => PAD.left + ((t - xMin) / (xMax - xMin)) * plotW;
    const yOf = (v: number) => PAD.top + plotH - ((v - y.lo) / (y.hi - y.lo)) * plotH;

    const yTicks: number[] = [];
    for (let v = y.lo; v <= y.hi + y.step / 2; v += y.step) yTicks.push(Number(v.toFixed(10)));

    const xTicks = Array.from({ length: 6 }, (_, i) => Math.round(xMin + ((xMax - xMin) * i) / 5));

    return { xOf, yOf, xMin, xMax, yTicks, xTicks, plotW, plotH };
  }, [points, size]);

  // Draw the cloud.
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

    // Dense clouds get smaller, more transparent marks so structure stays visible.
    const dense = points.length > 900;
    const r = dense ? 2.6 : 5;
    const alpha = dense ? 0.5 : 0.75;

    // Non-exceedances first so exceedances read on top.
    for (const pass of [false, true]) {
      ctx.fillStyle = pass ? ALERT : OK;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const p of points) {
        if (p.exceeds !== pass) continue;
        const cx = scales.xOf(p.timestamp);
        const cy = scales.yOf(p.value);
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();

      if (!dense) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [points, scales, size]);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scales) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let best: SeriesPoint | null = null;
      let bestD = 14 * 14;
      let bx = 0;
      let by = 0;

      for (const p of points) {
        const cx = scales.xOf(p.timestamp);
        const cy = scales.yOf(p.value);
        const d = (cx - mx) ** 2 + (cy - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
          bx = cx;
          by = cy;
        }
      }

      setHover(best ? { point: best, x: bx, y: by } : null);
    },
    [points, scales]
  );

  if (!points.length) {
    return (
      <div ref={wrapRef} className="flex h-full w-full items-center justify-center">
        <p className="text-[13px] text-cwa-slate">No readings match the current filters.</p>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {scales && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={size.w}
          height={size.h}
          aria-hidden="true"
        >
          {/* horizontal grid + y ticks */}
          {scales.yTicks.map((v) => {
            const y = scales.yOf(v);
            return (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={size.w - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="#E9EAEB"
                  strokeDasharray="2 4"
                />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#3A4B64"
                  fontSize="11"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatValue(v)}
                </text>
              </g>
            );
          })}

          {/* x ticks */}
          {scales.xTicks.map((t, i) => {
            const x = scales.xOf(t);
            return (
              <text
                key={t}
                x={x}
                y={size.h - PAD.bottom + 18}
                textAnchor={i === 0 ? 'start' : i === scales.xTicks.length - 1 ? 'end' : 'middle'}
                fill="#3A4B64"
                fontSize="11"
              >
                {new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </text>
            );
          })}

          {/* axis lines */}
          <line
            x1={PAD.left}
            x2={size.w - PAD.right}
            y1={size.h - PAD.bottom}
            y2={size.h - PAD.bottom}
            stroke="#D0D3D4"
          />
          <line
            x1={PAD.left}
            x2={PAD.left}
            y1={PAD.top}
            y2={size.h - PAD.bottom}
            stroke="#D0D3D4"
          />

          <text
            x={size.w / 2}
            y={size.h - 6}
            textAnchor="middle"
            fill="#3A4B64"
            fontSize="11"
          >
            Collection Date
          </text>
          <text
            x={14}
            y={PAD.top + scales.plotH / 2}
            textAnchor="middle"
            fill="#3A4B64"
            fontSize="11"
            transform={`rotate(-90 14 ${PAD.top + scales.plotH / 2})`}
          >
            {yLabel}
          </text>

          {hover && (
            <circle
              cx={hover.x}
              cy={hover.y}
              r={7}
              fill="none"
              stroke={hover.point.exceeds ? ALERT : OK}
              strokeWidth={2}
            />
          )}
        </svg>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-panel border border-cwa-silver bg-white px-3 py-2 text-[12px] shadow-panel"
          style={{
            left: Math.min(Math.max(hover.x + 12, 4), Math.max(size.w - 190, 4)),
            top: Math.max(hover.y - 70, 4),
            width: 180,
          }}
        >
          <p className="font-semibold text-cwa-deep">{hover.point.stationId ?? 'Station'}</p>
          {hover.point.stationName && (
            <p className="truncate text-cwa-ink">{hover.point.stationName}</p>
          )}
          <p className="mt-1 text-cwa-slate">{formatDate(hover.point.date)}</p>
          <p className="tnum mt-0.5 text-[13px] font-medium text-cwa-ink">
            {formatValue(hover.point.value)}
          </p>
          <p
            className={`mt-0.5 font-medium ${
              hover.point.exceeds ? 'text-status-alert' : 'text-status-ok'
            }`}
          >
            {hover.point.exceeds ? 'Exceedance' : 'Non Exceedance'}
          </p>
        </div>
      )}
    </div>
  );
}
