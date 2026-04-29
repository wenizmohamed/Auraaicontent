/**
 * Keyboard shortcut registry — Phase 5 of the state-of-the-art interface plan.
 *
 * Centralizes every global keyboard shortcut behind one machine. Components
 * register a shortcut at mount; the registry handles cross-platform mod-key
 * normalization, scope (input vs. global), and discovery via the `?` cheat
 * sheet. Future shortcuts (Cmd+B sidebar collapse, Cmd+/ AI rewrite, etc.)
 * all flow through the same register() call so the cheat sheet stays in
 * sync automatically.
 *
 * Usage from a component:
 *
 *   useShortcut({
 *     id: 'sidebar.collapse',
 *     keys: 'mod+b',
 *     label: 'Collapse sidebar',
 *     group: 'Navigation',
 *     onTrigger: () => setCollapsed(c => !c),
 *   });
 *
 * Mount <ShortcutCheatSheet /> once at App root; it renders an overlay
 * triggered by `?` (when not focused inside an input).
 */
import { useEffect, useRef } from 'react';

export type ShortcutGroup =
  | 'General'
  | 'Navigation'
  | 'Editing'
  | 'AI'
  | 'View'
  | 'Theme';

export interface Shortcut {
  /** Stable id for de-dup + telemetry. */
  id: string;
  /** Key combo, e.g. "mod+k", "?", "g d", "shift+/". `mod` = ⌘ on macOS, Ctrl elsewhere. */
  keys: string;
  /** Human-readable label shown in the cheat sheet + tooltips. */
  label: string;
  /** Bucket for the cheat sheet. */
  group: ShortcutGroup;
  /** Called when the combo fires. */
  onTrigger: (e: KeyboardEvent) => void;
  /** When true the shortcut still fires while focus is inside an input. Default: false. */
  allowInInputs?: boolean;
}

const registry = new Map<string, Shortcut>();
const listeners = new Set<() => void>();

// Cached snapshot — MUST keep stable identity between calls when nothing
// changes, otherwise React's useSyncExternalStore will see a fresh array
// every render and infinite-loop (React error #185). Invalidated on
// register/unregister so the next listShortcuts() rebuilds it.
let cachedSnapshot: Shortcut[] = [];

function rebuildSnapshot() {
  cachedSnapshot = Array.from(registry.values()).sort((a, b) =>
    a.group === b.group ? a.label.localeCompare(b.label) : a.group.localeCompare(b.group)
  );
}

function notify() {
  rebuildSnapshot();
  listeners.forEach(l => l());
}

export function register(s: Shortcut): () => void {
  registry.set(s.id, s);
  notify();
  return () => { registry.delete(s.id); notify(); };
}

/** Returns the cached snapshot. Identity is stable until register/unregister. */
export function listShortcuts(): Shortcut[] {
  return cachedSnapshot;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Combo matcher ──────────────────────────────────────────────────────────

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Returns true if the event matches the combo string. */
export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+').map(p => p.trim());
  const key = parts.pop()!;
  const wantMod   = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt   = parts.includes('alt');
  const wantCtrl  = parts.includes('ctrl');

  const gotMod   = isMac ? e.metaKey : e.ctrlKey;
  const gotShift = e.shiftKey;
  const gotAlt   = e.altKey;
  const gotCtrl  = e.ctrlKey;

  if (wantMod !== gotMod) return false;
  if (wantShift !== gotShift) return false;
  if (wantAlt !== gotAlt) return false;
  // Don't double-check ctrl when 'mod' on non-mac already covered it.
  if (!isMac && wantMod) {
    /* gotMod covers ctrl; skip explicit ctrl check */
  } else if (wantCtrl !== gotCtrl) {
    return false;
  }

  // "?" is shift+/; allow specifying the literal "?" in combos.
  if (key === '?') return e.key === '?' || (e.key === '/' && e.shiftKey);

  return e.key.toLowerCase() === key;
}

/** Pretty-print a combo for the cheat sheet. */
export function formatCombo(combo: string): string {
  const sep = isMac ? '' : '+';
  return combo
    .split('+')
    .map(p => p.trim().toLowerCase())
    .map(p => {
      if (p === 'mod')   return isMac ? '⌘' : 'Ctrl';
      if (p === 'shift') return isMac ? '⇧' : 'Shift';
      if (p === 'alt')   return isMac ? '⌥' : 'Alt';
      if (p === 'ctrl')  return isMac ? '⌃' : 'Ctrl';
      if (p === 'enter') return '↵';
      if (p === 'escape' || p === 'esc') return 'Esc';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(sep);
}

function eventInsideInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Register a keyboard shortcut for the lifetime of the component.
 * Auto-unregisters on unmount and respects input scope.
 *
 * Callers can pass an inline object literal — the hook stores `onTrigger`
 * in a ref so changing identity doesn't re-bind the listener every render.
 * Only structural changes (id / keys / allowInInputs / label / group)
 * cause a re-register.
 */
export function useShortcut(shortcut: Shortcut): void {
  const triggerRef = useRef(shortcut.onTrigger);
  triggerRef.current = shortcut.onTrigger;

  useEffect(() => {
    // Register a thin wrapper that defers to the latest trigger ref so the
    // cheat sheet sees stable identity but invocation always hits fresh state.
    const stable: Shortcut = { ...shortcut, onTrigger: (e) => triggerRef.current(e) };
    const unregister = register(stable);
    function onKey(e: KeyboardEvent) {
      if (!shortcut.allowInInputs && eventInsideInput(e)) return;
      if (matches(e, shortcut.keys)) {
        e.preventDefault();
        triggerRef.current(e);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unregister();
    };
  // Intentionally exclude shortcut.onTrigger — handled via the ref above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut.id, shortcut.keys, shortcut.allowInInputs, shortcut.label, shortcut.group]);
}
