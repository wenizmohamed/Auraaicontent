// Zustand slice for the /agent Socket.IO event stream.
//
// Wave 1.C foundation — store ONLY.  Agent.tsx is NOT rewritten here; the
// Wave-2 surface pass will consume this store.  Event shapes mirror the
// kebab-case names introduced in server/src/realtime/io.ts (agent:thought,
// agent:tool-call:start, agent:tool-call:result, agent:artifact,
// agent:completed, agent:error).
//
// Reconciliation contract: socket disconnects are NOT trusted as terminal —
// the rehydration loop pulls AgentMessage / AgentEvent rows by sessionId on
// reconnect.  Until that happens, this store keeps the ring buffer capped at
// 500 events (FIFO discard oldest) so a single runaway loop cannot leak memory.

import { create } from 'zustand';

// ---------- Event shapes (kebab-case, mirrors server emit helpers) ----------

export type ThoughtEntry = {
  id: string;
  type: 'thought';
  content: string;
  timestamp: number;
};

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ToolCallCard = {
  id: string;
  type: 'tool-call';
  toolName: string;
  // `args` is intentionally `any`: the union of every tool's parameter shape
  // is open-ended (9 tools today, more on the roadmap) and the store treats
  // it as opaque pass-through to the UI which renders via <pre>JSON</pre>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  status: ToolCallStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  latencyMs?: number;
  timestamp: number;
};

export type ArtifactEntry = {
  id: string;
  type: 'artifact';
  url: string;
  mimeType: string;
  label?: string;
  timestamp: number;
};

export type CompletedEntry = {
  id: string;
  type: 'completed';
  sessionId: string;
  timestamp: number;
};

export type ErrorEntry = {
  id: string;
  type: 'error';
  message: string;
  timestamp: number;
};

export type AgentStreamEvent =
  | ThoughtEntry
  | ToolCallCard
  | ArtifactEntry
  | CompletedEntry
  | ErrorEntry;

export type AgentStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

// ---------- Store shape ----------

export interface AgentStoreState {
  // The ring buffer of every event seen for the current session, in arrival
  // order.  Capped at MAX_EVENTS (500) FIFO.
  events: AgentStreamEvent[];

  // Convenience projections — these are derived from `events` but kept as
  // separate arrays so the timeline / tool-card grid / artifact rail each
  // subscribe to a tight slice without re-filtering on every render.
  thoughts: ThoughtEntry[];
  toolCalls: Map<string, ToolCallCard>;
  artifacts: ArtifactEntry[];

  sessionId: string | null;
  status: AgentStatus;
  error: string | null;

  // ---------- Actions ----------
  // `connect` is a state transition only — actual Socket.IO wiring lives in
  // the Agent page component (Wave 2).  Calling connect() here just flips the
  // status to 'connecting' and stamps the sessionId so the UI can render a
  // skeleton.
  connect(sessionId: string): void;
  disconnect(): void;
  appendEvent(e: AgentStreamEvent): void;
  updateToolCall(id: string, partial: Partial<Omit<ToolCallCard, 'id' | 'type'>>): void;
  reset(): void;
}

const MAX_EVENTS = 500;

// ---------- Store ----------

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  events: [],
  thoughts: [],
  toolCalls: new Map(),
  artifacts: [],
  sessionId: null,
  status: 'idle',
  error: null,

  connect(sessionId) {
    set({
      sessionId,
      status: 'connecting',
      error: null,
    });
  },

  disconnect() {
    set({ status: 'idle' });
  },

  appendEvent(e) {
    const state = get();

    // FIFO cap — drop the oldest event when we cross the threshold.  We also
    // refresh the projection arrays here so consumers don't have to compute
    // diffs on every render.
    let nextEvents = [...state.events, e];
    if (nextEvents.length > MAX_EVENTS) {
      nextEvents = nextEvents.slice(nextEvents.length - MAX_EVENTS);
    }

    const patch: Partial<AgentStoreState> = { events: nextEvents };

    switch (e.type) {
      case 'thought': {
        // Re-derive the thoughts list from the (possibly pruned) buffer so we
        // stay consistent with the FIFO cap.
        patch.thoughts = nextEvents.filter(
          (ev): ev is ThoughtEntry => ev.type === 'thought',
        );
        patch.status = 'streaming';
        break;
      }
      case 'tool-call': {
        const nextMap = new Map(state.toolCalls);
        // Merge against any prior entry so a `running -> completed` second
        // emission for the same id doesn't blow away the original args.
        const prior = nextMap.get(e.id);
        nextMap.set(e.id, prior ? { ...prior, ...e } : e);
        patch.toolCalls = nextMap;
        patch.status = 'streaming';
        break;
      }
      case 'artifact': {
        patch.artifacts = [...state.artifacts, e];
        patch.status = 'streaming';
        break;
      }
      case 'completed': {
        patch.status = 'completed';
        break;
      }
      case 'error': {
        patch.status = 'error';
        patch.error = e.message;
        break;
      }
    }

    set(patch);
  },

  updateToolCall(id, partial) {
    const state = get();
    const existing = state.toolCalls.get(id);
    if (!existing) return;
    const merged: ToolCallCard = { ...existing, ...partial };
    const nextMap = new Map(state.toolCalls);
    nextMap.set(id, merged);

    // Also reflect the update in the canonical event ring so a reload from
    // `events` alone reconstitutes the same state.
    const nextEvents = state.events.map((ev) =>
      ev.type === 'tool-call' && ev.id === id ? merged : ev,
    );

    set({ toolCalls: nextMap, events: nextEvents });
  },

  reset() {
    set({
      events: [],
      thoughts: [],
      toolCalls: new Map(),
      artifacts: [],
      sessionId: null,
      status: 'idle',
      error: null,
    });
  },
}));
