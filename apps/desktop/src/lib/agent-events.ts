// Mirror of server/src/realtime/events.ts — keep in sync.
// Shared event taxonomy for the agent real-time spine.

export type AgentEventType =
  | 'agent:start'
  | 'agent:thought'
  | 'agent:tool_start'
  | 'agent:tool_result'
  | 'agent:artifact'
  | 'agent:message'
  | 'agent:complete'
  | 'agent:error';

export interface AgentEventPayloads {
  'agent:start': { sessionUid: string; input: string; at: string };
  'agent:thought': { text: string; at: string };
  'agent:tool_start': { toolCallId: string; tool: string; args: Record<string, unknown>; at: string };
  'agent:tool_result': { toolCallId: string; tool: string; ok: boolean; result?: unknown; error?: string; at: string };
  'agent:artifact': { path: string; mimeType?: string; bytes?: number; preview?: string; at: string };
  'agent:message': { text: string; streaming?: boolean; at: string };
  'agent:complete': { at: string; summary?: string };
  'agent:error': { message: string; at: string };
}

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
}

export interface ClientToServerEvents {
  'session:join': (data: { sessionUid: string }) => void;
  'session:leave': (data: { sessionUid: string }) => void;
  'agent:run': (data: { sessionUid: string; input: string; clientId?: string }) => void;
  'agent:cancel': (data: { sessionUid: string }) => void;
}

export const AGENT_NAMESPACE = '/agent';
