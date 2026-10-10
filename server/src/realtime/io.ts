// Socket.IO server attached to Fastify's underlying http.Server.
// Namespaces:
//   /agent — client chat → agent loop → streamed events, rooms keyed by sessionUid.
//   /bo    — browser-operator bridge (Chrome extension CDP).  Phase 4.

import { Server as SocketIOServer } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { db as prisma } from '../db/prisma.js';
import {
  AGENT_NAMESPACE,
  BROWSER_OPERATOR_NAMESPACE,
  type AgentEventType,
  type AgentEventPayloads,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from './events.js';
import { runContentAgent, cancelContentAgent } from '../agent/content-agent.js';
import { verifyToken, type JwtPayload } from '../middleware/auth.js';

let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;

export function getIO() {
  if (!io) throw new Error('Socket.IO not initialized. Call attachRealtime(app) first');
  return io;
}

// Build the CORS origin policy from env. `SOCKET_IO_CORS_ORIGINS` is a comma-
// separated allowlist; in dev we default to a permissive local-only set.
function buildCorsOrigin(): boolean | string[] {
  const raw = process.env.SOCKET_IO_CORS_ORIGINS?.trim();
  if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production') {
    // Fail closed in prod if no allowlist is configured.
    return [];
  }
  return [
    'http://127.0.0.1:3200',
    'http://localhost:3200',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'app://.',
    'file://',
  ];
}

export async function attachRealtime(app: FastifyInstance) {
  await app.ready();

  const corsOrigin = buildCorsOrigin();
  io = new SocketIOServer(app.server, {
    cors: { origin: corsOrigin, credentials: true },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });
  app.log.info({ corsOrigin }, '[realtime] CORS policy');

  const agentNs = io.of(AGENT_NAMESPACE);

  // Auth gate — JWT from handshake.auth.token or handshake.query.token.
  // Unauthenticated sockets cannot join any session room (reviewer
  // LRN-20260420-010 critical #2).
  agentNs.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);
    if (!token) return next(new Error('unauthorized: no token'));
    try {
      const user = verifyToken(token);
      (socket.data as { user?: JwtPayload }).user = user;
      next();
    } catch {
      next(new Error('unauthorized: invalid token'));
    }
  });

  agentNs.on('connection', (socket) => {
    const user = (socket.data as { user?: JwtPayload }).user;
    app.log.info({ sid: socket.id, userId: user?.userId }, '[rt/agent] connected');

    // Ownership gate — only the session's owner can join its room.  Drafts
    // (no persisted row yet) are allowed since the first run will create
    // with this user's id; legacy rows with null userId are also permitted
    // so pre-migration history stays visible.
    const assertOwner = async (sessionUid: string): Promise<boolean> => {
      // Lookup by globally-unique session uid; orgId match is checked
      // separately below.  `orgId: undefined` opts out of the tenant guard
      // (uid is unique, no leak risk) — we still verify org match before
      // joining the room.
      const row = await prisma.agentSession.findUnique({
        where: { uid: sessionUid, orgId: undefined },
        select: { userId: true, orgId: true },
      });
      if (!row) return true; // draft or not-yet-created
      if (user?.orgId && row.orgId !== user.orgId) return false;
      if (!row.userId) return true; // legacy
      return row.userId === user?.userId;
    };

    socket.on('session:join', async ({ sessionUid }) => {
      if (!sessionUid) return;
      if (!(await assertOwner(sessionUid))) {
        socket.emit('session:left', { sessionUid }); // pretend it doesn't exist
        return;
      }
      await socket.join(sessionUid);
      socket.emit('session:joined', { sessionUid });
    });

    socket.on('session:leave', async ({ sessionUid }) => {
      if (!sessionUid) return;
      await socket.leave(sessionUid);
      socket.emit('session:left', { sessionUid });
    });

    socket.on('agent:run', async ({ sessionUid, input, clientId, history }) => {
      if (!(await assertOwner(sessionUid))) {
        await emitAndPersist(sessionUid, 'agent:error', {
          message: 'Session not found',
          at: new Date().toISOString(),
        });
        return;
      }
      const orgId = user?.orgId;
      if (!orgId) {
        await emitAndPersist(sessionUid, 'agent:error', {
          message: 'Socket token missing org scope. Re-login',
          at: new Date().toISOString(),
        });
        return;
      }
      // Fire and forget — loop emits events to the session room as it runs.
      runContentAgent({ sessionUid, input, clientId, userId: user?.userId, orgId, history }).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ sessionUid, err: msg }, '[rt/agent] run failed');
        await emitAndPersist(sessionUid, 'agent:error', {
          message: msg,
          at: new Date().toISOString(),
        });
      });
    });

    socket.on('agent:cancel', async ({ sessionUid }) => {
      if (!(await assertOwner(sessionUid))) return;
      const cancelled = cancelContentAgent(sessionUid);
      app.log.info({ sessionUid, cancelled }, '[rt/agent] cancel requested');
    });

    socket.on('disconnect', () => {
      app.log.info({ sid: socket.id }, '[rt/agent] disconnected');
    });
  });

  const boNs = io.of(BROWSER_OPERATOR_NAMESPACE);
  boNs.on('connection', (socket) => {
    app.log.info({ sid: socket.id }, '[rt/bo] connected (P4 stub)');
  });

  app.log.info(
    { namespaces: [AGENT_NAMESPACE, BROWSER_OPERATOR_NAMESPACE] },
    '[realtime] Socket.IO attached',
  );

  // Clean shutdown on SIGINT/SIGTERM (Fastify onClose hook can't attach after listen()).
  const shutdown = async () => {
    if (io) {
      await io.close();
      io = null;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// ---------------------------------------------------------------------------
// Wave 1.C — Manus-grade emit helpers (kebab-case event names).
//
// These wrap `emitAndPersist` so each helper writes an `AgentEvent` Prisma row
// best-effort (failures are logged but never thrown — the socket has already
// delivered the event to the client by the time persistence runs).
//
// All six helpers take the *session uid* as the second argument (not a raw
// socket) so a tool can fire from anywhere in the agent loop without
// threading the originating socket through every callsite.  This matches the
// pattern the existing snake_case emits already use.
// ---------------------------------------------------------------------------

export function emitAgentThought(sessionUid: string, content: string): void {
  // Fire-and-forget — emitAndPersist already swallows its own errors and
  // background-persists via queueMicrotask.  We DON'T await so a slow DB
  // doesn't stall the agent loop between thoughts.
  void emitAndPersist(sessionUid, 'agent:thought', {
    text: content,
    at: new Date().toISOString(),
  });
}

export function emitAgentToolCallStart(
  sessionUid: string,
  id: string,
  toolName: string,
  args: Record<string, unknown>,
): void {
  void emitAndPersist(sessionUid, 'agent:tool-call:start', {
    id,
    toolName,
    args,
    timestamp: Date.now(),
  });
}

export function emitAgentToolCallResult(
  sessionUid: string,
  id: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  result?: unknown,
  latencyMs?: number,
): void {
  void emitAndPersist(sessionUid, 'agent:tool-call:result', {
    id,
    status,
    result,
    latencyMs,
    timestamp: Date.now(),
  });
}

export function emitAgentArtifact(
  sessionUid: string,
  url: string,
  mimeType: string,
  label?: string,
): void {
  // The persisted AgentEvent uses `path` for legacy reasons (snake_case
  // artifact payload).  We funnel the new helper through that same shape so
  // replay-from-DB stays back-compatible.
  void emitAndPersist(sessionUid, 'agent:artifact', {
    path: url,
    mimeType,
    preview: label,
    at: new Date().toISOString(),
  });
}

export function emitAgentCompleted(sessionUid: string): void {
  void emitAndPersist(sessionUid, 'agent:completed', {
    sessionId: sessionUid,
    timestamp: Date.now(),
  });
}

export function emitAgentError(sessionUid: string, message: string): void {
  void emitAndPersist(sessionUid, 'agent:error', {
    message,
    at: new Date().toISOString(),
  });
}

// Emit an agent event to the session room AND persist it for replay.
export async function emitAndPersist<T extends AgentEventType>(
  sessionUid: string,
  type: T,
  payload: AgentEventPayloads[T],
): Promise<void> {
  if (!io) return;
  // Emit to the socket room FIRST — this must not block on the DB.  Streamed
  // text deltas fire 20-50/s; awaiting a prisma.create per delta would
  // exhaust the connection pool (superagent LRN-20260420-008 finding #1).
  (io.of(AGENT_NAMESPACE).to(sessionUid).emit as (t: string, p: unknown) => boolean)(type, payload);

  // Persist in the background — fire-and-forget.  Drop rather than block.
  queueMicrotask(async () => {
    try {
      // uid is globally-unique; cross-org lookup is intentional here so the
      // event-persistence pipeline works regardless of caller scope.
      const session = await prisma.agentSession.findUnique({
        where: { uid: sessionUid, orgId: undefined },
        select: { id: true, orgId: true },
      });
      if (!session) return;
      await prisma.agentEvent.create({
        data: { sessionId: session.id, orgId: session.orgId, type, payload: payload as object },
      });
    } catch (err) {
      // Best-effort persistence, but DON'T hide failures — operators need to
      // see connection-pool exhaustion or schema drift.  The socket already
      // delivered the event to the client; the log is the only signal left.
      // eslint-disable-next-line no-console
      console.error('[rt/emitAndPersist] event persist failed', {
        sessionUid,
        type,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
