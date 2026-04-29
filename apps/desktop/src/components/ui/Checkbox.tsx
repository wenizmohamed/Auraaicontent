/**
 * Checkbox — token-themed wrapper over @radix-ui/react-checkbox.
 *
 * Usage:
 *   <Checkbox checked={agreed} onCheckedChange={setAgreed} label="I agree" />
 */
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ checked, onCheckedChange, label, disabled, id }: Props) {
  const Root = (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      className="flex h-[18px] w-[18px] items-center justify-center rounded-md border transition-colors data-[state=checked]:border-[color:var(--color-accent)] data-[state=checked]:bg-[color:var(--color-accent)] disabled:opacity-40 cursor-pointer"
      style={{ borderColor: 'var(--color-border-strong)' }}
    >
      <RadixCheckbox.Indicator>
        <Check size={12} style={{ color: 'var(--color-fg-on-accent)' }} strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
  if (!label) return Root;
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer" htmlFor={id}>
      {Root}
      <span className="text-[13px]" style={{ color: 'var(--color-fg)' }}>{label}</span>
    </label>
  );
}
