import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';

// ContentPiece CRUD — production-tracking queue for a client.  Separate from
// CalendarPost (marketing calendar output); this tracks reels/images/stories
// with station + assignee + deadline + review status.  Moved from browser
// localStorage to backend on 2026-04-24 (rating P1).
export async function contentPieceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/content-pieces
  app.get('/clients/:clientId/content-pieces', async (request) => {
    const { clientId } = request.params as { clientId: string };
    return db.contentPiece.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/clients/:clientId/content-pieces
  app.post('/clients/:clientId/content-pieces', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = (request.body || {}) as Record<string, unknown>;

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const type = typeof body.type === 'string' ? body.type : '';
    const station = typeof body.station === 'string' ? body.station : '';
    if (!title) return reply.status(400).send({ error: 'title is required' });
    if (!type) return reply.status(400).send({ error: 'type is required' });
    if (!station) return reply.status(400).send({ error: 'station is required' });

    // Client must exist
    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    return db.contentPiece.create({
      data: {
        clientId,
        title,
        type,
        station,
        topicId: typeof body.topicId === 'string' ? body.topicId : '',
        status: typeof body.status === 'string' ? body.status : 'Draft',
        assignee: typeof body.assignee === 'string' ? body.assignee : '',
        deadline: typeof body.deadline === 'string' ? body.deadline : '',
        visualRefUrl: typeof body.visualRefUrl === 'string' ? body.visualRefUrl : '',
        visualRefImage: typeof body.visualRefImage === 'string' ? body.visualRefImage : '',
        notes: typeof body.notes === 'string' ? body.notes : '',
      },
    });
  });

  // PATCH /api/content-pieces/:id
  app.patch('/content-pieces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as Record<string, unknown>;

    // Only permit known fields; drop id/clientId/createdAt/updatedAt to keep ownership immutable.
    const allowed = ['title', 'type', 'station', 'topicId', 'status', 'assignee', 'deadline', 'visualRefUrl', 'visualRefImage', 'notes'] as const;
    const data: Record<string, string> = {};
    for (const key of allowed) {
      const value = body[key];
      if (typeof value === 'string') data[key] = value;
    }

    try {
      return await db.contentPiece.update({ where: { id }, data });
    } catch {
      return reply.status(404).send({ error: 'ContentPiece not found' });
    }
  });

  // DELETE /api/content-pieces/:id
  app.delete('/content-pieces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await db.contentPiece.delete({ where: { id } });
      return { success: true, deletedId: id };
    } catch {
      return reply.status(404).send({ error: 'ContentPiece not found' });
    }
  });

  // POST /api/clients/:clientId/content-pieces/bulk-import
  // One-time migration endpoint: accepts an array of locally-cached pieces
  // and creates them server-side.  The frontend fires this on first load
  // if it detects legacy localStorage data.  Idempotent by (title + createdAt).
  app.post('/clients/:clientId/content-pieces/bulk-import', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = (request.body || {}) as { pieces?: Array<Record<string, unknown>> };
    const list = Array.isArray(body.pieces) ? body.pieces : [];
    if (list.length === 0) return { success: true, imported: 0 };

    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    const existing = await db.contentPiece.findMany({
      where: { clientId },
      select: { title: true, createdAt: true },
    });
    const existingKey = new Set(existing.map((p) => `${p.title}|${p.createdAt.toISOString()}`));

    let imported = 0;
    for (const raw of list) {
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!title) continue;
      const createdAtStr = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
      const createdAt = new Date(createdAtStr);
      if (isNaN(createdAt.getTime())) continue;
      const dedupKey = `${title}|${createdAt.toISOString()}`;
      if (existingKey.has(dedupKey)) continue;

      await db.contentPiece.create({
        data: {
          clientId,
          title,
          type: typeof raw.type === 'string' ? raw.type : 'Image',
          station: typeof raw.station === 'string' ? raw.station : 'Lebanon',
          topicId: typeof raw.topicId === 'string' ? raw.topicId : '',
          status: typeof raw.status === 'string' ? raw.status : 'Draft',
          assignee: typeof raw.assignee === 'string' ? raw.assignee : '',
          deadline: typeof raw.deadline === 'string' ? raw.deadline : '',
          visualRefUrl: typeof raw.visualRefUrl === 'string' ? raw.visualRefUrl : '',
          visualRefImage: typeof raw.visualRefImage === 'string' ? raw.visualRefImage : '',
          notes: typeof raw.notes === 'string' ? raw.notes : '',
          createdAt,
        },
      });
      imported += 1;
    }

    return { success: true, imported, skipped: list.length - imported };
  });
}
