/**
 * SessionTrace — chronological replay of an agent session's events.
 *
 * Reads /api/agent/sessions/:uid (existing endpoint, returns up to 500 events
 * + all messages). Renders messages + events on one timeline so you can step
 * through what the assistant actually did, in order, with collapsible payloads.
 *
 * Used by the Agent surface "History" tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquare, Wrench, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { agentApi, type AgentSessionDetail, type AgentEventRecord, type AgentMessageRecord } from '../../lib/backend-api';

type TimelineItem =
  | { kind: 'message'; at: string; data: AgentMessageRecord }
  | { kind: 'event'; at: string; data: AgentEventRecord };

interface SessionTraceProps {
  uid: string | null;
}

export function SessionTrace({ uid }: SessionTraceProps) {
  const [data, setData] = useState<AgentSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!uid) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    agentApi.getSession(uid)
      .then(r => { if (!cancelled) setData(r.session); })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load session'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  const timeline: TimelineItem[] = useMemo(() => {
    if (!data) return [];
    const items: TimelineItem[] = [
      ...data.messages.map(m => ({ kind: 'message' as const, at: m.createdAt, data: m })),
      ...data.events.map(e => ({ kind: 'event' as const, at: e.createdAt, data: e })),
    ];
    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return items;
  }, [data]);

  if (!uid) return <Empty msg="Pick a session from the list to replay it." />;
  if (loading) return <Loading />;
  if (error) return <Empty msg={error} icon={<AlertCircle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />} />;
  if (!data) return <Empty msg="Session not found." />;

  return (
    <div className="flex h-full flex-col">
      <header
        className="border-b px-5 py-3"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <h3 className="font-display text-[15px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
          {data.title || 'Untitled session'}
        </h3>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
          {data.messages.length} messages · {data.events.length} events ·
          started {new Date(data.createdAt).toLocaleString()}
        </p>
      </header>
      <ol className="flex-1 overflow-auto px-5 py-3">
        {timeline.length === 0 ? (
          <Empty msg="No events recorded for this session yet." />
        ) : timeline.map((item, idx) => {
          const id = `${item.kind}-${idx}`;
          const isOpen = expanded[id] ?? false;
          const isMsg = item.kind === 'message';
          const label = isMsg ? item.data.role : item.data.type;
          const Icon = isMsg ? MessageSquare : Wrench;
          const accent = isMsg ? 'var(--color-info)' : 'var(--color-accent)';
          const preview = isMsg ? item.data.content : JSON.stringify(item.data.payload).slice(0, 80);

          return (
            <li key={id} className="relative pb-3 pl-8">
              <span
                className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border"
                style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
              >
                <Icon className="h-3 w-3" style={{ color: accent }} />
              </span>
              {idx < timeline.length - 1 ? (
                <span
                  className="absolute left-3 top-7 bottom-0 w-px"
                  style={{ background: 'var(--color-border-subtle)' }}
                />
              ) : null}

              <button
                type="button"
                onClick={() => setExpanded(p => ({ ...p, [id]: !p[id] }))}
                className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 h-3 w-3 flex-shrink-0" style={{ color: 'var(--color-fg-subtle)' }} />
                ) : (
                  <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0" style={{ color: 'var(--color-fg-subtle)' }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style={{ background: 'var(--color-surface)', color: accent }}
                    >
                      {label}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                      {new Date(item.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p
                    className="mt-1 truncate text-[12px]"
                    style={{ color: 'var(--color-fg-muted)' }}
                  >
                    {preview}
                  </p>
                </div>
              </button>

              {isOpen ? (
                <pre
                  className="ml-7 mt-1 overflow-x-auto rounded-md p-2 text-[11px]"
                  style={{ background: 'var(--color-bg-sunken)', color: 'var(--color-fg)' }}
                >
                  {isMsg ? item.data.content : JSON.stringify(item.data.payload, null, 2)}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
    </div>
  );
}

function Empty({ msg, icon }: { msg: string; icon?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon}
      <p className="text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>{msg}</p>
    </div>
  );
}

export default SessionTrace;
