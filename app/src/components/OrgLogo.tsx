import manifest from '@/lib/logos.generated.json';

/**
 * Monitoring organisation logo, from the standardised set in public/logos
 * (see scripts/logos.py). Logos are pre-scaled to equal visual weight, so a
 * single scale factor keeps a wordmark and a round badge looking balanced.
 *
 * Always sits on white: several logos have white artwork that would vanish if
 * their backgrounds were knocked out. Organisations without a logo get a quiet
 * text badge instead, so every placement still names who monitors.
 */

type Entry = { src: string; width: number; height: number };
const LOGOS = manifest as Record<string, Entry>;

// Match on a normalised name so stray whitespace or case in Airtable doesn't break it.
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const BY_NAME = new Map(Object.entries(LOGOS).map(([name, entry]) => [norm(name), entry]));

export function hasLogo(org: string | null | undefined): boolean {
  return Boolean(org && BY_NAME.has(norm(org)));
}

/** Display factor applied to the 2x source: sm ≈ 30px tall at most, md ≈ 44px. */
const SCALE = { sm: 0.29, md: 0.42 };

export function OrgLogo({
  org,
  size = 'sm',
  className = '',
}: {
  org: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!org) return null;
  const entry = BY_NAME.get(norm(org));

  if (!entry) {
    return (
      <span
        title={org}
        className={`inline-flex max-w-[180px] items-center truncate rounded border border-cwa-silver bg-white px-1.5 text-[10px] font-medium leading-5 text-cwa-slate ${className}`}
      >
        {org.trim()}
      </span>
    );
  }

  const w = Math.round(entry.width * SCALE[size]);
  const h = Math.round(entry.height * SCALE[size]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.src}
      width={w}
      height={h}
      alt={org.trim()}
      title={org.trim()}
      loading="lazy"
      decoding="async"
      className={`inline-block shrink-0 object-contain ${className}`}
      style={{ width: w, height: h }}
    />
  );
}
