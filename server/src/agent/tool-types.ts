// Tool contract for the agent loop.
// Each tool exports `const tool: Tool<Args, Result>` — the loop registry
// composes all of them.  JSON-schema `input_schema` matches Anthropic's
// tool_use wire format so the loop can hand them to Messages.create() as-is.

import type { PrismaClient } from '@prisma/client';
import type { AgentEventType, AgentEventPayloads } from '../realtime/events.js';

export interface ToolContext {
  sessionUid: string;
  sessionId: string;
  clientId?: string | null;
  prisma: PrismaClient;
  // Emit an event to the /agent Socket.IO room (persisted via emitAndPersist).
  // Typed against the shared AgentEventType/Payloads map so TS catches drift
  // at the tool boundary (reviewer LRN-20260420-010 finding #5).
  emit: <T extends AgentEventType>(type: T, payload: AgentEventPayloads[T]) => Promise<void>;
  // AbortSignal trips when user fires agent:cancel.
  signal: AbortSignal;
}

export interface Tool<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  // JSON Schema draft 2020-12 subset accepted by Anthropic tool_use.
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (args: Args, ctx: ToolContext) => Promise<Result>;
}

// Helper to narrow `args` at the handler boundary.
export function defineTool<Args extends object, Result>(t: Tool<Args, Result>): Tool<Args, Result> {
  return t;
}
