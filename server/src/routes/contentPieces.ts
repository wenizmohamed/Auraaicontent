import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';

// Zod schemas — single source of truth.
const PieceCore = {
  topicId: z.string().max(120).optional().default(''),
  status: z.enum(['Draft', 'In Review', 'Approved', 'Scheduled', 'Published', 'Rejected']).default('Draft'),
  assignee: z.string().max(120).optional().default(''),
  deadline: z.string().max(40).optional().default(''),
  visualRefUrl: z.string().max(2048).optional().default(''),
  visualRefImage: z.string().max(2_000_000).optional().default(''), // base64 or URL
  notes: z.string().max(20_000).optional().default(''),
};

const CreatePieceBody = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.string().min(1).max(80),
  station: z.string().min(1).max(80),
  ...PieceCore,
});

const UpdatePieceBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  type: z.string().min(1).max(80).optional(),
  station: z.string().min(1).max(80).optional(),
  topicId: z.string().max(120).optional(),
  status: z.enum(['Draft', 'In Review', 'Approved', 'Scheduled', 'Published', 'Rejected']).optional(),
  assignee: z.string().max(120).optional(),
  deadline: z.string().max(40).optional(),
  visualRefUrl: z.string().max(2048).optional(),
  visualRefImage: z.string().max(2_000_000).optional(),
  notes: z.string().max(20_000).optional(),
});

const BulkImportBody = z.object({
  pieces: z.array(z.record(z.unknown())).max(500).default([]),
});

function parseOr400<T>(schema: z.ZodSchema<T>, body: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    reply.status(400).send({
      error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body',
      issues: r.error.issues,
    });
    return null;
  }
  return r.data;
}

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
    const body = parseOr400(CreatePieceBody, request.body, reply);
    if (!body) return;

    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    return db.contentPiece.create({
      data: { clientId, ...body },
    });
  });

  // PATCH /api/content-pieces/:id
  app.patch('/content-pieces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseOr400(UpdatePieceBody, request.body, reply);
    if (!body) return;
    try {
      return await db.contentPiece.update({ where: { id }, data: body });
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
    const body = parseOr400(BulkImportBody, request.body, reply);
    if (!body) return;
    const list = body.pieces ?? [];
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
