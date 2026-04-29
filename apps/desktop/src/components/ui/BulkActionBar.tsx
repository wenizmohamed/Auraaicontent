/**
 * BulkActionBar — slides up from bottom when a multi-select has rows.
 * Reusable across any list view that wires useMultiSelect.
 *
 * Usage:
 *   <BulkActionBar count={ms.count} onClear={ms.clear}>
 *     <button onClick={() => doDelete([...ms.selected])}>Delete</button>
 *     <button onClick={() => doExport([...ms.selected])}>Export</button>
 *   </BulkActionBar>
 */
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { motionUI } from '../../lib/motion';

interface Props {
  count: number;
  onClear: () => void;
  /** Action buttons. Style them however; this just lays them out. */
  children: ReactNode;
  /** Override copy. Default: "{count} selected". */
  label?: string;
}

export function BulkActionBar({ count, onClear, children, label }: Props) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={motionUI}
          className="fixed bottom-6 left-1/2 z-toast -translate-x-1/2 flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
          role="region"
          aria-label="Bulk actions"
        >
          <span className="text-sm font-medium tabular-nums">
            {label ?? `${count} selected`}
          </span>
          <span className="h-5 w-px" style={{ background: 'var(--color-border)' }} aria-hidden />
          <div className="flex items-center gap-2">{children}</div>
          <span className="h-5 w-px" style={{ background: 'var(--color-border)' }} aria-hidden />
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            className="rounded-md p-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
          >
            <X size={14} style={{ color: 'var(--color-fg-subtle)' }} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
