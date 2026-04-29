// Public entrypoint for the agent: handles session + cancellation,
// wires ctx.emit to emitAndPersist (Socket.IO + AgentEvent persistence),
// delegates to runAgentLoop.

import { db as prisma } from '../db/prisma.js';
import { emitAndPersist } from '../realtime/io.js';
import { runAgentLoop, type RunAgentResult } from './loop.js';
import type { ToolContext } from './tool-types.js';
import type { AgentEventType, AgentEventPayloads } from '../realtime/events.js';

// In-flight session aborts, keyed by sessionUid.
const activeRuns = new Map<string, AbortController>();

export interface RunContentAgentArgs {
  sessionUid: string;
  input: string;
  clientId?: string | null;
  /** Owner of the session.  Required for new sessions; existing-session runs
   *  inherit their existing userId and this arg is ignored. */
  userId?: string | null;
  /** Active organization for tenant-scoped writes. Required for new sessions;
   *  existing-session runs inherit their existing orgId. */
  orgId: string;
}

export async function runContentAgent(args: RunContentAgentArgs): Promise<RunAgentResult> {
  const { sessionUid, input, clientId, userId, orgId } = args;

  // Cancel any prior run on the same session
  const prior = activeRuns.get(sessionUid);
  if (prior) prior.abort();

  const controller = new AbortController();
  activeRuns.set(sessionUid, controller);

  // Ensure AgentSession + user message land atomically.  Interactive
  // transaction is the right primitive — the message create depends on the
  // session.id the upsert just produced, so they can't be a batch array.
  // Without this an upsert success followed by a create failure produces
  // an orphan session with no input record (aura-rating 2026-04-20 P1).
  // userId is only set on CREATE — never overwrites an existing row (protects
  // against a compromised endpoint trying to steal a session by re-upserting).
  // status is flipped to 'running' on BOTH create and update so the sidebar
  // dot + hydration see a live phase instead of the 'active' default that
  // statusToPhase() maps back to 'idle' (aura-debug 2026-04-20).
  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.agentSession.upsert({
      // uid is globally unique; orgId in the unique-where keeps the tenant
      // guard happy AND ensures a uid collision across orgs (shouldn't ever
      // happen) surfaces as a uid-uniqueness error instead of silently
      // updating a cross-org row.
      where: { uid: sessionUid, orgId },
      update: { updatedAt: new Date(), status: 'running', ...(clientId ? { clientId } : {}) },
      create: {
        uid: sessionUid,
        orgId,
        userId: userId ?? null,
        title: input.slice(0, 60),
        status: 'running',
        clientId: clientId ?? null,
      },
    });
    await tx.agentMessage.create({
      data: { sessionId: s.id, orgId: s.orgId, role: 'user', content: input },
    });
    return s;
  });

  const ctx: ToolContext = {
    sessionUid,
    sessionId: session.id,
    orgId: session.orgId,
    clientId: clientId ?? null,
    prisma,
    signal: controller.signal,
    emit: async (type, payload) => {
      await emitAndPersist(
        sessionUid,
        type as AgentEventType,
        payload as AgentEventPayloads[AgentEventType],
      );
    },
  };

  try {
    const result = await runAgentLoop({ input, ctx });

    // Persist final assistant message — content may be string or null (when
    // the assistant only emitted tool_calls). Coerce null/array to string.
    const lastAssistant = [...result.messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      const raw = lastAssistant.content;
      let text: string;
      if (typeof raw === 'string') text = raw;
      else if (Array.isArray(raw))
        text = raw
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      else text = '';
      if (text.trim()) {
        await prisma.agentMessage.create({
          data: { sessionId: session.id, orgId: session.orgId, role: 'assistant', content: text.slice(0, 50000) },
        });
      }
    }

    await prisma.agentSession.update({
      where: { id: session.id, orgId: session.orgId },
      data: {
        status: result.stopReason === 'end_turn' ? 'completed' : 'failed',
        updatedAt: new Date(),
      },
    });

    return result;
  } finally {
    if (activeRuns.get(sessionUid) === controller) {
      activeRuns.delete(sessionUid);
    }
  }
}

export function cancelContentAgent(sessionUid: string): boolean {
  const controller = activeRuns.get(sessionUid);
  if (!controller) return false;
  controller.abort();
  activeRuns.delete(sessionUid);
  return true;
}
