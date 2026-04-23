// SessionSidebar — left rail with recent agent sessions + new-session button.
// Fetches from GET /api/agent/sessions and renders status dot + relative time.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Plus, Search, Clock, Loader2, AlertCircle } from 'lucide-react';

interface SessionSidebarProps {
  activeSessionUid: string | null;
  onSelectSession: (uid: string) => void;
  onNewSession: () => void;
}

interface SessionRow {
  uid: string;
  title: string;
  status: string;
  updatedAt: string;
}

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8080'
    : 'http://127.0.0.1:8080');

async function fetchSessions(): Promise<SessionRow[]> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('radix_auth_token') : null;
  const r = await fetch(`${API_URL}/api/agent/sessions?limit=50`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { sessions } = (await r.json()) as { sessions: SessionRow[] };
  return sessions;
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const delta = Math.max(0, Date.now() - then);
    const s = Math.floor(delta / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

// Backend writes 'completed'/'failed', frontend phase enum uses 'complete'/'error'.
// Accept both so the dot is always correct (see LRN-20260420-005 status vocab drift).
function statusDotClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500 animate-pulse';
    case 'complete':
    case 'completed':
      return 'bg-emerald-500';
    case 'error':
    case 'failed':
      return 'bg-red-500';
    case 'aborted':
      return 'bg-amber-500';
    case 'idle':
    case 'active':
    default:
      return 'bg-zinc-500';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'complete':
    case 'completed': return 'Complete';
    case 'error':
    case 'failed': return 'Failed';
    case 'aborted': return 'Aborted';
    case 'active':
    case 'idle':
    default: return 'Ready';
  }
}

// Hide orphan rows from the pre-lazy-draft era: empty "New agent session" shells
// that failed before the user sent anything real.
function isOrphan(row: SessionRow): boolean {
  return row.status === 'failed' && (row.title === 'New agent session' || !row.title.trim());
}

export default function SessionSidebar({
  activeSessionUid,
  onSelectSession,
  onNewSession,
}: SessionSidebarProps) {
  const prefersReducedMotion = useReducedMotion();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchSessions();
      setRows(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const cleaned = rows.filter((r) => !isOrphan(r));
    const q = query.trim().toLowerCase();
    if (!q) return cleaned;
    return cleaned.filter((r) => r.title.toLowerCase().includes(q));
  }, [rows, query]);

  const fadeUp = prefersReducedMotion
    ? { initial: false, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: 'easeOut' as const },
      };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-zinc-950/50 text-zinc-100">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-white">Sessions</h2>
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New session"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5">
          <Search size={12} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md border border-white/5 bg-white/[0.02]"
              />
            ))}
          </div>
        )}

        {!loading && err && (
          <div className="m-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Couldn't load sessions</div>
              <div className="mt-0.5 text-red-400/80">{err}</div>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 rounded bg-red-500/20 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/30 cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !err && filtered.length === 0 && (
          <div className="flex h-32 items-center justify-center px-3 text-center text-xs text-zinc-500">
            {rows.length === 0 ? 'No sessions yet. Start one \u2192' : 'No matches'}
          </div>
        )}

        {!loading && !err && filtered.map((row) => {
          const isActive = row.uid === activeSessionUid;
          return (
            <motion.div key={row.uid} {...fadeUp}>
              <button
                type="button"
                onClick={() => onSelectSession(row.uid)}
                className={[
                  'group mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors cursor-pointer',
                  isActive
                    ? 'bg-white/[0.08] border-l-2 border-blue-500'
                    : 'border-l-2 border-transparent hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span
                  className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.status)}`}
                  aria-label={statusLabel(row.status)}
                  title={statusLabel(row.status)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">{row.title || 'Untitled'}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
                    <Clock size={10} />
                    <span>{relativeTime(row.updatedAt)}</span>
                  </div>
                </div>
                {row.status === 'running' && (
                  <Loader2 size={12} className="shrink-0 animate-spin text-blue-400" />
                )}
              </button>
            </motion.div>
          );
        })}
      </div>
    </aside>
  );
}
