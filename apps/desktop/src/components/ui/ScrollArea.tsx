/**
 * ScrollArea — token-themed wrapper over @radix-ui/react-scroll-area.
 * Use when you want consistent custom scrollbars across browsers (the
 * native ones look different on Windows / macOS / Linux).
 */
import * as Radix from '@radix-ui/react-scroll-area';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  /** Max height — defaults to 100% of parent. */
  maxHeight?: number | string;
}

export function ScrollArea({ children, className = '', maxHeight }: Props) {
  return (
    <Radix.Root
      className={`relative overflow-hidden ${className}`}
      style={{ maxHeight }}
    >
      <Radix.Viewport className="h-full w-full">{children}</Radix.Viewport>
      <Radix.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5"
      >
        <Radix.Thumb
          className="relative flex-1 rounded-full"
          style={{ background: 'var(--color-border-strong)' }}
        />
      </Radix.Scrollbar>
      <Radix.Corner />
    </Radix.Root>
  );
}
