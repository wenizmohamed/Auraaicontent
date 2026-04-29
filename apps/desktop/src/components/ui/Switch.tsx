/**
 * Switch — token-themed wrapper over @radix-ui/react-switch.
 *
 * Usage:
 *   <Switch checked={dark} onCheckedChange={setDark} label="Dark mode" />
 */
import * as RadixSwitch from '@radix-ui/react-switch';

interface Props {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, label, disabled }: Props) {
  const Root = (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-5 w-9 rounded-full transition-colors data-[state=checked]:bg-[color:var(--color-accent)] data-[state=unchecked]:bg-[color:var(--color-surface-active)] disabled:opacity-40 cursor-pointer"
    >
      <RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
  if (!label) return Root;
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      {Root}
      <span className="text-[13px]" style={{ color: 'var(--color-fg)' }}>{label}</span>
    </label>
  );
}
