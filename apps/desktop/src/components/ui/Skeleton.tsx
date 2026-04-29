/**
 * Skeleton — layout-stable loading placeholder. Replaces spinner-based
 * loading states across the app. The shimmer is driven by the .skeleton
 * CSS class in index.css, which uses semantic tokens so it themes with
 * dark / light / studio automatically.
 *
 * Use the primitive for ad-hoc shapes:
 *   <Skeleton width="60%" height={14} radius="sm" />
 *
 * Or use one of the pre-shaped variants for common patterns:
 *   <SkeletonText lines={3} />
 *   <SkeletonCard />
 *   <SkeletonRow />
 *   <SkeletonAvatar size={40} />
 */
import type { CSSProperties } from 'react';

type Radius = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const RADIUS_MAP: Record<Radius, string> = {
  none: '0',
  xs:   'var(--radius-xs)',
  sm:   'var(--radius-sm)',
  md:   'var(--radius-md)',
  lg:   'var(--radius-lg)',
  xl:   'var(--radius-xl)',
  '2xl':'var(--radius-2xl)',
  full: 'var(--radius-full)',
};

interface SkeletonProps {
  /** Width as CSS value (px / % / rem). Default: 100%. */
  width?: number | string;
  /** Height as CSS value. Default: 16. */
  height?: number | string;
  /** Token-mapped border radius. Default: md. */
  radius?: Radius;
  /** Animation delay in ms — useful for staggered grids. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

function toCss(v: number | string | undefined, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === 'number' ? `${v}px` : v;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = 'md',
  delay,
  className = '',
  style,
}: SkeletonProps) {
  return (
    <div
      role="presentation"
      aria-hidden
      className={`skeleton ${className}`}
      style={{
        width: toCss(width, '100%'),
        height: toCss(height, '16px'),
        borderRadius: RADIUS_MAP[radius],
        animationDelay: delay ? `${delay}ms` : undefined,
        ...style,
      }}
    />
  );
}

// ── Pre-shaped variants ────────────────────────────────────────────────────

/** Multiple text lines with realistic varied widths (last line ~60%). */
export function SkeletonText({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  className = '',
}: {
  lines?: number;
  lineHeight?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`} style={{ gap: `${gap}px` }} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? '60%' : '100%'}
          radius="sm"
          delay={i * 60}
        />
      ))}
    </div>
  );
}

/** Card-shaped block. Default ~stat-card sized. */
export function SkeletonCard({
  height = 120,
  className = '',
  delay,
}: {
  height?: number | string;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
        height: toCss(height, '120px'),
        padding: '16px',
      }}
      aria-hidden
    >
      <Skeleton width="40%" height={12} radius="sm" delay={delay} />
      <div style={{ height: 8 }} />
      <Skeleton width="70%" height={20} radius="sm" delay={(delay ?? 0) + 60} />
    </div>
  );
}

/** Avatar circle. */
export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius="full" />;
}

/** Horizontal row: avatar + 2 lines of text. List-item shaped. */
export function SkeletonRow({ className = '', delay }: { className?: string; delay?: number }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl border p-4 ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
      aria-hidden
    >
      <SkeletonAvatar size={36} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton width="35%" height={12} radius="sm" delay={delay} />
        <Skeleton width="55%" height={10} radius="sm" delay={(delay ?? 0) + 60} />
      </div>
    </div>
  );
}

/** Calendar-month-shaped grid: 7-col × 5-row of square cells. */
export function SkeletonCalendarGrid() {
  return (
    <div className="grid grid-cols-7 gap-2" aria-hidden>
      {Array.from({ length: 35 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square rounded-xl skeleton"
          style={{ animationDelay: `${(i % 7) * 40}ms` }}
        />
      ))}
    </div>
  );
}

/** Live region wrapper — call once per loading surface for screen readers. */
export function SkeletonAnnouncer({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" aria-busy className="sr-only">{label}</span>
  );
}
