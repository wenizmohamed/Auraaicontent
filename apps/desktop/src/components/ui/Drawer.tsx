/**
 * Drawer — token-themed wrapper over vaul (native-feeling sheet
 * with momentum drag). Use for mobile/tablet sheet UIs.
 */
import { Drawer as Vaul } from 'vaul';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

const Root = Vaul.Root;
const Trigger = Vaul.Trigger;

function Content({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-modal-backdrop bg-black/60 backdrop-blur-md" />
      <Vaul.Content
        className="fixed bottom-0 left-0 right-0 z-modal mt-24 flex max-h-[90vh] flex-col rounded-t-2xl border outline-none"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-fg)',
        }}
      >
        <div
          className="mx-auto mt-2 h-1.5 w-12 rounded-full"
          style={{ background: 'var(--color-border-strong)' }}
          aria-hidden
        />
        <div
          className="flex items-start justify-between border-b px-5 py-3"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {title ? (
            <Vaul.Title className="font-display text-[15px] font-bold tracking-tight">{title}</Vaul.Title>
          ) : (
            <span />
          )}
          <Vaul.Close className="rounded-md p-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer">
            <X size={14} style={{ color: 'var(--color-fg-subtle)' }} />
          </Vaul.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </Vaul.Content>
    </Vaul.Portal>
  );
}

export const Drawer = { Root, Trigger, Content };
