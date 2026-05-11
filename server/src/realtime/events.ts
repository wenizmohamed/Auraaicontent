// Shared event taxonomy for the agent real-time spine.
// Mirrored by apps/desktop/src/lib/agent-events.ts — keep in sync.
//
// Wave 1.C (2026-05-12) added the kebab-case Manus-grade event variants
// alongside the original snake_case ones.  Existing emit signatures are
// preserved verbatim; the new names are additive so the Zustand store
// (apps/desktop/src/store/agent.ts) can consume them without breaking the
// pre-Wave-1 Agent.tsx that still reads snake_case.

export type AgentEventType =
  | 'agent:start'
  | 'agent:thought'
  | 'agent:tool_start'
  | 'agent:tool_result'
  | 'agent:artifact'
  | 'agent:message'
  | 'agent:complete'
  | 'agent:error'
  // Wave 1.C — Manus-grade kebab-case variants for the new store.
  | 'agent:tool-call:start'
  | 'agent:tool-call:result'
  | 'agent:completed';

export interface AgentEventPayloads {
  'agent:start': { sessionUid: string; input: string; at: string };
  'agent:thought': { text: string; at: string };
  'agent:tool_start': { toolCallId: string; tool: string; args: Record<string, unknown>; at: string };
  'agent:tool_result': { toolCallId: string; tool: string; ok: boolean; result?: unknown; error?: string; at: string };
  'agent:artifact': { path: string; mimeType?: string; bytes?: number; preview?: string; at: string };
  'agent:message': { text: string; streaming?: boolean; at: string };
  'agent:complete': { at: string; summary?: string };
  'agent:error': { message: string; at: string };
  // Wave 1.C — kebab-case payloads.  `id` is the client-side toolCall id
  // (uuid) that pairs `:start` with `:result`.  `args` mirrors the existing
  // snake_case tool_start `args` shape.  `status` is one of pending/running/
  // completed/failed; we keep all four so the store can model "queued but
  // not yet dispatched" without inventing a separate event.
  'agent:tool-call:start': {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    timestamp: number;
  };
  'agent:tool-call:result': {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: unknown;
    latencyMs?: number;
    timestamp: number;
  };
  'agent:completed': { sessionId: string; timestamp: number };
}

export type AgentEvent<T extends AgentEventType = AgentEventType> = {
  type: T;
  payload: AgentEventPayloads[T];
};

// Client → server events over /agent namespace
export interface ClientToServerEvents {
  'session:join': (data: { sessionUid: string }) => void;
  'session:leave': (data: { sessionUid: string }) => void;
  'agent:run': (data: { sessionUid: string; input: string; clientId?: string }) => void;
  'agent:cancel': (data: { sessionUid: string }) => void;
}

// Server → client events (union of all AgentEvent types plus meta)
export interface ServerToClientEvents {
  'session:joined': (data: { sessionUid: string }) => void;
  'session:left': (data: { sessionUid: string }) => void;
  'agent:start': (p: AgentEventPayloads['agent:start']) => void;
  'agent:thought': (p: AgentEventPayloads['agent:thought']) => void;
  'agent:tool_start': (p: AgentEventPayloads['agent:tool_start']) => void;
  'agent:tool_result': (p: AgentEventPayloads['agent:tool_result']) => void;
  'agent:artifact': (p: AgentEventPayloads['agent:artifact']) => void;
  'agent:message': (p: AgentEventPayloads['agent:message']) => void;
  'agent:complete': (p: AgentEventPayloads['agent:complete']) => void;
  'agent:error': (p: AgentEventPayloads['agent:error']) => void;
  // Wave 1.C — kebab-case variants for the Zustand store.
  'agent:tool-call:start': (p: AgentEventPayloads['agent:tool-call:start']) => void;
  'agent:tool-call:result': (p: AgentEventPayloads['agent:tool-call:result']) => void;
  'agent:completed': (p: AgentEventPayloads['agent:completed']) => void;
}

export const AGENT_NAMESPACE = '/agent';
export const BROWSER_OPERATOR_NAMESPACE = '/bo';
