/**
 * MarqueeLogos — horizontally scrolling "trusted by" logo strip.
 *
 * Doubles the logo array and translates -50% over a long linear loop so the
 * seam between cycle 1 and cycle 2 is invisible. Hover pauses the loop.
 * Edge fade masks the scroll cut-off so the strip dissolves into the page bg
 * rather than terminating in a hard line.
 *
 * Logos are passed in as plain strings (agency names) — this is intentional:
 * we render them in Bodoni so the "trusted by" lockup matches the editorial
 * signature rather than the generic logo-soup look. Real raster logos can be
 * dropped in later by passing JSX nodes.
 *
 * Reduced-motion: stops the marquee, falls back to a single static row of
 * the first 6 logos (no clip).
 */
import { useMemo } from 'react';
import { prefersReducedMotion } from '../../lib/motion';
import './marquee.css';

interface MarqueeLogosProps {
  /** Logo content — strings (rendered in Bodoni) or arbitrary JSX. */
  items: (string | React.ReactNode)[];
  /** Optional eyebrow label above the strip. */
  label?: string;
  /** Loop duration in seconds. Slower = calmer. */
  durationSec?: number;
  /** Direction of travel. */
  direction?: 'left' | 'right';
}

export function MarqueeLogos({
  items,
  label,
  durationSec = 38,
  direction = 'left',
}: MarqueeLogosProps) {
  const reduce = useMemo(() => prefersReducedMotion(), []);
  const doubled = useMemo(() => [...items, ...items], [items]);

  return (
    <div className="w-full">
      {label ? (
        <p
          className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.32em]"
          style={{ color: 'var(--color-fg-subtle)' }}
        >
          {label}
        </p>
      ) : null}

      <div
        className="radix-marquee-frame"
        style={{
          // Hard masks fade the edges into the surrounding bg so the strip
          // doesn't end in a visible cut. Same gradient on both sides.
          maskImage:
            'linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%)',
        }}
      >
        {reduce ? (
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-2">
            {items.slice(0, 6).map((item, i) => (
              <Logo key={i} content={item} />
            ))}
          </div>
        ) : (
          <div
            className="radix-marquee-track"
            style={{
              animationDuration: `${durationSec}s`,
              animationDirection: direction === 'left' ? 'normal' : 'reverse',
            }}
          >
            {doubled.map((item, i) => (
              <Logo key={i} content={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Logo({ content }: { content: string | React.ReactNode }) {
  if (typeof content === 'string') {
    return (
      <span
        className="font-display whitespace-nowrap text-[18px] font-semibold tracking-tight"
        style={{ color: 'var(--color-fg-muted)', opacity: 0.7 }}
      >
        {content}
      </span>
    );
  }
  return <span className="inline-flex items-center">{content}</span>;
}

export default MarqueeLogos;
