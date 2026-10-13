import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { authGuard } from '../middleware/auth.js';
import { db } from '../db/prisma.js';

interface ListQuery {
  type?: string;       // image | video | text | research | brand_synthesis | analyze | design
  clientId?: string;
  surface?: string;
  limit?: string;
  cursor?: string;     // ISO date string of last seen createdAt for pagination
  status?: string;     // succeeded | failed
  q?: string;          // prompt substring search
}

const ALLOWED_TYPES = new Set(['image', 'video', 'text', 'research', 'brand_synthesis', 'analyze', 'design']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function historyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/history?type=&clientId=&limit=&cursor=&q=
  app.get('/history', async (request, reply) => {
    const orgId = request.orgId!;
    const q = (request.query as ListQuery) || {};

    const limit = Math.min(Math.max(parseInt(q.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const where: Prisma.GenerationWhereInput = { orgId };
    if (q.type && ALLOWED_TYPES.has(q.type)) where.type = q.type;
    if (q.clientId) where.clientId = q.clientId;
    if (q.surface) where.surface = q.surface;
    if (q.status === 'succeeded' || q.status === 'failed') where.status = q.status;
    if (q.q && q.q.trim()) where.prompt = { contains: q.q.trim(), mode: 'insensitive' };
    if (q.cursor) {
      const cursorDate = new Date(q.cursor);
      if (!isNaN(cursorDate.getTime())) where.createdAt = { lt: cursorDate };
    }

    const rows = await db.generation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        client: { select: { id: true, name: true, logoUrl: true } },
        user: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.createdAt.toISOString() : null;

    return {
      items: items.map((r) => ({
        id: r.id,
        type: r.type,
        surface: r.surface,
        prompt: r.prompt,
        outputUrl: r.outputUrl,
        outputText: r.outputText ? r.outputText.slice(0, 1000) : null, // preview only in list
        thumbnailUrl: r.thumbnailUrl,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
        status: r.status,
        error: r.error,
        client: r.client,
        user: r.user,
        createdAt: r.createdAt,
      })),
      nextCursor,
      hasMore,
    };
  });

  // GET /api/history/:id — full row including untruncated outputText + metadata
  app.get('/history/:id', async (request, reply) => {
    const orgId = request.orgId!;
    const { id } = request.params as { id: string };
    const row = await db.generation.findFirst({
      where: { id, orgId },
      include: {
        client: { select: { id: true, name: true, logoUrl: true } },
        user: { select: { id: true, name: true } },
      },
    });
    if (!row) return reply.status(404).send({ error: 'Generation not found' });
    return row;
  });

  // DELETE /api/history/:id
  app.delete('/history/:id', async (request, reply) => {
    const orgId = request.orgId!;
    const { id } = request.params as { id: string };
    const row = await db.generation.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!row) return reply.status(404).send({ error: 'Generation not found' });
    await db.generation.deleteMany({ where: { id, orgId } });
    return { ok: true };
  });

  // GET /api/history/stats — counts by type for the org (used by sidebar badges)
  app.get('/history/stats', async (request) => {
    const orgId = request.orgId!;
    const grouped = await db.generation.groupBy({
      by: ['type'],
      where: { orgId },
      _count: { _all: true },
    });
    const total = grouped.reduce((acc: number, g) => acc + (g._count?._all || 0), 0);
    return {
      total,
      byType: grouped.reduce((acc: Record<string, number>, g) => {
        acc[g.type] = g._count?._all || 0;
        return acc;
      }, {}),
    };
  });
}
