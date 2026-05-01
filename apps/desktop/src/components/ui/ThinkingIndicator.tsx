/**
 * ThinkingIndicator — the "AI is thinking" affordance.
 *
 * Shimmering text that cycles through phrases ("Thinking", "Pulling context",
 * "Generating") with a moving gradient mask — the Cursor / v0 / Notion AI
 * loading aesthetic, replacing the generic 3-bouncing-dots loader.
 *
 * Reduced-motion safe: collapses to plain "Thinking…" text without animation.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface Props {
  /** Custom phrases to cycle through (default: 4 generic AI phrases). */
  phrases?: string[];
  /** Cycle interval in ms (default 1800). */
  interval?: number;
}

const DEFAULT_PHRASES = ['Thinking', 'Pulling context', 'Generating', 'Almost there'];

export function ThinkingIndicator({ phrases = DEFAULT_PHRASES, interval = 1800 }: Props) {
  const [idx, setIdx] = useState(0);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % phrases.length), interval);
    return () => clearInterval(id);
  }, [phrases.length, interval, reduceMotion]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Assistant ${phrases[idx]}`}
      className="flex items-center gap-2 rounded-2xl rounded-bl-sm border px-3.5 py-2.5"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      <motion.span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--color-accent)' }}
        animate={reduceMotion ? undefined : { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        key={idx}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.25 }}
        className={`text-[12px] font-medium ${reduceMotion ? '' : 'thinking-shimmer'}`}
        style={{
          color: 'var(--color-fg-muted)',
        }}
      >
        {phrases[idx]}
        <span aria-hidden>…</span>
      </motion.span>

      {/* Local shimmer keyframe — scoped to this component, no global CSS */}
      <style>{`
        @keyframes thinking-shimmer-slide {
          0%   { background-position: -120% 0; }
          100% { background-position: 220% 0; }
        }
        .thinking-shimmer {
          background: linear-gradient(
            90deg,
            var(--color-fg-muted) 0%,
            var(--color-fg-muted) 35%,
            var(--color-fg) 50%,
            var(--color-fg-muted) 65%,
            var(--color-fg-muted) 100%
          );
          background-size: 220% 100%;
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: thinking-shimmer-slide 2.4s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default ThinkingIndicator;
