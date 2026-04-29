/**
 * HoverCard — token-themed wrapper over @radix-ui/react-hover-card. Use
 * for rich on-hover previews (calendar day cells, asset thumbnails).
 * Tooltip-grade a11y but content can include images, captions, badges.
 *
 * Usage:
 *   <HoverCard.Root>
 *     <HoverCard.Trigger asChild><button>...</button></HoverCard.Trigger>
 *     <HoverCard.Content>...</HoverCard.Content>
 *   </HoverCard.Root>
 */
import * as RadixHover from '@radix-ui/react-hover-card';
import type { ReactNode } from 'react';

const Root = ({ children, openDelay = 220, closeDelay = 80 }: { children: ReactNode; openDelay?: number; closeDelay?: number }) => (
  <RadixHover.Root openDelay={openDelay} closeDelay={closeDelay}>{children}</RadixHover.Root>
);

const Trigger = RadixHover.Trigger;

function Content({ children, side = 'top', align = 'center', className = '' }: {
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <RadixHover.Portal>
      <RadixHover.Content
        side={side}
        align={align}
        sideOffset={8}
        className={`z-popover w-[280px] rounded-xl border p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] data-[state=open]:animate-in data-[state=closed]:animate-out ${className}`}
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-fg)',
        }}
      >
        {children}
        <RadixHover.Arrow style={{ fill: 'var(--color-bg-elevated)' }} />
      </RadixHover.Content>
    </RadixHover.Portal>
  );
}

export const HoverCard = { Root, Trigger, Content };
