// MaskedGridIcon — the 21st.dev "CardDecorator" pattern: an icon chip sitting on
// a faint grid pattern that fades out via a radial mask. Token-only (grid uses
// --color-border-strong, chip uses --color-accent), theme-aware, RTL-neutral
// (centered + symmetric), decorative (aria-hidden). No motion → reduced-motion safe.

import type { ComponentType } from 'react';

interface MaskedGridIconProps {
  icon: ComponentType<{ className?: string }>;
  /** Decorator square size in px. */
  size?: number;
  /** Icon chip size in px. */
  chip?: number;
  className?: string;
}

export function MaskedGridIcon({ icon: Icon, size = 112, chip = 48, className = '' }: MaskedGridIconProps) {
  const mask = 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 58%, transparent 100%)';
  return (
    <div
      aria-hidden
      className={`relative mx-auto ${className}`}
      style={{ width: size, height: size, maskImage: mask, WebkitMaskImage: mask }}
    >
      {/* faint grid */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.14,
          backgroundImage:
            'linear-gradient(to right, var(--color-border-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border-strong) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      {/* center icon chip */}
      <div
        className="absolute inset-0 m-auto flex items-center justify-center rounded-xl border"
        style={{
          width: chip,
          height: chip,
          color: 'var(--color-accent)',
          background: 'var(--color-accent-subtle)',
          borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
        }}
      >
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}

export default MaskedGridIcon;
