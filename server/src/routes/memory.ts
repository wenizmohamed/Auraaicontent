// Memory routes — explicit management of the experiential-memory / learnings
// layer. Automatic capture happens elsewhere (review comments → review.service,
// failed/regenerated calls → batch 4). These endpoints let the app and the user
// record a learning directly ("always include a CTA"), review what's been
// learned, and retire a lesson that's no longer right.
//
// All tenant-scoped via authGuard + request.orgId. Learnings are never
// hard-deleted — DELETE archives (status='archived') so history is preserved.

import { errStatus, errMessage } from '../services/providers/errors.js';
import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { db } from '../db/prisma.js';
import { recordMemory, MemoryKind } from '../services/memory.service.js';
import { assertClientInOrg } from '../lib/tenant.js';

const KINDS: MemoryKind[] = ['correction', 'preference', 'pattern', 'failure', 'success'];

export async function memoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/memory?clientId=&limit= — recent active learnings for the org
  // (this client's + org-wide when clientId is given; all when it isn't).
  app.get('/memory', async (request) => {
    const orgId = request.orgId!;
    const { clientId, limit } = request.query as { clientId?: string; limit?: string };
    const take = Math.min(Number(limit) || 50, 200);
    return db.memory.findMany({
      where: {
        orgId,
        status: 'active',
        ...(clientId ? { OR: [{ clientId }, { clientId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, clientId: true, kind: true, source: true,
        content: true, context: true, weight: true, useCount: true, createdAt: true,
      },
    });
  });

  // POST /api/memory { content, kind?, clientId?, context? } — record a learning.
  app.post('/memory', async (request, reply) => {
    const orgId = request.orgId!;
    const userId = request.user?.userId;
    const body = (request.body || {}) as {
      content?: string; kind?: string; clientId?: string | null; context?: string;
    };
    if (!body.content?.trim()) return reply.status(400).send({ error: 'content is required' });

    const kind: MemoryKind = KINDS.includes(body.kind as MemoryKind)
      ? (body.kind as MemoryKind)
      : 'preference';

    if (body.clientId) {
      try {
        await assertClientInOrg(body.clientId, orgId);
      } catch (err) {
        return reply.status(errStatus(err, 400)).send({ error: errMessage(err) });
      }
    }

    const id = await recordMemory({
      orgId,
      userId,
      clientId: body.clientId ?? null,
      kind,
      source: 'explicit',
      content: body.content,
      context: body.context ?? null,
    });
    if (!id) return reply.status(500).send({ error: 'Failed to record memory' });
    return { id };
  });

  // DELETE /api/memory/:id — archive (never hard-delete a learning).
  app.delete('/memory/:id', async (request, reply) => {
    const orgId = request.orgId!;
    const { id } = request.params as { id: string };
    const res = await db.memory.updateMany({
      where: { id, orgId },
      data: { status: 'archived' },
    });
    if (res.count === 0) return reply.status(404).send({ error: 'Not found' });
    return { success: true };
  });
}
