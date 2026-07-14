// Updates ticker — a stock-market-style scrolling ribbon across the top of the
// Dashboard that highlights the latest product updates, improvements and fixes
// (2026-07-14, Weni request). Reuses the What's New changelog data; seamless
// loop via two identical tracks (CSS marquee in index.css), pauses on hover,
// disabled under prefers-reduced-motion. Hidden if there are no entries.

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { changelogApi, type ChangelogEntry } from '../lib/backend-api';

const TAG_STYLE: Record<ChangelogEntry['tag'], { label: string; color: string; bg: string }> = {
  new:      { label: 'NEW',      color: 'var(--color-success)', bg: 'var(--color-success-subtle)' },
  improved: { label: 'IMPROVED', color: 'var(--color-info)',    bg: 'var(--color-info-subtle)' },
  fixed:    { label: 'FIXED',    color: 'var(--color-accent)',  bg: 'var(--color-accent-subtle)' },
};

export default function UpdatesTicker() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);

  useEffect(() => {
    changelogApi.list(12).then(({ entries }) => setEntries(entries || [])).catch(() => { /* stays hidden */ });
  }, []);

  if (!entries.length) return null;

  // One rendered run of all items; duplicated below for the seamless -50% loop.
  const Item = ({ e, i }: { e: ChangelogEntry; i: number }) => {
    const ts = TAG_STYLE[e.tag] || TAG_STYLE.new;
    return (
      <span key={i} className="inline-flex items-center gap-2 px-5 shrink-0" aria-hidden={i >= entries.length}>
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: ts.color, background: ts.bg }}
        >
          {ts.label}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-fg)' }}>{e.title}</span>
        <span className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>·</span>
      </span>
    );
  };

  const run = entries.map((e, i) => <Item key={i} e={e} i={i} />);

  return (
    <div
      className="radix-ticker-viewport relative flex items-stretch overflow-hidden rounded-xl border"
      style={{ background: 'var(--color-bg-subtle)', borderColor: 'var(--color-border-subtle)' }}
      role="marquee"
      aria-label="Latest product updates"
    >
      {/* Fixed leading label — the "exchange" tag */}
      <div
        className="flex items-center gap-2 px-4 shrink-0 z-10 border-r"
        style={{ background: 'var(--color-accent-subtle)', borderColor: 'var(--color-border-subtle)' }}
      >
        <Megaphone className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} />
        <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline" style={{ color: 'var(--color-accent)' }}>
          What's New
        </span>
      </div>
      {/* Scrolling viewport with a soft fade on both edges */}
      <div className="relative flex-1 overflow-hidden py-2">
        <div className="radix-ticker-track">
          <span className="inline-flex shrink-0">{run}</span>
          <span className="inline-flex shrink-0" aria-hidden="true">{entries.map((e, i) => <Item key={`dup-${i}`} e={e} i={i + entries.length} />)}</span>
        </div>
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8" style={{ background: 'linear-gradient(to right, var(--color-bg-subtle), transparent)' }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8" style={{ background: 'linear-gradient(to left, var(--color-bg-subtle), transparent)' }} />
      </div>
    </div>
  );
}
