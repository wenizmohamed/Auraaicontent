// usePersistentDraft — debounced localStorage autosave + restore for in-progress
// text so a page refresh (or accidental tab close) never wipes what the user was
// typing. Drop-in replacement for useState<T>.
//
//   const [brief, setBrief, clearBrief] = usePersistentDraft('copywriting.brief', '');
//
// - Restores the saved draft on mount (per `key`).
// - Persists on change, debounced (default 400ms) to avoid thrashing storage.
// - Empty string / null / undefined is treated as "no draft" → key is removed
//   (so a cleared field doesn't leave a stale draft behind).
// - Pass `key = null` to disable persistence (e.g. before a clientId resolves).
// - When `key` changes (e.g. switching client), the saved draft for the NEW key
//   is loaded — drafts are scoped, not shared across contexts.
//
// All storage access is wrapped in try/catch: a disabled/blocked localStorage
// degrades to plain in-memory state, never throws.

import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'radix.draft.';

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function read<T>(storageKey: string | null, fallback: T): T {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function usePersistentDraft<T>(
  key: string | null,
  initial: T,
  debounceMs = 400,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const storageKey = key ? PREFIX + key : null;
  const [value, setValue] = useState<T>(() => read(storageKey, initial));

  // Re-load when the key changes (e.g. client switch) so drafts stay scoped.
  const lastKey = useRef(storageKey);
  useEffect(() => {
    if (storageKey === lastKey.current) return;
    lastKey.current = storageKey;
    setValue(read(storageKey, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Debounced persist on change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        if (isEmpty(value)) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(value));
      } catch { /* storage unavailable — in-memory only */ }
    }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, storageKey, debounceMs]);

  const clear = useCallback(() => {
    if (storageKey) { try { localStorage.removeItem(storageKey); } catch { /* noop */ } }
  }, [storageKey]);

  return [value, setValue, clear];
}
