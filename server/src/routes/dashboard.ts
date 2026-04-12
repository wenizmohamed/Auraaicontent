import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';

export async function dashboardRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/dashboard/stats
  app.get('/dashboard/stats', async (_request, reply) => {
    try {
      // ── Clients ────────────────────────────────────────────────
      const [totalClients, withBrief] = await Promise.all([
        db.client.count(),
        db.clientBrief.count(),
      ]);

      // ── Content ────────────────────────────────────────────────
      const [totalMonths, totalPosts, statusGroups, platformGroups] = await Promise.all([
        db.calendarMonth.count(),
        db.calendarPost.count(),
        db.calendarPost.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        db.calendarPost.groupBy({
          by: ['platform'],
          _count: { _all: true },
        }),
      ]);

      const byStatus: Record<string, number> = {
        draft: 0,
        approved: 0,
        changes_requested: 0,
      };
      for (const g of statusGroups) {
        byStatus[g.status] = g._count._all;
      }

      const byPlatform: Record<string, number> = {};
      for (const g of platformGroups) {
        byPlatform[g.platform] = g._count._all;
      }

      // ── Knowledge ──────────────────────────────────────────────
      const [totalItems, totalChunks] = await Promise.all([
        db.knowledgeItem.count(),
        db.knowledgeChunk.count(),
      ]);

      // ── Activity — last 5 calendar months with post count ─────
      const recentMonths = await db.calendarMonth.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { _count: { select: { posts: true } } },
      });

      return {
        clients: {
          total: totalClients,
          withBrief,
        },
        content: {
          totalMonths,
          totalPosts,
          byStatus,
          byPlatform,
        },
        generation: {
          recentJobs: [] as { month: string; clientId: string; createdAt: string }[],
        },
        knowledge: {
          totalItems,
          totalChunks,
        },
        activity: {
          recentMonths: recentMonths.map((m) => ({
            id: m.id,
            month: m.month,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
            postCount: m._count.posts,
          })),
        },
      };
    } catch (err) {
      app.log.error(err, 'dashboard stats failed');
      return reply.status(500).send({ error: 'Failed to fetch dashboard stats' });
    }
  });
}
