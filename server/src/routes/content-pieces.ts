// Content Pieces CRUD — backs apps/desktop contentPiecesApi (ContentPieces.tsx,
// Workspace.tsx, calendar InboxRail). The frontend shipped 2026-06-04 calling
// these paths but the routes never landed server-side (silent 404 -> page
// rendered empty). ContentPiece is tenant-scoped in prisma-tenant.ts, so every
// query carries orgId explicitly.
import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard, denyViewer } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';

// Whitelist of client-settable fields (id/orgId/clientId/timestamps excluded).
const FIELDS = ['title', 'type', 'station', 'topicId', 'status', 'assignee', 'deadline', 'visualRefUrl', 'visualRefImage', 'notes'] as const;
type PieceInput = Partial<Record<(typeof FIELDS)[number], string>>;

function pick(body: PieceInput): PieceInput {
  const out: PieceInput = {};
  for (const k of FIELDS) if (typeof body?.[k] === 'string') out[k] = body[k];
  return out;
}

export async function contentPieceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  async function assertClient(orgId: string, clientId: string) {
    return db.client.findFirst({ where: { id: clientId, orgId }, select: { id: true } });
  }

  // GET /api/clients/:clientId/content-pieces
  app.get('/clients/:clientId/content-pieces', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    if (!(await assertClient(request.orgId!, clientId))) return reply.status(404).send({ error: 'Client not found' });
    return db.contentPiece.findMany({ where: { orgId: request.orgId!, clientId }, orderBy: { createdAt: 'desc' } });
  });

  // POST /api/clients/:clientId/content-pieces
  app.post('/clients/:clientId/content-pieces', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    if (!(await assertClient(request.orgId!, clientId))) return reply.status(404).send({ error: 'Client not found' });
    const input = pick(request.body as PieceInput);
    if (!input.title?.trim()) return reply.status(400).send({ error: 'title is required' });
    const piece = await db.contentPiece.create({
      data: { orgId: request.orgId!, clientId, type: 'Image', station: '', ...input, title: input.title.trim() },
    });
    auditService.log({
      orgId: request.orgId, userId: request.user?.userId, clientId,
      action: 'contentPiece.create', entityType: 'ContentPiece', entityId: piece.id,
      payload: { title: piece.title, type: piece.type },
    }).catch(() => {});
    return reply.status(201).send(piece);
  });

  // POST /api/clients/:clientId/content-pieces/bulk-import
  app.post('/clients/:clientId/content-pieces/bulk-import', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    if (!(await assertClient(request.orgId!, clientId))) return reply.status(404).send({ error: 'Client not found' });
    const { pieces } = (request.body ?? {}) as { pieces?: PieceInput[] };
    if (!Array.isArray(pieces)) return reply.status(400).send({ error: 'pieces array required' });
    const valid = pieces.map(pick).filter((p) => p.title?.trim());
    if (valid.length) {
      await db.contentPiece.createMany({
        data: valid.map((p) => ({ orgId: request.orgId!, clientId, type: 'Image', station: '', ...p, title: p.title!.trim() })),
      });
    }
    auditService.log({
      orgId: request.orgId, userId: request.user?.userId, clientId,
      action: 'contentPiece.bulkImport', entityType: 'ContentPiece', entityId: clientId,
      payload: { imported: valid.length, skipped: pieces.length - valid.length },
    }).catch(() => {});
    return { success: true, imported: valid.length, skipped: pieces.length - valid.length };
  });

  // PATCH /api/content-pieces/:id
  app.patch('/content-pieces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = pick(request.body as PieceInput);
    const { count } = await db.contentPiece.updateMany({ where: { id, orgId: request.orgId! }, data: patch });
    if (count === 0) return reply.status(404).send({ error: 'Content piece not found' });
    return db.contentPiece.findFirst({ where: { id, orgId: request.orgId! } });
  });

  // DELETE /api/content-pieces/:id
  app.delete('/content-pieces/:id', { preHandler: denyViewer }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.contentPiece.findFirst({ where: { id, orgId: request.orgId! }, select: { id: true, clientId: true, title: true } });
    if (!existing) return reply.status(404).send({ error: 'Content piece not found' });
    await db.contentPiece.deleteMany({ where: { id, orgId: request.orgId! } });
    auditService.log({
      orgId: request.orgId, userId: request.user?.userId, clientId: existing.clientId,
      action: 'contentPiece.delete', entityType: 'ContentPiece', entityId: id,
      payload: { title: existing.title },
    }).catch(() => {});
    return { success: true, deletedId: id };
  });
}
