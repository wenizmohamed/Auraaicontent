/**
 * AnimatedGradientBorder — wrapper that paints a slow rotating conic accent
 * around its content, masked to a 1.5px ring so the inner surface stays clean.
 *
 * Architecture: a single absolutely-positioned ::before pseudo-element holds
 * the conic-gradient and rotates via @keyframes. The element's own background
 * is the actual surface; the gradient peeks out only along the perimeter
 * thanks to padding + border-radius math.
 *
 * Tokens-only: gradient uses --color-accent + --color-accent-subtle. No raw
 * hex. The ring intensity is lifted slightly while the row is hovered (CSS
 * `:hover` on the wrapper changes the pseudo-element opacity).
 *
 * Reduced-motion: rotation is stopped, ring stays painted (so the visual
 * affordance is preserved without movement).
 */
import './animated-gradient-border.css';

interface AnimatedGradientBorderProps {
  children: React.ReactNode;
  /** Border radius — must match the inner surface so the ring stays even. */
  radius?: number;
  /** Ring thickness in px. */
  thickness?: number;
  /** Per-instance loop duration, seconds. */
  durationSec?: number;
  /** Inner surface bg (CSS var or color). Defaults to the elevated surface. */
  innerBg?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function AnimatedGradientBorder({
  children,
  radius = 16,
  thickness = 1.5,
  durationSec = 8,
  innerBg = 'var(--color-bg-elevated)',
  className = '',
  style,
}: AnimatedGradientBorderProps) {
  return (
    <div
      className={`radix-agb ${className}`}
      style={{
        ['--agb-radius' as any]: `${radius}px`,
        ['--agb-thickness' as any]: `${thickness}px`,
        ['--agb-duration' as any]: `${durationSec}s`,
        ['--agb-inner-bg' as any]: innerBg,
        ...style,
      }}
    >
      <div className="radix-agb-inner">{children}</div>
    </div>
  );
}

export default AnimatedGradientBorder;
