/**
 * Tooltip — thin wrapper over @radix-ui/react-tooltip with token-driven
 * styling. Mount <TooltipProvider> once at App root; use <Tooltip>
 * inline anywhere a hover/keyboard hint helps. Free a11y from Radix
 * (focus + escape + ARIA roles).
 *
 * Usage:
 *   <Tooltip content="Collapse sidebar (⌘B)">
 *     <button>...</button>
 *   </Tooltip>
 */
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = ({
  children,
  delayDuration = 220,
}: {
  children: ReactNode;
  delayDuration?: number;
}) => (
  <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={300}>
    {children}
  </RadixTooltip.Provider>
);

interface TooltipProps {
  content: ReactNode;
  /** Optional shortcut string rendered in a kbd at the right. e.g. "⌘B" */
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** When false, the trigger renders without a tooltip — handy for collapsed-only labels. */
  enabled?: boolean;
  children: ReactNode;
}

export function Tooltip({
  content,
  shortcut,
  side = 'top',
  align = 'center',
  enabled = true,
  children,
}: TooltipProps) {
  if (!enabled) return <>{children}</>;

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-tooltip select-none rounded-md border px-2 py-1 text-[11px] shadow-[0_8px_18px_rgba(0,0,0,0.25)] data-[state=delayed-open]:animate-in data-[state=closed]:animate-out"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
        >
          <span className="flex items-center gap-2">
            <span>{content}</span>
            {shortcut && (
              <kbd
                className="rounded-sm border px-1 py-0.5 font-mono text-[9px]"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-fg-muted)',
                }}
              >{shortcut}</kbd>
            )}
          </span>
          <RadixTooltip.Arrow style={{ fill: 'var(--color-bg-elevated)' }} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
