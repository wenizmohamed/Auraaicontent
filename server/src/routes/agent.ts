// REST routes for the agent platform.
// Socket.IO is the preferred transport, but these endpoints support:
//   - POST /api/agent/sessions      create a session (returns uid)
//   - GET  /api/agent/sessions      list recent sessions
//   - GET  /api/agent/sessions/:uid get session + messages + events
//   - POST /api/agent/runs          kick off a run (returns immediately, stream on WS)
//   - POST /api/agent/runs/:uid/cancel

import { errStatus, errMessage } from '../services/providers/errors.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'crypto';
import { db as prisma } from '../db/prisma.js';
import { runContentAgent, cancelContentAgent } from '../agent/content-agent.js';
import { AGENT_TEMPLATES, getTemplate } from '../agent/templates.js';
import { emitAndPersist } from '../realtime/io.js';
import { authGuard, type JwtPayload } from '../middleware/auth.js';
import { assertClientInOrg } from '../lib/tenant.js';

function ownerOf(req: FastifyRequest): JwtPayload {
  return (req as unknown as { user: JwtPayload }).user;
}

function shortUid(): string {
  return randomBytes(11).toString('base64url').slice(0, 22);
}

export async function agentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  app.post<{ Body: { title?: string; clientId?: string } }>('/sessions', async (req, reply) => {
    const { userId } = ownerOf(req);
    const orgId = req.orgId!;
    const { title, clientId } = req.body ?? {};

    if (clientId) {
      try {
        await assertClientInOrg(clientId, orgId);
      } catch (err) {
        return reply.status(errStatus(err)).send({ error: errMessage(err) });
      }
    }

    const uid = shortUid();
    const session = await prisma.agentSession.create({
      data: {
        uid,
        orgId,
        userId,
        title: title ?? 'New agent session',
        clientId: clientId ?? null,
      },
    });
    return reply.send({ uid: session.uid, id: session.id, title: session.title });
  });

  app.get<{ Querystring: { limit?: string; clientId?: string } }>('/sessions', async (req) => {
    const { userId } = ownerOf(req);
    const orgId = req.orgId!;
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const where = {
      orgId,
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
    const orgId = req.orgId!;
    const session = await prisma.agentSession.findUnique({
      where: { uid: req.params.uid, orgId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    });
    if (!session || session.orgId !== orgId) return reply.code(404).send({ error: 'Session not found' });
    if (session.userId && session.userId !== userId) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return { session };
  });

  app.post<{ Body: { sessionUid?: string; input: string; clientId?: string; history?: unknown } }>('/runs', async (req, reply) => {
    const { userId } = ownerOf(req);
    const orgId = req.orgId!;
    const { input, clientId } = req.body ?? { input: '' };
    if (!input?.trim()) return reply.code(400).send({ error: 'input is required' });

    const sessionUid = req.body.sessionUid ?? shortUid();

    if (clientId) {
      try {
        await assertClientInOrg(clientId, orgId);
      } catch (err) {
        return reply.status(errStatus(err)).send({ error: errMessage(err) });
      }
    }

    const existing = await prisma.agentSession.findUnique({
      where: { uid: sessionUid, orgId },
      select: { userId: true, orgId: true },
    });
    if (existing && (existing.orgId !== orgId || (existing.userId && existing.userId !== userId))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    runContentAgent({ sessionUid, input, clientId, userId, orgId, history: req.body.history }).catch(async (err) => {
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

  // ─── Agent template registry ──────────────────────────────────────
  // Visible at GET /api/agent/templates and GET /api/agent/templates/:id.
  // Templates are static, no per-org customization yet — that lands when
  // we wire the prompt-tuner UI.
  app.get('/templates', async () => {
    return {
      templates: AGENT_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        shortLabel: t.shortLabel,
        description: t.description,
        starterPrompt: t.starterPrompt,
        tags: t.tags,
        preferredModel: t.preferredModel,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/templates/:id', async (req, reply) => {
    const template = getTemplate(req.params.id);
    if (!template) return reply.code(404).send({ error: 'Template not found' });
    return { template };
  });

  app.post<{ Params: { uid: string } }>('/runs/:uid/cancel', async (req, reply) => {
    const { userId } = ownerOf(req);
    const orgId = req.orgId!;
    const session = await prisma.agentSession.findUnique({
      where: { uid: req.params.uid, orgId },
      select: { userId: true, orgId: true },
    });
    if (!session || session.orgId !== orgId || (session.userId && session.userId !== userId)) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const cancelled = cancelContentAgent(req.params.uid);
    return { cancelled };
  });
}
