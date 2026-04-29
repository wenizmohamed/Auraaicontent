/**
 * Motion presets — Phase 4.1 of the state-of-the-art interface plan.
 *
 * Two presets, one easing + duration vocabulary. Mirrors the CSS tokens
 * in `index.css` (--dur-* / --ease-*) so that JS-driven framer-motion
 * animations and CSS transitions stay in lockstep.
 *
 * Usage:
 *   import { motionUI, motionHero, durations, easings } from '@/lib/motion';
 *   <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={motionUI} />
 *
 * Rule (Phase 4 cleanup): no inline `transition={{ duration: 0.3 }}` anywhere.
 * Always use one of these presets, or build new ones HERE — never inline.
 */

import type { Transition, Variants } from 'framer-motion';

/** Duration tokens in seconds (framer-motion API), matching --dur-* CSS vars. */
export const durations = {
  instant: 0.08,
  fast:    0.14,
  base:    0.22,
  slow:    0.36,
} as const;

/** Easing curves matching --ease-* CSS vars. Cubic bezier control points. */
export const easings = {
  /** Decelerating, no overshoot. Default for chrome. */
  outExpo: [0.16, 1, 0.3, 1] as const,
  /** Light overshoot. Use for hero / wow moments only. */
  spring:  [0.34, 1.56, 0.64, 1] as const,
} as const;

/** Default UI motion — fast + decelerating. Use for chrome, hover, focus, tabs. */
export const motionUI: Transition = {
  duration: durations.fast,
  ease: easings.outExpo,
};

/** Hero motion — slow + spring. Use sparingly: empty-state landings, big reveals. */
export const motionHero: Transition = {
  duration: durations.slow,
  ease: easings.spring,
};

/** Base motion — middle ground. Use for content list reorders, panel resizes. */
export const motionBase: Transition = {
  duration: durations.base,
  ease: easings.outExpo,
};

/** Instant — barely-perceptible feedback. Use for active states, presses. */
export const motionInstant: Transition = {
  duration: durations.instant,
  ease: easings.outExpo,
};

// ── Common variant shapes ───────────────────────────────────────────────────

export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: motionUI },
  exit:    { opacity: 0, transition: motionInstant },
};

export const slideUp: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: motionUI },
  exit:    { opacity: 0, y: -4, transition: motionInstant },
};

export const slideDown: Variants = {
  hidden:  { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: motionUI },
  exit:    { opacity: 0, y: 4, transition: motionInstant },
};

export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: motionUI },
  exit:    { opacity: 0, scale: 0.98, transition: motionInstant },
};

/** Hero entrance — bigger displacement, spring landing. Use for feature reveals. */
export const heroIn: Variants = {
  hidden:  { opacity: 0, y: 24, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: motionHero },
  exit:    { opacity: 0, y: -12, transition: motionUI },
};

/**
 * Stagger helper for lists. Apply to a parent <motion.div>:
 *
 *   <motion.div variants={staggerChildren()} initial="hidden" animate="visible">
 *     {items.map(...)}
 *   </motion.div>
 */
export function staggerChildren(stagger = 0.04, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  };
}

// ── Reduced-motion guard ────────────────────────────────────────────────────

/**
 * Returns true if the user has requested reduced motion. Use to short-circuit
 * heavier animations to opacity-only transitions.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
