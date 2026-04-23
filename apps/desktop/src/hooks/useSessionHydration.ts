// Hydrate Zustand store from server state on session open.
// Without this, clicking an old session shows "Ready when you are" because
// live events only arrive for runs happening RIGHT NOW — history is dead.

import { useEffect } from 'react';
import { useAgentStore, generateMessageId } from '../state/agent-store';
import type {
  AgentPhase,
  ToolCall,
  Artifact,
  Thought,
  ChatMessage,
} from '../state/agent-store';
import { API_URL } from '../lib/api-url';

interface ServerSession {
  uid: string;
  title: string;
  status: string;
  clientId?: string | null;
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; createdAt: string }>;
  events: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string }>;
}

function statusToPhase(raw: string): AgentPhase {
  switch (raw) {
    case 'completed': return 'complete';
    case 'failed': return 'error';
    case 'aborted': return 'aborted';
    case 'running':
    case 'active':
    default: return raw === 'running' ? 'running' : 'idle';
  }
}

function reduceEvents(events: ServerSession['events']): {
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  thoughts: Thought[];
} {
  const byId = new Map<string, ToolCall>();
  const artifacts: Artifact[] = [];
  const thoughts: Thought[] = [];

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'agent:thought': {
        const text = typeof p.text === 'string' ? p.text : '';
        const at = typeof p.at === 'string' ? p.at : e.createdAt;
        if (text) thoughts.push({ id: e.id, text, at });
        break;
      }
      case 'agent:tool_start': {
        const id = typeof p.toolCallId === 'string' ? p.toolCallId : e.id;
        byId.set(id, {
          id,
          tool: typeof p.tool === 'string' ? p.tool : 'unknown',
          args: (p.args as Record<string, unknown>) ?? {},
          startedAt: typeof p.at === 'string' ? p.at : e.createdAt,
        });
        break;
      }
      case 'agent:tool_result': {
        const id = typeof p.toolCallId === 'string' ? p.toolCallId : '';
        const existing = byId.get(id);
        if (existing) {
          existing.finishedAt = typeof p.at === 'string' ? p.at : e.createdAt;
          existing.ok = Boolean(p.ok);
          existing.result = p.result;
          existing.error = typeof p.error === 'string' ? p.error : undefined;
        }
        break;
      }
      case 'agent:artifact': {
        const path = typeof p.path === 'string' ? p.path : '';
        if (path) {
          artifacts.push({
            id: path,
            path,
            mimeType: typeof p.mimeType === 'string' ? p.mimeType : undefined,
            bytes: typeof p.bytes === 'number' ? p.bytes : undefined,
            preview: typeof p.preview === 'string' ? p.preview : undefined,
            at: typeof p.at === 'string' ? p.at : e.createdAt,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return { toolCalls: Array.from(byId.values()), artifacts, thoughts };
}

export function useSessionHydration(sessionUid: string | null): void {
  useEffect(() => {
    if (!sessionUid) return;
    let cancelled = false;

    (async () => {
      try {
        const token = typeof window !== 'undefined'
          ? window.localStorage.getItem('radix_auth_token')
          : null;
        const res = await fetch(`${API_URL}/api/agent/sessions/${sessionUid}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const { session } = (await res.json()) as { session: ServerSession };
        if (cancelled) return;

        const messages: ChatMessage[] = session.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: m.id || generateMessageId(),
            role: m.role as 'user' | 'assistant',
            text: m.content,
            createdAt: m.createdAt,
          }));

        const { toolCalls, artifacts, thoughts } = reduceEvents(session.events);

        useAgentStore.setState((state) => {
          // MERGE, don't clobber.  Hydration races against live Socket.IO
          // events — if we've already received agent:start (phase=running)
          // or agent:complete, a naive replace downgrades phase back to the
          // stale DB status ('active' → 'idle') and the UI looks frozen
          // (aura-debug 2026-04-20: this was THE agent-mode "doesn't work
          // well" bug).  Preserve live terminal phases; preserve live arrays
          // when they have more items than the hydrated snapshot.
          const existing = state.sessions[sessionUid];
          const hydratedStatus = statusToPhase(session.status);
          const liveStatus = existing?.status;
          const nextStatus: AgentPhase =
            liveStatus === 'running' || liveStatus === 'complete' || liveStatus === 'error' || liveStatus === 'aborted'
              ? liveStatus
              : hydratedStatus;
          const pickLonger = <T,>(live: readonly T[] | undefined, hydrated: T[]): T[] => {
            if (!live || hydrated.length >= live.length) return hydrated;
            return [...live];
          };
          return {
            sessions: {
              ...state.sessions,
              [sessionUid]: {
                uid: sessionUid,
                title: session.title,
                status: nextStatus,
                clientId: session.clientId ?? existing?.clientId,
                messages: pickLonger(existing?.messages, messages),
                toolCalls: pickLonger(existing?.toolCalls, toolCalls),
                artifacts: pickLonger(existing?.artifacts, artifacts),
                thoughts: pickLonger(existing?.thoughts, thoughts),
                error: existing?.error,
              },
            },
          };
        });
      } catch (err) {
        console.warn('[useSessionHydration] failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionUid]);
}
