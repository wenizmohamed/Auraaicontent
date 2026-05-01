/**
 * BentoGrid — editorial bento layout with hairline borders + hover lift.
 *
 * Drop-in wrapper for dashboard tile clusters. Replaces ad-hoc
 * `rounded-2xl border bg-white/[0.03]` blocks with a single primitive
 * that themes through semantic tokens (--color-surface, --color-border-subtle)
 * and gives every tile a quiet 1px hover treatment.
 *
 * Usage:
 *   <BentoGrid columns={12}>
 *     <BentoTile colSpan={4} accent>...</BentoTile>
 *     <BentoTile colSpan={8}>...</BentoTile>
 *   </BentoGrid>
 */
import type { ReactNode, CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { motionUI } from '../../lib/motion';

interface BentoGridProps {
  children: ReactNode;
  columns?: 6 | 12;
  gap?: 'tight' | 'base' | 'loose';
  className?: string;
}

export function BentoGrid({ children, columns = 12, gap = 'base', className = '' }: BentoGridProps) {
  const gapCls = gap === 'tight' ? 'gap-3' : gap === 'loose' ? 'gap-6' : 'gap-4';
  const colsCls = columns === 6 ? 'grid-cols-6' : 'grid-cols-12';
  return <div className={`grid ${colsCls} ${gapCls} ${className}`}>{children}</div>;
}

interface BentoTileProps {
  children: ReactNode;
  /** Span on the desktop breakpoint (1-12 if grid columns=12). Mobile is always full-width. */
  colSpan?: number;
  /** Vertical span (rare; default 1). */
  rowSpan?: number;
  /** Subtle accent treatment for "primary" tiles (faint accent radial). */
  accent?: boolean;
  /** Disable hover lift (use for non-interactive surfaces). */
  static?: boolean;
  /** Inner padding tier. */
  pad?: 'sm' | 'base' | 'lg';
  className?: string;
  style?: CSSProperties;
  /** Optional click handler — adds cursor-pointer + keyboard focus styles. */
  onClick?: () => void;
}

/** Static class lookups — Tailwind JIT only scans literal strings, never template-derived ones. */
const COL_SPAN_CLS: Record<number, string> = {
  1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4',
  5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 8: 'lg:col-span-8',
  9: 'lg:col-span-9', 10: 'lg:col-span-10', 11: 'lg:col-span-11', 12: 'lg:col-span-12',
};
const ROW_SPAN_CLS: Record<number, string> = {
  1: 'lg:row-span-1', 2: 'lg:row-span-2', 3: 'lg:row-span-3', 4: 'lg:row-span-4',
};

export function BentoTile({
  children,
  colSpan = 12,
  rowSpan,
  accent = false,
  static: isStatic = false,
  pad = 'base',
  className = '',
  style,
  onClick,
}: BentoTileProps) {
  const padCls = pad === 'sm' ? 'p-4' : pad === 'lg' ? 'p-6' : 'p-5';
  const colCls = `col-span-12 ${COL_SPAN_CLS[colSpan] ?? 'lg:col-span-12'}`;
  const rowCls = rowSpan ? (ROW_SPAN_CLS[rowSpan] ?? '') : '';
  const interactive = onClick != null;

  return (
    <motion.div
      transition={motionUI}
      whileHover={isStatic ? undefined : { y: -1 }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
      className={`relative overflow-hidden rounded-2xl border ${padCls} ${colCls} ${rowCls} ${interactive ? 'cursor-pointer' : ''} ${className}`}
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
        transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
        ...style,
      }}
      onMouseEnter={isStatic ? undefined : (e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--color-border)';
        el.style.boxShadow = '0 1px 0 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.5)';
      }}
      onMouseLeave={isStatic ? undefined : (e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--color-border-subtle)';
        el.style.boxShadow = 'none';
      }}
    >
      {accent && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: 'radial-gradient(circle at 0% 0%, var(--color-accent-subtle), transparent 55%)',
          }}
        />
      )}
      <div className="relative">{children}</div>
    </motion.div>
  );
}

export default BentoGrid;
