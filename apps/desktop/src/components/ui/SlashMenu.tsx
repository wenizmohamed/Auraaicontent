/**
 * SlashMenu — Notion-style "/" command menu inside text inputs/textareas.
 * Fires when the user types "/" at the start of a line; closes on Escape
 * or selection.
 *
 * Built on cmdk. Token-themed.
 *
 * Usage:
 *   <SlashMenu open={open} query={query} onSelect={...} onClose={...} />
 *
 * Pair with `useSlashTrigger(textareaRef, onTrigger)` from this file to
 * wire the keyboard heuristics on a controlled textarea.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { Command } from 'cmdk';
import { Sparkles, FileText, Languages, Image as ImageIcon, Calendar, Wand2 } from 'lucide-react';

export interface SlashAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Returns the text to insert. Replaces "/" + query with this. */
  perform: (query: string) => string | Promise<string>;
}

export const DEFAULT_SLASH_ACTIONS: SlashAction[] = [
  { id: 'image',     label: '/image',     hint: 'Generate AI image',          icon: ImageIcon, perform: async (q) => `[image: ${q || 'untitled'}]` },
  { id: 'brief',     label: '/brief',     hint: 'Insert brief snippet',       icon: FileText,  perform: async ()  => 'Brand voice: confident, editorial. Channels: IG/LinkedIn/X.' },
  { id: 'translate', label: '/translate', hint: 'Translate selection to AR',  icon: Languages, perform: async (q) => q ? `(AR) ${q}` : '(AR) ' },
  { id: 'plan',      label: '/plan',      hint: 'Insert content plan stub',   icon: Calendar,  perform: async ()  => '\n. Mon: launch teaser\n. Wed: social proof\n. Fri: offer\n' },
  { id: 'rewrite',   label: '/rewrite',   hint: 'Rewrite as on-brand',        icon: Sparkles,  perform: async (q) => q || '(select text first)' },
  { id: 'gen',       label: '/generate',  hint: 'Generate full caption',      icon: Wand2,     perform: async (q) => `Caption draft: ${q || 'on-brand opener'}` },
];

interface MenuProps {
  open: boolean;
  /** Position relative to the textarea — top/left in pixels. */
  pos: { top: number; left: number } | null;
  query: string;
  actions?: SlashAction[];
  onSelect: (action: SlashAction) => void;
  onClose: () => void;
}

export function SlashMenu({ open, pos, query, actions = DEFAULT_SLASH_ACTIONS, onSelect, onClose }: MenuProps) {
  if (!open || !pos) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-fg)',
      }}
      className="z-popover w-[280px] rounded-xl border shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
      role="dialog"
      aria-label="Slash menu"
    >
      <Command label="Slash actions" className="overflow-hidden rounded-xl" shouldFilter={true}>
        <Command.Input value={query} onValueChange={() => {}} className="hidden" />
        <Command.List className="max-h-[280px] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-3 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
            No matching slash action.
          </Command.Empty>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Command.Item
                key={a.id}
                value={a.label + ' ' + (a.hint ?? '')}
                onSelect={() => { onSelect(a); onClose(); }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[12px] aria-selected:bg-[color:var(--color-surface-hover)] data-[selected=true]:bg-[color:var(--color-surface-hover)]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'var(--color-surface)', color: 'var(--color-fg-muted)' }}>
                  <Icon size={12} />
                </span>
                <span className="font-mono" style={{ color: 'var(--color-fg)' }}>{a.label}</span>
                {a.hint && (
                  <span className="ml-auto truncate text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>{a.hint}</span>
                )}
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}

/**
 * Hook that watches a textarea for "/" triggers and reports them.
 * Caller controls open/pos/query state and calls onSelect to actually
 * inject the action's result text.
 */
export function useSlashTrigger(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  onTrigger: (state: { query: string; pos: { top: number; left: number }; rangeStart: number; rangeEnd: number } | null) => void,
) {
  const stateRef = useRef<{ rangeStart: number } | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function handle() {
      const ta = textareaRef.current;
      if (!ta) return;
      const cursor = ta.selectionEnd;
      const before = ta.value.slice(0, cursor);
      const slashIdx = before.lastIndexOf('/');
      // Trigger only when "/" starts a token (line start or after whitespace)
      // and the cursor is on the same token without intervening whitespace.
      const validStart = slashIdx === 0 || /[\s\n]/.test(before[slashIdx - 1] ?? '');
      const tokenAfter = before.slice(slashIdx + 1);
      const hasSpace = /[\s\n]/.test(tokenAfter);
      if (slashIdx === -1 || !validStart || hasSpace) {
        if (stateRef.current) {
          stateRef.current = null;
          onTrigger(null);
        }
        return;
      }
      // Position: very rough — top-right of the textarea so the menu doesn't
      // block the active line. A real impl would measure caret rect via
      // a shadow-DOM mirror; this is sufficient for the demo.
      const r = ta.getBoundingClientRect();
      const tar = ta.parentElement?.getBoundingClientRect() ?? r;
      const pos = { top: r.top - tar.top + 28, left: r.left - tar.left + 12 };
      stateRef.current = { rangeStart: slashIdx };
      onTrigger({ query: tokenAfter, pos, rangeStart: slashIdx, rangeEnd: cursor });
    }

    el.addEventListener('input', handle);
    el.addEventListener('keyup', handle);
    el.addEventListener('click', handle);
    return () => {
      el.removeEventListener('input', handle);
      el.removeEventListener('keyup', handle);
      el.removeEventListener('click', handle);
    };
  }, [textareaRef, onTrigger]);
}
