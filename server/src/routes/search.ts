// Federated content search — powers the ⌘K command palette's "search content"
// section (IA audit 2026-07-05: the palette could only jump to pages, never find
// a client / post / piece by name — the root of "search is weak"). Org-scoped,
// case-insensitive, small result caps; read-only.
import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { errStatus, errMessage } from '../services/providers/errors.js';

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/search?q=...  → { clients, posts, pieces }
  app.get('/search', async (request, reply) => {
    const orgId = request.orgId!;
    const q = String((request.query as { q?: string })?.q ?? '').trim();
    if (q.length < 2) return { clients: [], posts: [], pieces: [] };
    const contains = { contains: q, mode: 'insensitive' as const };
    try {
      const [clients, posts, pieces] = await Promise.all([
        db.client.findMany({
          where: { orgId, name: contains },
          select: { id: true, name: true, slug: true, industry: true },
          take: 6,
        }),
        db.calendarPost.findMany({
          where: { orgId, OR: [{ title: contains }, { caption: contains }] },
          select: {
            id: true, title: true, platform: true, status: true,
            calendarMonth: { select: { clientId: true, month: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
        db.contentPiece.findMany({
          where: { orgId, title: contains },
          select: { id: true, title: true, clientId: true, status: true, type: true },
          take: 6,
        }),
      ]);
      return {
        clients,
        posts: posts.map((p) => ({
          id: p.id, title: p.title, platform: p.platform, status: p.status,
          clientId: p.calendarMonth?.clientId ?? null, month: p.calendarMonth?.month ?? null,
        })),
        pieces,
      };
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err, 'Search failed') });
    }
  });
}
