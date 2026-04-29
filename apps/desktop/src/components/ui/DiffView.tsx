/**
 * DiffView — before/after diff with red/green inline hunks. Cursor pattern.
 * Use for AI-rewritten content (post copy, brief sections, captions).
 *
 * Built on the `diff` package (jsdiff) — uses diffWordsWithSpace for
 * smooth word-level diffs that read naturally vs char-level.
 *
 * Usage:
 *   <DiffView before={original} after={rewritten} onAccept={apply} onReject={cancel} />
 */
import { useMemo } from 'react';
import { diffWordsWithSpace } from 'diff';
import { Check, X } from 'lucide-react';

interface Props {
  before: string;
  after: string;
  onAccept?: () => void;
  onReject?: () => void;
  /** Hide the accept/reject footer — for read-only audit views. */
  readOnly?: boolean;
  /** Optional title shown above the diff body. */
  title?: string;
}

export function DiffView({ before, after, onAccept, onReject, readOnly = false, title }: Props) {
  const parts = useMemo(() => diffWordsWithSpace(before, after), [before, after]);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {title && (
        <div
          className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}
        >
          {title}
        </div>
      )}

      <div
        className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--color-fg)' }}
      >
        {parts.map((p, i) => {
          if (p.added) {
            return (
              <span
                key={i}
                style={{
                  background: 'var(--color-success-subtle)',
                  color: 'var(--color-success)',
                  borderRadius: '3px',
                  padding: '0 1px',
                }}
              >{p.value}</span>
            );
          }
          if (p.removed) {
            return (
              <span
                key={i}
                style={{
                  background: 'var(--color-danger-subtle)',
                  color: 'var(--color-danger)',
                  borderRadius: '3px',
                  padding: '0 1px',
                  textDecoration: 'line-through',
                }}
              >{p.value}</span>
            );
          }
          return <span key={i}>{p.value}</span>;
        })}
      </div>

      {!readOnly && (onAccept || onReject) && (
        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-2.5"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {onReject && (
            <button
              type="button"
              onClick={onReject}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-fg-muted)',
                background: 'var(--color-surface-hover)',
              }}
            >
              <X size={12} /> Reject
            </button>
          )}
          {onAccept && (
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
              style={{
                background: 'var(--color-success)',
                color: 'var(--color-fg-on-accent)',
              }}
            >
              <Check size={12} /> Accept
            </button>
          )}
        </div>
      )}
    </div>
  );
}
