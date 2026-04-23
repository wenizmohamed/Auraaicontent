// REST routes for the agent platform.
// Socket.IO is the preferred transport, but these endpoints support:
//   - POST /api/agent/sessions      create a session (returns uid)
//   - GET  /api/agent/sessions      list recent sessions
//   - GET  /api/agent/sessions/:uid get session + messages + events
//   - POST /api/agent/runs          kick off a run (returns immediately, stream on WS)
//   - POST /api/agent/runs/:uid/cancel

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'crypto';
import { db as prisma } from '../db/prisma.js';
import { runContentAgent, cancelContentAgent } from '../agent/content-agent.js';
import { emitAndPersist } from '../realtime/io.js';
import { authGuard, type JwtPayload } from '../middleware/auth.js';

// Every agent route is gated by authGuard above; this helper extracts the
// attached user payload without leaking `any` into every handler.
function ownerOf(req: FastifyRequest): JwtPayload {
  return (req as unknown as { user: JwtPayload }).user;
}

function shortUid(): string {
  return randomBytes(11).toString('base64url').slice(0, 22);
}

export async function agentRoutes(app: FastifyInstance) {
  // Every agent route is authenticated — burns Anthropic credits + leaks
  // tenant data otherwise (reviewer LRN-20260420-010 critical #1).
  app.addHook('preHandler', authGuard);

  app.post<{ Body: { title?: string; clientId?: string } }>('/sessions', async (req, reply) => {
    const { userId } = ownerOf(req);
    const { title, clientId } = req.body ?? {};
    const uid = shortUid();
    const session = await prisma.agentSession.create({
      data: {
        uid,
        userId,
        title: title ?? 'New agent session',
        clientId: clientId ?? null,
      },
    });
    return reply.send({ uid: session.uid, id: session.id, title: session.title });
  });

  app.get<{ Querystring: { limit?: string; clientId?: string } }>('/sessions', async (req) => {
    const { userId } = ownerOf(req);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const where = {
      userId,
      ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    };
    const sessions = await prisma.agentSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        uid: true,
        title: true,
        status: true,
        clientId: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    return { sessions };
  });

  app.get<{ Params: { uid: string } }>('/sessions/:uid', async (req, reply) => {
    const { userId } = ownerOf(req);
    const session = await prisma.agentSession.findUnique({
      where: { uid: req.params.uid },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    // Ownership check AFTER existence check so attackers can't probe uid-space
    // via 403-vs-404 timing.  404 either way.
    if (session.userId && session.userId !== userId) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return { session };
  });

  app.post<{ Body: { sessionUid?: string; input: string; clientId?: string } }>('/runs', async (req, reply) => {
    const { userId } = ownerOf(req);
    const { input, clientId } = req.body ?? { input: '' };
    if (!input?.trim()) return reply.code(400).send({ error: 'input is required' });

    const sessionUid = req.body.sessionUid ?? shortUid();

    // If the session already exists, it must belong to this user.  Returning
    // 404 rather than 403 prevents uid-probing.
    const existing = await prisma.agentSession.findUnique({
      where: { uid: sessionUid },
      select: { userId: true },
    });
    if (existing && existing.userId && existing.userId !== userId) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Fire and forget; stream events on Socket.IO /agent + sessionUid room.
    // On failure we MUST re-emit 'agent:error' so the client leaves the
    // 'running' phase — otherwise it hangs forever (aura-rating 2026-04-20 P1).
    runContentAgent({ sessionUid, input, clientId, userId }).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ sessionUid, err: msg }, '[agent/run] failed');
      try {
        await emitAndPersist(sessionUid, 'agent:error', {
          message: msg,
          at: new Date().toISOString(),
        });
      } catch (emitErr) {
        req.log.error({ sessionUid, emitErr }, '[agent/run] failed to notify client of error');
      }
    });

    return reply.send({ sessionUid, started: true });
  });

  app.post<{ Params: { uid: string } }>('/runs/:uid/cancel', async (req, reply) => {
    const { userId } = ownerOf(req);
    const session = await prisma.agentSession.findUnique({
      where: { uid: req.params.uid },
      select: { userId: true },
    });
    // Hide unknown-uid and not-yours behind the same 404.
    if (!session || (session.userId && session.userId !== userId)) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const cancelled = cancelContentAgent(req.params.uid);
    return { cancelled };
  });
}
