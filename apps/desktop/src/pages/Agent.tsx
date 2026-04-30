/**
 * Agent surface — preview the assistant's plan + replay past sessions.
 *
 * Two tabs:
 *   Plan    — sample plan (TODO: hook to /api/agent/sessions/:id/plan when wired)
 *   History — list of past agent sessions + chronological event replay
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, History as HistoryIcon } from 'lucide-react';
import AgentPlanView, { type PlanStep } from '../components/agent/AgentPlanView';
import SessionTrace from '../components/agent/SessionTrace';
import { agentApi, type AgentSessionSummary } from '../lib/backend-api';

const SAMPLE_PLAN: PlanStep[] = [
  {
    id: '1',
    title: 'Read the brief and current calendar',
    description: 'Pull the latest brief, knowledge items, and the current month plan',
    status: 'completed',
    etaSeconds: 8,
    substeps: [
      { id: '1.1', title: 'Fetch brief', status: 'completed', tools: [{ name: 'briefs.get' }] },
      { id: '1.2', title: 'Fetch knowledge', status: 'completed', tools: [{ name: 'knowledge.list' }] },
      { id: '1.3', title: 'Fetch month plan', status: 'completed', tools: [{ name: 'calendar.getMonth', args: { month: 'May 2026' } }] },
    ],
  },
  {
    id: '2',
    title: 'Generate 12 post ideas across pillars',
    description: 'Mix education, social proof, and platform launches by client pillars',
    status: 'in-progress',
    etaSeconds: 35,
    substeps: [
      { id: '2.1', title: 'Cluster pillars', status: 'completed', tools: [{ name: 'pillars.cluster' }] },
      { id: '2.2', title: 'Draft 12 captions', status: 'in-progress', tools: [{ name: 'captions.draft', args: { count: 12 } }] },
      { id: '2.3', title: 'Score for brand voice', status: 'pending', tools: [{ name: 'voice.score' }] },
    ],
  },
  {
    id: '3',
    title: 'Generate visual references for top 6',
    description: 'Image generation pass via the primary visual provider',
    status: 'pending',
    etaSeconds: 90,
    dependencies: ['2'],
    substeps: [
      { id: '3.1', title: 'Pick 6 highest-scoring posts', status: 'pending' },
      { id: '3.2', title: 'Generate images', status: 'pending', tools: [{ name: 'image.generate', args: { count: 6 } }] },
    ],
  },
  {
    id: '4',
    title: 'Schedule into May 2026 calendar',
    description: 'Drop the 12 posts onto recommended dates with platform variants',
    status: 'pending',
    etaSeconds: 12,
    dependencies: ['2', '3'],
    substeps: [
      { id: '4.1', title: 'Compute schedule', status: 'pending' },
      { id: '4.2', title: 'Persist posts', status: 'pending', tools: [{ name: 'calendar.bulkInsert' }] },
    ],
  },
];

type Tab = 'plan' | 'history';

export default function Agent() {
  const [tab, setTab] = useState<Tab>('plan');
  const [running, setRunning] = useState(false);

  return (
    <div className="mx-auto h-full max-w-6xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-display text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
          Agent
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
          Preview the assistant's plan, then approve to run. Replay past sessions to see what actually happened.
        </p>
      </div>

      <div className="mb-3 flex gap-1 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>Plan</TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>
      </div>

      <div className="h-[calc(100vh-240px)]">
        {tab === 'plan' ? (
          <AgentPlanView
            plan={SAMPLE_PLAN}
            loading={running}
            onApprove={() => {
              setRunning(true);
              toast.success('Plan approved — execution would start here once /api/agent/sessions/:id/run is wired');
              setTimeout(() => setRunning(false), 1200);
            }}
            onCancel={() => toast('Plan cancelled')}
          />
        ) : (
          <HistoryTab />
        )}
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
