/**
 * Toggle — token-themed wrapper over @radix-ui/react-toggle. A single
 * pressable on/off button (vs Switch which is a labeled control).
 *
 * Usage:
 *   <Toggle pressed={bold} onPressedChange={setBold} aria-label="Bold">
 *     <Bold size={14} />
 *   </Toggle>
 */
import * as Radix from '@radix-ui/react-toggle';
import type { ReactNode } from 'react';

interface Props {
  pressed: boolean;
  onPressedChange: (v: boolean) => void;
  'aria-label': string;
  children: ReactNode;
  size?: 'sm' | 'md';
}

export function Toggle({ pressed, onPressedChange, children, size = 'md', ...rest }: Props) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-[12px]';
  return (
    <Radix.Root
      pressed={pressed}
      onPressedChange={onPressedChange}
      {...rest}
      className={`inline-flex items-center justify-center rounded-md border transition-colors data-[state=on]:border-[color:var(--color-accent)] data-[state=on]:bg-[color:var(--color-accent-subtle)] data-[state=on]:text-[color:var(--color-accent)] data-[state=off]:border-[color:var(--color-border)] data-[state=off]:text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-surface-hover)] cursor-pointer ${dim}`}
    >
      {children}
    </Radix.Root>
  );
}
