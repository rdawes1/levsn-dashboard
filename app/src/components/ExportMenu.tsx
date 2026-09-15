'use client';

import { useState, type RefObject } from 'react';
import { toPng } from 'html-to-image';
import { toCsv } from '@/lib/format';

interface Props {
  /** The panel captured when exporting a PNG. */
  targetRef: RefObject<HTMLElement | null>;
  /** Filename stem, e.g. "levsn-by-basin-2025". */
  filename: string;
  /** Supplies the current view's tabular data at click time. */
  getCsv: () => { headers: string[]; rows: unknown[][] } | null;
}

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
  const [copied, setCopied] = useState(false);

  async function exportPng() {
    if (!targetRef.current) return;
    setBusy('png');
    try {
      const dataUrl = await toPng(targetRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
        // Leaflet tiles are cross-origin; skipping them avoids a tainted canvas.
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.exportIgnore === 'true'),
      });
      download(dataUrl, `${filename}.png`);
    } catch (e) {
      console.error('PNG export failed', e);
    } finally {
      setBusy(null);
      setOpen(false);
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
    URL.revokeObjectURL(url);
    setBusy(null);
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
          <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-panel border border-cwa-silver bg-white shadow-panel">
            <button
              onClick={exportPng}
              disabled={busy !== null}
              className="block w-full px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist disabled:opacity-50"
            >
              <span className="font-medium text-cwa-ink">
                {busy === 'png' ? 'Rendering…' : 'Download PNG'}
              </span>
              <span className="block text-[11px] text-cwa-slate">Current view, as shown</span>
            </button>
            <button
              onClick={exportCsv}
              disabled={busy !== null}
              className="block w-full border-t border-cwa-mist px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist disabled:opacity-50"
            >
              <span className="font-medium text-cwa-ink">Download CSV</span>
              <span className="block text-[11px] text-cwa-slate">Filtered underlying data</span>
            </button>
            <button
              onClick={copyLink}
              className="block w-full border-t border-cwa-mist px-3 py-2.5 text-left text-[12px] hover:bg-cwa-mist"
            >
              <span className="font-medium text-cwa-ink">
                {copied ? 'Link copied' : 'Copy shareable link'}
              </span>
              <span className="block text-[11px] text-cwa-slate">Reopens these exact filters</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
