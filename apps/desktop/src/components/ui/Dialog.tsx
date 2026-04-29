/**
 * Dialog — token-themed wrapper over @radix-ui/react-dialog. Matches
 * the editorial chrome of the existing CommandPalette / ShortcutCheatSheet.
 *
 * Usage:
 *   <Dialog.Root open={open} onOpenChange={setOpen}>
 *     <Dialog.Content title="Confirm delete" description="…">
 *       <p>Body content</p>
 *       <Dialog.Footer>
 *         <Dialog.Close>Cancel</Dialog.Close>
 *         <button onClick={confirm}>Delete</button>
 *       </Dialog.Footer>
 *     </Dialog.Content>
 *   </Dialog.Root>
 */
import * as Radix from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

const Root = Radix.Root;
const Trigger = Radix.Trigger;
const Close = Radix.Close;

function Content({
  title,
  description,
  children,
  width = 480,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Radix.Portal>
      <Radix.Overlay
        className="fixed inset-0 z-modal-backdrop bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <Radix.Content
        className="fixed left-1/2 top-1/2 z-modal max-h-[85vh] w-full -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border shadow-[0_28px_60px_rgba(0,0,0,0.45)] outline-none"
        style={{
          maxWidth: width,
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-fg)',
        }}
      >
        <div
          className="flex items-start justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <div className="min-w-0">
            <Radix.Title className="font-display text-[15px] font-bold tracking-tight">
              {title}
            </Radix.Title>
            {description && (
              <Radix.Description className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
                {description}
              </Radix.Description>
            )}
          </div>
          <Radix.Close className="ml-3 rounded-md p-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer">
            <X size={14} style={{ color: 'var(--color-fg-subtle)' }} />
          </Radix.Close>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
      </Radix.Content>
    </Radix.Portal>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div
      className="-mx-5 -mb-4 mt-4 flex items-center justify-end gap-2 border-t px-5 py-3"
      style={{ borderColor: 'var(--color-border-subtle)' }}
    >
      {children}
    </div>
  );
}

export const Dialog = { Root, Trigger, Close, Content, Footer };
