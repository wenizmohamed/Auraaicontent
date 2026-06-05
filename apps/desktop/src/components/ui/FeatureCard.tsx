// FeatureCard — the shared "21st feature-section" atom used across the app's
// enhancement sweep. A bento-style card: icon (masked-grid decorator or inline) +
// title + description + optional illustration/children, with a staggered reveal,
// hover-lift, and an optional rotating accent ring (`glow`) for featured/active
// items. Token-only, RTL-safe (logical text-start, no hard left/right),
// focus-visible ring + role=button when clickable, motion via lib/motion presets
// (reduced-motion handled globally by MotionConfig + AnimatedGradientBorder).

import type { ComponentType, ReactNode, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { AnimatedGradientBorder } from './AnimatedGradientBorder';
import { MaskedGridIcon } from './MaskedGridIcon';
import { motionUI } from '../../lib/motion';

interface FeatureCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Wrap in a rotating accent ring — reserve for featured/active items. */
  glow?: boolean;
  /** Accent border + tint (selected state). */
  active?: boolean;
  /** Use the masked-grid icon decorator instead of a small inline icon. */
  decorator?: boolean;
  /** Optional illustration / preview slot (can use group-hover for tilt). */
  illustration?: ReactNode;
  onClick?: () => void;
  /** Stagger index for the reveal delay. */
  index?: number;
  className?: string;
  children?: ReactNode;
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
  glow = false,
  active = false,
  decorator = false,
  illustration,
  onClick,
  index = 0,
  className = '',
  children,
}: FeatureCardProps) {
  const clickable = !!onClick;

  const inner = (
    <div className={`group relative h-full rounded-2xl p-5 text-start ${className}`}
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid',
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        boxShadow: active ? '0 0 0 1px var(--color-accent), 0 8px 24px -10px color-mix(in srgb, var(--color-accent) 35%, transparent)' : undefined,
      }}
    >
      {/* accent radial depth (matches BentoTile / shell language) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{ background: 'radial-gradient(circle at 0% 0%, var(--color-accent-subtle), transparent 55%)', opacity: active ? 1 : 0.5 }} />
      <div className="relative">
        {decorator ? (
          <MaskedGridIcon icon={Icon} className="mb-3" />
        ) : (
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl mb-3"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)' }}>
            <Icon className="w-4 h-4" />
          </span>
        )}
        <h3 className="text-sm font-bold" style={{ color: 'var(--color-fg)' }}>{title}</h3>
        {description && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>{description}</p>}
        {illustration}
        {children}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      whileHover={{ y: -3 }}
      transition={{ ...motionUI, delay: Math.min(index, 8) * 0.05 }}
      {...(clickable
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } },
            className: 'cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
          }
        : {})}
    >
      {glow ? (
        <AnimatedGradientBorder radius={16} thickness={1.5} innerBg="var(--color-bg-elevated)">
          {inner}
        </AnimatedGradientBorder>
      ) : inner}
    </motion.div>
  );
}

export default FeatureCard;
