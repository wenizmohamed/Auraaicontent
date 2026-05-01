/**
 * AIActionsMenu — Notion-AI-style "/ai" categorized command palette
 * that extends InlineAITextToolbar. Triggered by the toolbar's "More"
 * button. Lists actions grouped by category (Translate, Tone, Extract,
 * Summarize, Expand, Custom) with type-to-filter.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Languages, Volume2, FileSearch, AlignLeft, Maximize2, Search } from 'lucide-react';
import { motionUI } from '../../lib/motion';

export type AIActionId = string;

export interface AIAction {
  id: AIActionId;
  label: string;
  category: 'rewrite' | 'translate' | 'tone' | 'extract' | 'summarize' | 'expand';
  /** Argument injected into the assistant prompt template. */
  arg?: string;
}

const CATEGORY_META: Record<AIAction['category'], { label: string; icon: any }> = {
  rewrite:   { label: 'Rewrite',   icon: Sparkles },
  translate: { label: 'Translate', icon: Languages },
  tone:      { label: 'Tone',      icon: Volume2 },
  extract:   { label: 'Extract',   icon: FileSearch },
  summarize: { label: 'Summarize', icon: AlignLeft },
  expand:    { label: 'Expand',    icon: Maximize2 },
};

export const DEFAULT_AI_ACTIONS: AIAction[] = [
  { id: 'rewrite-clear',     label: 'Make it clearer',          category: 'rewrite' },
  { id: 'rewrite-concise',   label: 'Make it more concise',     category: 'rewrite' },
  { id: 'rewrite-on-brand',  label: 'Match the brand voice',    category: 'rewrite' },
  { id: 'translate-ar',      label: 'Translate to Arabic',      category: 'translate', arg: 'Arabic' },
  { id: 'translate-en',      label: 'Translate to English',     category: 'translate', arg: 'English' },
  { id: 'translate-fr',      label: 'Translate to French',      category: 'translate', arg: 'French' },
  { id: 'translate-es',      label: 'Translate to Spanish',     category: 'translate', arg: 'Spanish' },
  { id: 'tone-professional', label: 'Make it professional',     category: 'tone',      arg: 'professional' },
  { id: 'tone-friendly',     label: 'Make it friendly',         category: 'tone',      arg: 'friendly, conversational' },
  { id: 'tone-confident',    label: 'Make it confident',        category: 'tone',      arg: 'confident, direct' },
  { id: 'tone-playful',      label: 'Make it playful',          category: 'tone',      arg: 'playful' },
  { id: 'extract-entities',  label: 'Extract entities',         category: 'extract' },
  { id: 'extract-actions',   label: 'Extract action items',     category: 'extract' },
  { id: 'summarize-tldr',    label: 'TL;DR (one sentence)',     category: 'summarize' },
  { id: 'summarize-bullets', label: '5-bullet summary',         category: 'summarize' },
  { id: 'expand-paragraph',  label: 'Expand into a paragraph',  category: 'expand' },
  { id: 'expand-thread',     label: 'Expand into a thread',     category: 'expand' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (action: AIAction) => void;
  /** Pre-positioned by the trigger; { top, left } in document coordinates. */
  anchorPos: { top: number; left: number } | null;
}

export function AIActionsMenu({ open, onClose, onPick, anchorPos }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else setQuery('');
  }, [open]);

  // Dismiss on Esc
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? DEFAULT_AI_ACTIONS.filter(a => a.label.toLowerCase().includes(q) || a.category.includes(q)) : DEFAULT_AI_ACTIONS;
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<AIAction['category'], AIAction[]>();
    for (const a of filtered) {
      const arr = map.get(a.category) ?? [];
      arr.push(a);
      map.set(a.category, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  if (!anchorPos) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* click-outside backdrop */}
          <div
            className="fixed inset-0 z-popover"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={motionUI}
            role="dialog"
            aria-label="AI actions"
            className="fixed z-popover w-[280px] overflow-hidden rounded-xl border shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            style={{
              top: anchorPos.top,
              left: anchorPos.left,
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <Search size={12} style={{ color: 'var(--color-fg-subtle)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search AI actions…"
                className="flex-1 bg-transparent text-[12px] outline-none"
                style={{ color: 'var(--color-fg)' }}
              />
            </div>
            <div className="max-h-[320px] overflow-auto p-1">
              {grouped.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  No actions match.
                </p>
              ) : grouped.map(([category, actions]) => {
                const meta = CATEGORY_META[category];
                const Icon = meta.icon;
                return (
                  <div key={category} className="mb-1.5 last:mb-0">
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>
                      <Icon size={10} style={{ color: 'var(--color-accent)' }} />
                      {meta.label}
                    </div>
                    {actions.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { onPick(a); onClose(); }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[12px] transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
                        style={{ color: 'var(--color-fg)' }}
                      >
                        <span>{a.label}</span>
                        {a.arg && (
                          <span className="font-mono text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                            {a.arg.length > 16 ? a.arg.slice(0, 16) + '…' : a.arg}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AIActionsMenu;
