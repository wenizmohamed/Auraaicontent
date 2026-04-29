/**
 * useMultiSelect — list-selection state machine for shift-click range,
 * cmd-click toggle, escape-to-clear. Pair with <BulkActionBar /> to ship
 * Notion / Linear style bulk actions in any list view.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';

export interface MultiSelectAPI<T extends string> {
  /** Currently-selected ids. */
  selected: Set<T>;
  /** Are any rows selected. */
  hasSelection: boolean;
  /** Count of selected rows. */
  count: number;
  /** Returns true if id is selected. */
  isSelected: (id: T) => boolean;
  /** Toggle one row. Use from a click handler with modifier keys. */
  onRowClick: (id: T, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  /** Programmatic select-all (within the current ids[]). */
  selectAll: () => void;
  /** Clear selection. */
  clear: () => void;
}

export function useMultiSelect<T extends string>(orderedIds: T[]): MultiSelectAPI<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set());
  const [anchor, setAnchor] = useState<T | null>(null);

  const onRowClick = useCallback((id: T, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    setSelected(prev => {
      const next = new Set(prev);
      const isMod = e.metaKey || e.ctrlKey;
      if (e.shiftKey && anchor) {
        // Range select between anchor and id
        const a = orderedIds.indexOf(anchor);
        const b = orderedIds.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
        }
      } else if (isMod) {
        // Toggle the row
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        // Plain click — replace selection with just this row
        next.clear();
        next.add(id);
      }
      return next;
    });
    setAnchor(id);
  }, [anchor, orderedIds]);

  const selectAll = useCallback(() => {
    setSelected(new Set(orderedIds));
  }, [orderedIds]);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  // Escape clears selection
  useEffect(() => {
    if (selected.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, clear]);

  const api = useMemo<MultiSelectAPI<T>>(() => ({
    selected,
    hasSelection: selected.size > 0,
    count: selected.size,
    isSelected: (id) => selected.has(id),
    onRowClick,
    selectAll,
    clear,
  }), [selected, onRowClick, selectAll, clear]);

  return api;
}
