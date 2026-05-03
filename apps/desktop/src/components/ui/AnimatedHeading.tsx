/**
 * AnimatedHeading — line-by-line shimmer-reveal for editorial display copy.
 *
 * Each line slides up + fades in with a sweeping accent shimmer that exits to
 * the right. Designed for the Login brand panel ("Generate. / Schedule. / Ship.")
 * but generic enough for any hero wordmark.
 *
 * Reduced-motion: collapses to a single static fade-in (no clip-path sweep,
 * no per-line stagger). Layout is preserved across both modes.
 */
import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { motionHero, prefersReducedMotion } from '../../lib/motion';

interface AnimatedHeadingProps {
  /** Each entry renders as its own line. */
  lines: string[];
  /** Tailwind/CSS class for the heading element. */
  className?: string;
  /** Inline style passed to the heading. */
  style?: React.CSSProperties;
  /** Stagger between lines, in seconds. */
  stagger?: number;
  /** Delay before the first line starts, in seconds. */
  delay?: number;
}

export function AnimatedHeading({
  lines,
  className = '',
  style,
  stagger = 0.18,
  delay = 0.1,
}: AnimatedHeadingProps) {
  const reduce = useMemo(() => prefersReducedMotion(), []);

  return (
    <h2 className={className} style={style}>
      {lines.map((line, i) => (
        <span
          key={`${i}-${line}`}
          className="block overflow-hidden"
          style={{ paddingBottom: '0.04em' }}
        >
          <motion.span
            className="relative inline-block"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: '0.6em' }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ ...motionHero, delay: delay + i * stagger }}
          >
            {line}
            {!reduce && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                initial={{ x: '-110%' }}
                animate={{ x: '110%' }}
                transition={{
                  duration: 0.95,
                  ease: [0.16, 1, 0.3, 1],
                  delay: delay + i * stagger + 0.18,
                }}
                style={{
                  background:
                    'linear-gradient(110deg, transparent 30%, var(--color-accent-subtle) 50%, transparent 70%)',
                  mixBlendMode: 'screen',
                }}
              />
            )}
          </motion.span>
        </span>
      ))}
    </h2>
  );
}

export default AnimatedHeading;
