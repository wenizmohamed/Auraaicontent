/**
 * Slider — token-themed wrapper over @radix-ui/react-slider. Single thumb
 * by default; pass an array to value for ranges.
 */
import * as Radix from '@radix-ui/react-slider';

interface Props {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, label }: Props) {
  return (
    <Radix.Root
      value={[value]}
      onValueChange={(v) => onValueChange(v[0] ?? 0)}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      className="relative flex h-5 w-full touch-none select-none items-center"
    >
      <Radix.Track
        className="relative h-1 grow rounded-full"
        style={{ background: 'var(--color-surface-active)' }}
      >
        <Radix.Range
          className="absolute h-full rounded-full"
          style={{ background: 'var(--color-accent)' }}
        />
      </Radix.Track>
      <Radix.Thumb
        className="block h-4 w-4 rounded-full border bg-white shadow-md transition-transform focus-visible:scale-110"
        style={{ borderColor: 'var(--color-accent)' }}
      />
    </Radix.Root>
  );
}
