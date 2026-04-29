/**
 * Badge — small inline status pill. 6 token-driven tones.
 *
 * Usage:
 *   <Badge tone="success">Approved</Badge>
 *   <Badge tone="warning" subtle>Draft</Badge>
 */
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

interface Props {
  tone?: Tone;
  /** Filled (default) or subtle (token-tinted bg + token color). */
  subtle?: boolean;
  children: ReactNode;
}

const SOLID: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-active)',  fg: 'var(--color-fg)' },
  accent:  { bg: 'var(--color-accent)',          fg: 'var(--color-fg-on-accent)' },
  success: { bg: 'var(--color-success)',         fg: 'var(--color-fg-on-accent)' },
  warning: { bg: 'var(--color-warning)',         fg: 'var(--color-fg-on-accent)' },
  danger:  { bg: 'var(--color-danger)',          fg: 'var(--color-fg-on-accent)' },
  info:    { bg: 'var(--color-info)',            fg: 'var(--color-fg-on-accent)' },
};

const SUBTLE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-hover)',   fg: 'var(--color-fg-muted)' },
  accent:  { bg: 'var(--color-accent-subtle)',   fg: 'var(--color-accent)' },
  success: { bg: 'var(--color-success-subtle)',  fg: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-subtle)',  fg: 'var(--color-warning)' },
  danger:  { bg: 'var(--color-danger-subtle)',   fg: 'var(--color-danger)' },
  info:    { bg: 'var(--color-info-subtle)',     fg: 'var(--color-info)' },
};

export function Badge({ tone = 'neutral', subtle = false, children }: Props) {
  const palette = (subtle ? SUBTLE : SOLID)[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {children}
    </span>
  );
}
