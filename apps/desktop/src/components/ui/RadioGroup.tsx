/**
 * RadioGroup — token-themed wrapper over @radix-ui/react-radio-group.
 *
 * Usage:
 *   <RadioGroup value={size} onValueChange={setSize}>
 *     <RadioGroup.Item value="sm" label="Small" />
 *     <RadioGroup.Item value="md" label="Medium" />
 *   </RadioGroup>
 */
import * as Radix from '@radix-ui/react-radio-group';
import type { ReactNode } from 'react';

interface RootProps {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
  /** Direction for the layout. */
  orientation?: 'vertical' | 'horizontal';
}

function Root({ value, onValueChange, children, orientation = 'vertical' }: RootProps) {
  return (
    <Radix.Root
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
      className={`flex ${orientation === 'horizontal' ? 'flex-row gap-3' : 'flex-col gap-2'}`}
    >
      {children}
    </Radix.Root>
  );
}

function Item({ value, label, disabled }: { value: string; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <Radix.Item
        value={value}
        disabled={disabled}
        className="h-[18px] w-[18px] rounded-full border transition-colors data-[state=checked]:border-[color:var(--color-accent)] disabled:opacity-40 cursor-pointer"
        style={{ borderColor: 'var(--color-border-strong)' }}
      >
        <Radix.Indicator className="flex h-full w-full items-center justify-center after:block after:h-[8px] after:w-[8px] after:rounded-full after:bg-[color:var(--color-accent)]" />
      </Radix.Item>
      <span className="text-[13px]" style={{ color: 'var(--color-fg)' }}>{label}</span>
    </label>
  );
}

export const RadioGroup = Object.assign(Root, { Item });
