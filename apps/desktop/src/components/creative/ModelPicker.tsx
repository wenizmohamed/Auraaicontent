// Collapsible model picker for Creative Studio. Shows the current pick as one
// row (Auto by default: AURA routes the call) and expands to the section's
// model list on demand. Accessible: the trigger is a button with
// aria-expanded, the list is a radiogroup, Escape or an outside click closes.
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { ModelOption } from '../../lib/creative-models';

interface Props {
  label?: string;
  options: ModelOption[];
  value: string;
  onChange: (value: string) => void;
  /** Owner/admin/accounting only: show the rate next to each engine. */
  showPrice?: boolean;
  /** Formats the rate for one option (per image, or per second at the active
   *  resolution). Return '' to hide. */
  priceFor?: (o: ModelOption) => string;
  /** Extra note under the list, e.g. a resolution rule. */
  footnote?: string;
}

const VENDOR_TONE: Record<string, string> = {
  Alibaba: 'var(--color-accent)',
  Google: 'var(--color-fg)',
  xAI: 'var(--color-fg-muted)',
};

export function ModelPicker({ label = 'Model', options, value, onChange, showPrice, priceFor, footnote }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const price = (o: ModelOption) => (showPrice && priceFor ? priceFor(o) : '');

  return (
    <div ref={rootRef} className="min-w-[340px] flex-1 max-w-[560px]">
      <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{label}</label>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all bg-white/[0.03] border-white/[0.08] hover:border-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
      >
        <span
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
          aria-hidden="true"
        >
          {selected.value === 'auto' ? <Sparkles className="w-3.5 h-3.5" /> : <span className="text-[10px] font-bold">{selected.label.slice(0, 1)}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold truncate" style={{ color: 'var(--color-fg)' }}>
            {selected.label}
            {selected.value === 'auto' ? <span className="font-normal" style={{ color: 'var(--color-fg-muted)' }}> · AURA picks the engine</span> : null}
            {selected.vendor ? <span className="font-normal" style={{ color: 'var(--color-fg-muted)' }}> · {selected.vendor}</span> : null}
          </span>
          <span className="block text-[10px] truncate" style={{ color: 'var(--color-fg-muted)' }}>{selected.hint}</span>
        </span>
        {price(selected) ? <span className="shrink-0 text-[10px] tabular-nums" style={{ color: 'var(--color-fg-muted)' }}>{price(selected)}</span> : null}
        <ChevronDown className={`shrink-0 w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-fg-muted)' }} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listId}
          role="radiogroup"
          aria-label={label}
          className="mt-2 rounded-xl border overflow-hidden bg-white/[0.02] border-white/[0.08]"
        >
          {options.map((o) => {
            const active = o.value === selected.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="w-full flex items-start gap-3 px-3 py-2 text-left border-b last:border-b-0 border-white/[0.06] transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:bg-white/[0.06]"
                style={active ? { background: 'var(--color-accent-subtle)' } : undefined}
              >
                <span
                  className="mt-1 shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center"
                  style={{ borderColor: active ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
                  aria-hidden="true"
                >
                  {active ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-fg)' }}>{o.label}</span>
                    {o.value === 'auto'
                      ? <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--color-accent)' }}>Recommended</span>
                      : o.vendor
                        ? <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: VENDOR_TONE[o.vendor] }}>{o.vendor}</span>
                        : null}
                  </span>
                  <span className="block text-[10px] leading-snug" style={{ color: 'var(--color-fg-muted)' }}>{o.hint}</span>
                </span>
                {price(o) ? <span className="shrink-0 text-[10px] tabular-nums mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>{price(o)}</span> : null}
              </button>
            );
          })}
          {footnote ? <p className="px-3 py-2 text-[10px]" style={{ color: 'var(--color-fg-muted)' }}>{footnote}</p> : null}
        </div>
      )}
    </div>
  );
}
