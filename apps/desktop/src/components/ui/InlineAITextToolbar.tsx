/**
 * InlineAITextToolbar — floats next to the active text selection inside
 * a wrapped container. Triggers AI actions on the selected substring
 * (Rewrite / Translate / Shorten / Make on-brand).
 *
 * Wrap any editable surface with <InlineAITextHost> and pass an action
 * handler. The toolbar manages its own positioning + dismiss-on-click.
 *
 * Usage:
 *   <InlineAITextHost onAction={(action, text) => callApi(action, text)}>
 *     <textarea ... />
 *   </InlineAITextHost>
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Languages, Scissors, Wand2, MoreHorizontal } from 'lucide-react';
import { motionUI } from '../../lib/motion';
import { AIActionsMenu, type AIAction } from './AIActionsMenu';

export type InlineAIAction = 'rewrite' | 'translate' | 'shorten' | 'on-brand' | string;

interface HostProps {
  onAction: (action: InlineAIAction, selectedText: string) => void | Promise<void>;
  children: ReactNode;
}

const ACTIONS: { id: InlineAIAction; label: string; icon: any }[] = [
  { id: 'rewrite',   label: 'Rewrite',     icon: Sparkles },
  { id: 'translate', label: 'Translate',   icon: Languages },
  { id: 'shorten',   label: 'Shorten',     icon: Scissors },
  { id: 'on-brand',  label: 'Make on-brand', icon: Wand2 },
];

export function InlineAITextHost({ onAction, children }: HostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [text, setText] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function pickSelection() {
      const sel = window.getSelection();
      const host = hostRef.current;
      if (!sel || sel.isCollapsed || !host) {
        setPos(null);
        setText('');
        return;
      }
      const text = sel.toString();
      if (!text || text.length < 2) {
        setPos(null);
        setText('');
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      if (!host.contains(node.parentElement ?? node as Node)) {
        setPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setPos({
        top: rect.top - hostRect.top - 44,
        left: rect.left - hostRect.left + rect.width / 2,
      });
      setText(text);
    }

    document.addEventListener('selectionchange', pickSelection);
    document.addEventListener('mouseup', pickSelection);
    document.addEventListener('keyup', pickSelection);
    return () => {
      document.removeEventListener('selectionchange', pickSelection);
      document.removeEventListener('mouseup', pickSelection);
      document.removeEventListener('keyup', pickSelection);
    };
  }, []);

  function fire(action: InlineAIAction) {
    if (!text) return;
    void onAction(action, text);
    setPos(null);
    setText('');
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div ref={hostRef} className="relative">
      {children}
      <AnimatePresence>
        {pos && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={motionUI}
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              transform: 'translateX(-50%)',
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-fg)',
            }}
            className="z-popover flex items-center gap-1 rounded-xl border px-1.5 py-1 shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
            role="toolbar"
            aria-label="AI actions on selected text"
          >
            {ACTIONS.map(a => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => fire(a.id)}
                  title={a.label}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
                  style={{ color: 'var(--color-fg)' }}
                >
                  <Icon size={11} style={{ color: 'var(--color-accent)' }} />
                  {a.label}
                </button>
              );
            })}
            {/* "More" → opens the categorized AI Actions palette */}
            <button
              type="button"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuPos({ top: r.bottom + 6, left: r.left });
              }}
              title="More AI actions"
              aria-label="Open more AI actions"
              className="inline-flex items-center justify-center rounded-md px-1.5 py-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              <MoreHorizontal size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categorized AI actions palette (Notion-AI /ai pattern) */}
      <AIActionsMenu
        open={menuPos != null}
        anchorPos={menuPos}
        onClose={() => setMenuPos(null)}
        onPick={(action: AIAction) => {
          if (!text) return;
          // Adapter: send the catalog action id through the same onAction handler.
          void onAction(action.id as InlineAIAction, text);
          setPos(null);
          setText('');
          setMenuPos(null);
          window.getSelection()?.removeAllRanges();
        }}
      />
    </div>
  );
}
