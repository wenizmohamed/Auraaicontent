/**
 * Agent surface — preview the assistant's plan + replay past sessions.
 *
 * Two tabs:
 *   Plan    — sample plan (TODO: hook to /api/agent/sessions/:id/plan when wired)
 *   History — list of past agent sessions + chronological event replay
 */
import { useEffect, useState } from 'react';
import { Loader2, History as HistoryIcon } from 'lucide-react';
import SessionTrace from '../components/agent/SessionTrace';
import { agentApi, type AgentSessionSummary } from '../lib/backend-api';


type Tab = 'plan' | 'history';

export default function Agent() {
  const [tab, setTab] = useState<Tab>('history');

  return (
    <div className="mx-auto h-full max-w-6xl px-4 py-6">
      <div className="mb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="font-display text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            AURA Agent
          </h1>
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
          >
            AURA · 19 Tools
          </span>
        </div>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
          AURA plans the work, runs the tools and checks the result. Preview plans or replay full multi-tool session traces.
        </p>
      </div>

      <div className="mb-3 flex gap-1 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>
      </div>

      <div className="h-[calc(100vh-240px)]">
        {tab === 'history' && <HistoryTab />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-t-md px-3 py-1.5 text-[13px] font-medium transition-colors"
      style={{
        color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
        borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        marginBottom: '-1px',
      }}
    >
      {children}
    </button>
  );
}

function HistoryTab() {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentApi.listSessions({ limit: 50 })
      .then(r => {
        setSessions(r.sessions);
        if (r.sessions[0]) setSelectedUid(r.sessions[0].uid);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="grid h-full grid-cols-[260px_1fr] gap-3 overflow-hidden rounded-xl border"
      style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}
    >
      <aside
        className="flex flex-col overflow-hidden border-r"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <header
          className="border-b px-3 py-2"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <h3 className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>
            Recent sessions
          </h3>
        </header>
        <ul className="flex-1 overflow-auto p-1">
          {loading ? (
            <li className="flex items-center justify-center p-6">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </li>
          ) : sessions.length === 0 ? (
            <li className="flex flex-col items-center justify-center gap-2 p-6 text-center">
              <HistoryIcon className="h-5 w-5" style={{ color: 'var(--color-fg-subtle)' }} />
              <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>No sessions yet.</p>
            </li>
          ) : sessions.map(s => {
            const isActive = s.uid === selectedUid;
            return (
              <li key={s.uid}>
                <button
                  type="button"
                  onClick={() => setSelectedUid(s.uid)}
                  className="w-full rounded-md px-2 py-1.5 text-left transition-colors"
                  style={{
                    background: isActive ? 'var(--color-surface)' : 'transparent',
                    color: isActive ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                  }}
                >
                  <p className="truncate text-[12px] font-medium">{s.title || s.uid}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                    {new Date(s.updatedAt).toLocaleString()}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <SessionTrace uid={selectedUid} />
    </div>
  );
}
