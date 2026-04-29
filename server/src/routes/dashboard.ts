import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { getAiTelemetry } from '../services/providers/ai-router.js';

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
      // Exclude smoke-test months from the user-visible Recent Months feed.
      // (Internal totals above still include them — they're real rows.)
      const recentMonths = await db.calendarMonth.findMany({
        where: { isTest: false },
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

  // GET /api/dashboard/ai-stats — provider health, token efficiency, fallback rates
  app.get('/dashboard/ai-stats', async () => {
    const entries = getAiTelemetry();

    const providers: Record<string, {
      calls: number; errors: number; totalLatency: number;
      promptTokens: number; completionTokens: number; totalTokens: number;
      fallbacks: number; tasks: Record<string, number>;
    }> = {};
    let totalTokens = 0;
    let totalErrors = 0;
    let totalFallbacks = 0;
    const tasks: Record<string, { calls: number; totalLatency: number; totalTokens: number }> = {};

    for (const e of entries) {
      if (!providers[e.provider]) {
        providers[e.provider] = { calls: 0, errors: 0, totalLatency: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, fallbacks: 0, tasks: {} };
      }
      const p = providers[e.provider];
      p.calls++;
      if (e.errorType) { p.errors++; totalErrors++; }
      p.totalLatency += e.latencyMs;
      const eTok = e.totalTokens || 0;
      p.promptTokens += e.promptTokens || 0;
      p.completionTokens += e.completionTokens || 0;
      p.totalTokens += eTok;
      totalTokens += eTok;
      if (e.fallbackUsed) { p.fallbacks++; totalFallbacks++; }
      p.tasks[e.task] = (p.tasks[e.task] || 0) + 1;

      if (!tasks[e.task]) tasks[e.task] = { calls: 0, totalLatency: 0, totalTokens: 0 };
      tasks[e.task].calls++;
      tasks[e.task].totalLatency += e.latencyMs;
      tasks[e.task].totalTokens += eTok;
    }

    return {
      totalCalls: entries.length,
      totalTokens,
      totalErrors,
      totalFallbacks,
      providers: Object.entries(providers).map(([name, p]) => ({
        provider: name,
        calls: p.calls,
        errors: p.errors,
        successRate: p.calls > 0 ? Math.round(((p.calls - p.errors) / p.calls) * 100) : 0,
        avgLatencyMs: p.calls > 0 ? Math.round(p.totalLatency / p.calls) : 0,
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        totalTokens: p.totalTokens,
        fallbacks: p.fallbacks,
        tasks: p.tasks,
      })),
      tasks: Object.entries(tasks).map(([task, t]) => ({
        task,
        calls: t.calls,
        avgLatencyMs: t.calls > 0 ? Math.round(t.totalLatency / t.calls) : 0,
        totalTokens: t.totalTokens,
      })),
      recent: entries.slice(-20).reverse(),
    };
  });
}
