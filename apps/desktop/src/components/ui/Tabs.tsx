/**
 * Tabs — token-themed wrapper over @radix-ui/react-tabs. Free a11y +
 * keyboard nav.
 *
 * Usage:
 *   <Tabs.Root defaultValue="brief">
 *     <Tabs.List>
 *       <Tabs.Trigger value="brief">Brief</Tabs.Trigger>
 *       <Tabs.Trigger value="knowledge">Knowledge</Tabs.Trigger>
 *     </Tabs.List>
 *     <Tabs.Content value="brief">…</Tabs.Content>
 *     <Tabs.Content value="knowledge">…</Tabs.Content>
 *   </Tabs.Root>
 */
import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

const Root = RadixTabs.Root;

function List({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <RadixTabs.List
      className={`inline-flex items-center gap-1 rounded-xl border p-1 ${className}`}
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {children}
    </RadixTabs.List>
  );
}

function Trigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors data-[state=inactive]:text-[color:var(--color-fg-muted)] data-[state=inactive]:hover:bg-[color:var(--color-surface-hover)] data-[state=active]:bg-[color:var(--color-bg-elevated)] data-[state=active]:text-[color:var(--color-fg)] data-[state=active]:shadow-[var(--shadow-1)]"
    >
      {children}
    </RadixTabs.Trigger>
  );
}

function Content({ value, children, className = '' }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Content value={value} className={`outline-none ${className}`}>
      {children}
    </RadixTabs.Content>
  );
}

export const Tabs = { Root, List, Trigger, Content };
