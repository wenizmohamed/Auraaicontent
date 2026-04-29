/**
 * Select — token-themed wrapper over @radix-ui/react-select.
 *
 * Usage:
 *   <Select value={value} onValueChange={setValue} placeholder="Pick…">
 *     <Select.Item value="a">Apple</Select.Item>
 *     <Select.Item value="b">Banana</Select.Item>
 *   </Select>
 */
import * as Radix from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface RootProps {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  children: ReactNode;
  disabled?: boolean;
}

function Root({ value, onValueChange, placeholder, children, disabled }: RootProps) {
  return (
    <Radix.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Radix.Trigger
        className="inline-flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--color-surface-hover)] disabled:opacity-40 cursor-pointer"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-fg)',
          minWidth: 140,
        }}
      >
        <Radix.Value placeholder={placeholder} />
        <Radix.Icon><ChevronDown size={14} style={{ color: 'var(--color-fg-subtle)' }} /></Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={4}
          className="z-popover overflow-hidden rounded-lg border shadow-[0_8px_18px_rgba(0,0,0,0.25)]"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
        >
          <Radix.Viewport className="p-1">{children}</Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

function Item({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) {
  return (
    <Radix.Item
      value={value}
      disabled={disabled}
      className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-[color:var(--color-surface-hover)] data-[disabled]:opacity-40"
    >
      <Radix.ItemText>{children}</Radix.ItemText>
      <Radix.ItemIndicator><Check size={12} style={{ color: 'var(--color-accent)' }} /></Radix.ItemIndicator>
    </Radix.Item>
  );
}

export const Select = Object.assign(Root, { Item });
