// Zustand store for agent session state.
// Stores metadata + COMPLETED messages only.  Live token streams use
// the ref-backed useStreamEvent hook to avoid re-render storms
// (superagent LRN-20260420-008 finding — never put 20hz deltas in React state).

import { create } from 'zustand';
import type { AgentEventPayloads } from '../lib/agent-events';

export type AgentPhase = 'idle' | 'running' | 'aborted' | 'complete' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;        // toolCallId from the event
  tool: string;
  args: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface Artifact {
  id: string;        // path acts as id
  path: string;
  mimeType?: string;
  bytes?: number;
  preview?: string;
  at: string;
}

export interface Thought {
  id: string;
  text: string;
  at: string;
}

export interface AgentSession {
  uid: string;
  title: string;
  status: AgentPhase;
  clientId?: string;
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  thoughts: Thought[];
  error?: string;
}

interface AgentStore {
  sessions: Record<string, AgentSession>;
  activeSessionUid: string | null;

  // Actions
  setActive(uid: string | null): void;
  upsertSession(s: Partial<AgentSession> & { uid: string }): void;

  pushMessage(uid: string, m: ChatMessage): void;
  pushThought(uid: string, t: Thought): void;
  pushToolStart(uid: string, p: AgentEventPayloads['agent:tool_start']): void;
  pushToolResult(uid: string, p: AgentEventPayloads['agent:tool_result']): void;
  pushArtifact(uid: string, p: AgentEventPayloads['agent:artifact']): void;

  setPhase(uid: string, phase: AgentPhase, error?: string): void;
  reset(uid: string): void;
}

// Prefer crypto.randomUUID when available — Math.random 8-char ids collide at
// ~400K rows (birthday paradox).  Falls back to base36 on old contexts.
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

function ensureSession(s: AgentStore, sessionUid: string): AgentSession {
  let existing = s.sessions[sessionUid];
  if (!existing) {
    existing = {
      uid: sessionUid,
      title: 'New session',
      status: 'idle',
      messages: [],
      toolCalls: [],
      artifacts: [],
      thoughts: [],
    };
    s.sessions[sessionUid] = existing;
  }
  return existing;
}

export const useAgentStore = create<AgentStore>((set) => ({
  sessions: {},
  activeSessionUid: null,

  setActive: (uid) => set({ activeSessionUid: uid }),

  upsertSession: (s) => set((state) => {
    const existing = ensureSession(state, s.uid);
    return {
      sessions: {
        ...state.sessions,
        [s.uid]: { ...existing, ...s },
      },
    };
  }),

  pushMessage: (u, m) => set((state) => {
    const sess = ensureSession(state, u);
    return {
      sessions: {
        ...state.sessions,
        [u]: { ...sess, messages: [...sess.messages, m] },
      },
    };
  }),

  pushThought: (u, t) => set((state) => {
    const sess = ensureSession(state, u);
    return {
      sessions: {
        ...state.sessions,
        [u]: { ...sess, thoughts: [...sess.thoughts, t] },
      },
    };
  }),

  pushToolStart: (u, p) => set((state) => {
    const sess = ensureSession(state, u);
    const call: ToolCall = {
      id: p.toolCallId,
      tool: p.tool,
      args: p.args,
      startedAt: p.at,
    };
    return {
      sessions: {
        ...state.sessions,
        [u]: { ...sess, toolCalls: [...sess.toolCalls, call] },
      },
    };
  }),

  pushToolResult: (u, p) => set((state) => {
    const sess = ensureSession(state, u);
    const updated = sess.toolCalls.map((tc) =>
      tc.id === p.toolCallId
        ? { ...tc, finishedAt: p.at, ok: p.ok, result: p.result, error: p.error }
        : tc,
    );
    return {
      sessions: {
        ...state.sessions,
        [u]: { ...sess, toolCalls: updated },
      },
    };
  }),

  pushArtifact: (u, p) => set((state) => {
    const sess = ensureSession(state, u);
    return {
      sessions: {
        ...state.sessions,
        [u]: {
          ...sess,
          artifacts: [
            ...sess.artifacts,
            { id: p.path, path: p.path, mimeType: p.mimeType, bytes: p.bytes, preview: p.preview, at: p.at },
          ],
        },
      },
    };
  }),

  setPhase: (u, phase, error) => set((state) => {
    const sess = ensureSession(state, u);
    return {
      sessions: {
        ...state.sessions,
        [u]: { ...sess, status: phase, error },
      },
    };
  }),

  reset: (u) => set((state) => ({
    sessions: {
      ...state.sessions,
      [u]: {
        uid: u,
        title: state.sessions[u]?.title ?? 'New session',
        status: 'idle',
        messages: [],
        toolCalls: [],
        artifacts: [],
        thoughts: [],
      },
    },
  })),
}));

// Stable empty sentinels — returning a FRESH `[]` on every selector call
// triggers Zustand 5's "getSnapshot should be cached" infinite-loop warning.
const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);
const EMPTY_TOOLCALLS: readonly ToolCall[] = Object.freeze([]);
const EMPTY_ARTIFACTS: readonly Artifact[] = Object.freeze([]);
const EMPTY_THOUGHTS: readonly Thought[] = Object.freeze([]);

// Selector helpers — keep components subscribed to NARROW slices to minimize re-renders.
export const selectSession = (uid: string | null) => (s: AgentStore): AgentSession | null =>
  uid ? s.sessions[uid] ?? null : null;

export const selectMessages = (uid: string | null) => (s: AgentStore): readonly ChatMessage[] =>
  (uid && s.sessions[uid]?.messages) || EMPTY_MESSAGES;

export const selectToolCalls = (uid: string | null) => (s: AgentStore): readonly ToolCall[] =>
  (uid && s.sessions[uid]?.toolCalls) || EMPTY_TOOLCALLS;

export const selectArtifacts = (uid: string | null) => (s: AgentStore): readonly Artifact[] =>
  (uid && s.sessions[uid]?.artifacts) || EMPTY_ARTIFACTS;

export const selectThoughts = (uid: string | null) => (s: AgentStore): readonly Thought[] =>
  (uid && s.sessions[uid]?.thoughts) || EMPTY_THOUGHTS;

export const selectPhase = (uid: string | null) => (s: AgentStore): AgentPhase =>
  uid ? s.sessions[uid]?.status ?? 'idle' : 'idle';

export { uid as generateMessageId };
