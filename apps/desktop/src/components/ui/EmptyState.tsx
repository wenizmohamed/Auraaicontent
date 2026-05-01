/**
 * EmptyState — standardized empty-surface primitive.
 *
 * Replaces the ad-hoc per-page "no clients yet" / "no items yet" blocks
 * with a single editorial-tier moment: icon in an accent-tinted square,
 * display-font title, muted description, primary CTA, optional secondary.
 *
 * Token-driven so it themes correctly across dark / light / studio.
 * Animated entry via the Phase 4.1 motionHero preset.
 */
import { useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { heroIn } from '../../lib/motion';

interface Props {
  /** Lucide icon component, or any ComponentType with a className prop. */
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  /** Headline. Renders in the display serif at lg size. */
  title: string;
  /** One-sentence description. Muted. Max ~60ch. */
  description?: string;
  /** Primary call-to-action. Pass a fully-rendered element (Button / Link). */
  primary?: ReactNode;
  /** Secondary action — typically a docs link. Renders as muted underline. */
  secondary?: ReactNode;
  /** Compact layout — smaller icon, less padding. */
  compact?: boolean;
  /** Optional inline SVG illustration above the icon. */
  illustration?: ReactNode;
  /**
   * Cursor-tracked spotlight highlight (Notion empty-page move).
   * Auto-disabled when prefers-reduced-motion is set.
   */
  spotlight?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  compact = false,
  illustration,
  spotlight = false,
}: Props) {
  const pad = compact ? 'p-8' : 'p-12';
  const iconBox = compact ? 'h-12 w-12' : 'h-16 w-16';
  const iconSize = compact ? 22 : 28;

  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const spotlightOn = spotlight && !reduceMotion;

  function trackPointer(e: React.MouseEvent<HTMLDivElement>) {
    if (!spotlightOn || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <motion.div
      ref={ref}
      variants={heroIn}
      initial="hidden"
      animate="visible"
      onMouseMove={trackPointer}
      onMouseLeave={() => setCoords(null)}
      className={`relative overflow-hidden rounded-2xl border text-center ${pad}`}
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      {/* Subtle radial highlight — editorial polish */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: 'radial-gradient(circle at 50% 0%, var(--color-accent-subtle), transparent 60%)',
        }}
      />

      {spotlightOn && coords && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-200"
          style={{
            background: `radial-gradient(360px circle at ${coords.x}px ${coords.y}px, var(--color-accent-subtle), transparent 45%)`,
            opacity: 0.55,
          }}
        />
      )}

      <div className="relative">
        {illustration && (
          <div className="mb-5 flex justify-center" aria-hidden>
            {illustration}
          </div>
        )}

        {Icon && (
          <div
            className={`mx-auto mb-4 flex items-center justify-center rounded-2xl ${iconBox}`}
            style={{
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent)',
            }}
            aria-hidden
          >
            <Icon size={iconSize} />
          </div>
        )}

        <h3
          className={`font-display ${compact ? 'text-lg' : 'text-xl'} font-bold tracking-tight mb-2`}
          style={{ color: 'var(--color-fg)' }}
        >
          {title}
        </h3>

        {description && (
          <p
            className={`${compact ? 'text-xs' : 'text-sm'} mx-auto leading-relaxed`}
            style={{ color: 'var(--color-fg-muted)', maxWidth: '52ch' }}
          >
            {description}
          </p>
        )}

        {(primary || secondary) && (
          <div className={`flex flex-wrap items-center justify-center gap-3 ${compact ? 'mt-4' : 'mt-6'}`}>
            {primary}
            {secondary}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Pre-styled primary action button matched to the editorial accent.
 * Consumers can pass their own Link/button instead — this is just a default.
 */
export function EmptyStateAction({
  children,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer"
      style={{
        background: 'var(--color-accent)',
        color: 'var(--color-fg-on-accent)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent)';
      }}
    >
      {children}
    </button>
  );
}
