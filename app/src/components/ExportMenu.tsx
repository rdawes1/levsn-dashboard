'use client';

import { useState, type RefObject } from 'react';
import { toPng } from 'html-to-image';
import { toCsv } from '@/lib/format';
import type { CsvPayload } from '@/lib/exports';
import { useDashboard } from '@/store/useDashboard';

interface Props {
  /** The panel captured when exporting a PNG. */
  targetRef: RefObject<HTMLElement | null>;
  /** Filename stem, e.g. "levsn-by-basin-2025". */
  filename: string;
  /** Supplies the current view's tabular data at click time. */
  getCsv: () => CsvPayload | null;
}

/**
 * Browsers refuse to rasterise beyond roughly this height, and a PNG that tall
 * is unreadable anyway. Past it, PDF is offered instead.
 */
const PNG_MAX_HEIGHT = 12000;

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportMenu({ targetRef, filename, getCsv }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const setExportMode = useDashboard((s) => s.setExportMode);

  /** Renders every row, runs `fn`, then restores the paged view. */
  async function withFullTable<T>(fn: () => Promise<T>): Promise<T> {
    setExportMode(true);
    // Two frames so React commits the expanded table before it is captured.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    try {
      return await fn();
    } finally {
      setExportMode(false);
    }
  }

  async function exportPng() {
    if (!targetRef.current) return;
    setBusy('png');
    setNote(null);

    try {
      await withFullTable(async () => {
        const node = targetRef.current;
        if (!node) return;

        const height = node.scrollHeight;
        if (height > PNG_MAX_HEIGHT) {
          setNote(
            `This table is ${height.toLocaleString()}px tall — too long for a usable image. Use PDF, or narrow the filters.`
          );
          return;
        }

        const dataUrl = await toPng(node, {
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          cacheBust: true,
          width: node.scrollWidth,
          height,
          filter: (n) => !(n instanceof HTMLElement && n.dataset.exportIgnore === 'true'),
        });
        download(dataUrl, `${filename}.png`);
        setOpen(false);
      });
    } catch (e) {
      console.error('PNG export failed', e);
      setNote('Could not render the image. Try PDF instead.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Print to PDF. The right tool for long tables: the browser paginates,
   * repeats table headers on every page, and has no canvas size limit.
   */
  async function exportPdf() {
    setBusy('pdf');
    setNote(null);
    try {
      await withFullTable(async () => {
        setOpen(false);
        await new Promise((r) => setTimeout(r, 60));
        window.print();
        // Give the print dialog a moment before the table collapses again.
        await new Promise((r) => setTimeout(r, 600));
      });
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const data = getCsv();
    if (!data) return;
    setBusy('csv');
    const blob = new Blob([toCsv(data.headers, data.rows)], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    download(url, `${filename}.csv`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBusy(null);
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNote('Link copied.');
      setTimeout(() => setNote(null), 1800);
    } catch {
      /* clipboard unavailable - the URL bar already holds the state */
    }
  }

  return (
    <div className="relative" data-export-ignore="true">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-cwa-silver px-2.5 py-1.5
                   text-[12px] font-medium text-cwa-slate transition-colors
                   hover:border-cwa-cyan hover:text-cwa-deep"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1.5v8m0 0L5 6.5M8 9.5l3-3M2.5 11v2.5h11V11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Export
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-panel border border-cwa-silver bg-white shadow-panel">
            <button
              onClick={() => void exportCsv()}
              disabled={busy !== null}
              className="block w-full px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist disabled:opacity-50"
            >
              <span className="font-medium text-cwa-ink">Download CSV</span>
              <span className="block text-[11px] text-cwa-slate">
                This tab&rsquo;s table, filtered, all rows
              </span>
            </button>

            <button
              onClick={() => void exportPdf()}
              disabled={busy !== null}
              className="block w-full border-t border-cwa-mist px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist disabled:opacity-50"
            >
              <span className="font-medium text-cwa-ink">
                {busy === 'pdf' ? 'Preparing…' : 'Print / Save as PDF'}
              </span>
              <span className="block text-[11px] text-cwa-slate">
                Best for long tables &mdash; paginated, headers repeat
              </span>
            </button>

            <button
              onClick={() => void exportPng()}
              disabled={busy !== null}
              className="block w-full border-t border-cwa-mist px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist disabled:opacity-50"
            >
              <span className="font-medium text-cwa-ink">
                {busy === 'png' ? 'Rendering…' : 'Download PNG'}
              </span>
              <span className="block text-[11px] text-cwa-slate">
                Best for the map and chart
              </span>
            </button>

            <button
              onClick={() => void copyLink()}
              className="block w-full border-t border-cwa-mist px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist"
            >
              <span className="font-medium text-cwa-ink">Copy shareable link</span>
              <span className="block text-[11px] text-cwa-slate">Reopens these exact filters</span>
            </button>
          </div>
        </>
      )}

      {note && (
        <p className="absolute right-0 top-full z-40 mt-1 w-64 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
          {note}
        </p>
      )}
    </div>
  );
}
