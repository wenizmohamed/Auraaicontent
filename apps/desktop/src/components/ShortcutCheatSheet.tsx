/**
 * Keyboard shortcut cheat sheet — ? toggles open. Pulls from the central
 * shortcut registry so the list stays in sync with what's actually registered
 * across the app. Linear-style.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, X } from 'lucide-react';
import { listShortcuts, subscribe, formatCombo, register, type ShortcutGroup } from '../lib/shortcuts';

const EMPTY: ReturnType<typeof listShortcuts> = [];

function useRegistrySnapshot() {
  return useSyncExternalStore(
    (cb) => subscribe(cb),
    () => listShortcuts(),
    () => EMPTY,
  );
}

export function ShortcutCheatSheet() {
  const [open, setOpen] = useState(false);
  const shortcuts = useRegistrySnapshot();

  // Register self so '?' shows up in its own list
  useEffect(() => {
    return register({
      id: 'cheatsheet.toggle',
      keys: '?',
      label: 'Show keyboard shortcuts',
      group: 'General',
      onTrigger: () => setOpen(true),
    });
  }, []);

  // Direct keydown listener — lighter than useShortcut for this one global trigger
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inInput) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Group shortcuts for display
  const grouped = shortcuts.reduce<Record<string, typeof shortcuts>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});
  const groupOrder: ShortcutGroup[] = ['General', 'Navigation', 'View', 'Editing', 'AI', 'Theme'];
  const orderedGroups = groupOrder.filter(g => grouped[g]?.length);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-modal-backdrop bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out"
        />
        <Dialog.Content
          aria-label="Keyboard shortcuts"
          className="fixed left-1/2 top-1/2 z-modal w-[560px] max-w-[92vw] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 outline-none flex flex-col rounded-2xl border shadow-[0_28px_60px_rgba(0,0,0,0.45)]"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
        >
          <div
            className="flex items-center justify-between border-b px-5 py-4"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <Dialog.Title className="flex items-center gap-2.5 text-[15px] font-semibold">
              <Keyboard size={16} style={{ color: 'var(--color-fg-muted)' }} />
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md p-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
              aria-label="Close"
            >
              <X size={14} style={{ color: 'var(--color-fg-subtle)' }} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Press the listed keys anywhere in the app, except inside inputs.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {orderedGroups.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--color-fg-subtle)' }}>
                No shortcuts registered yet.
              </p>
            )}
            {orderedGroups.map(group => (
              <section key={group}>
                <h3
                  className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--color-fg-subtle)' }}
                >{group}</h3>
                <ul className="space-y-1">
                  {grouped[group]!.map(s => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[color:var(--color-surface-hover)]"
                    >
                      <span style={{ color: 'var(--color-fg)' }}>{s.label}</span>
                      <kbd
                        className="font-mono text-[11px] rounded-md border px-2 py-0.5"
                        style={{
                          borderColor: 'var(--color-border)',
                          background: 'var(--color-surface)',
                          color: 'var(--color-fg-muted)',
                        }}
                      >{formatCombo(s.keys)}</kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div
            className="flex items-center justify-between border-t px-5 py-2.5 text-[11px]"
            style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}
          >
            <span>Tip: shortcuts pause inside inputs.</span>
            <span>{shortcuts.length} registered</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
