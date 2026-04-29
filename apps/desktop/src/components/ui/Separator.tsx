/**
 * Separator — token-driven horizontal/vertical divider. Hairline by default.
 */
import * as RadixSeparator from '@radix-ui/react-separator';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  /** "subtle" matches the editorial hairline style; "strong" for emphasis. */
  weight?: 'subtle' | 'strong';
  className?: string;
}

export function Separator({ orientation = 'horizontal', weight = 'subtle', className = '' }: Props) {
  const color = weight === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  return (
    <RadixSeparator.Root
      orientation={orientation}
      decorative
      className={className}
      style={{
        background: color,
        ...(orientation === 'horizontal' ? { height: 1, width: '100%' } : { width: 1, height: '100%' }),
      }}
    />
  );
}
