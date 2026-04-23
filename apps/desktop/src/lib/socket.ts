// Typed Socket.IO client for the agent namespace.
// Reconnects automatically; single shared singleton per app lifetime.

import { io, type Socket } from 'socket.io-client';
import type {
  AgentEventPayloads,
  AgentEventType,
  ClientToServerEvents,
  ServerToClientEvents,
} from './agent-events';
import { AGENT_NAMESPACE } from './agent-events';
import { API_URL } from './api-url';

export type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let agentSocket: AgentSocket | null = null;

function getAuthToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem('radix_auth_token') : null;
  } catch {
    return null;
  }
}

export function getAgentSocket(): AgentSocket {
  if (agentSocket && agentSocket.connected) return agentSocket;
  if (!agentSocket) {
    agentSocket = io(`${API_URL}${AGENT_NAMESPACE}`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      // Refresh the JWT on every (re)connect so token rotation works.
      auth: (cb) => cb({ token: getAuthToken() ?? '' }),
    });
  } else if (!agentSocket.connected) {
    agentSocket.connect();
  }
  return agentSocket;
}

export function disconnectAgentSocket(): void {
  if (agentSocket) {
    agentSocket.disconnect();
    agentSocket = null;
  }
}

// Convenience: subscribe to one event type with full type inference.
export function onAgentEvent<T extends AgentEventType>(
  socket: AgentSocket,
  type: T,
  handler: (payload: AgentEventPayloads[T]) => void,
): () => void {
  socket.on(type, handler as never);
  return () => socket.off(type, handler as never);
}
