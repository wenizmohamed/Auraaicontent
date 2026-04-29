import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { getAiTelemetry } from '../services/providers/ai-router.js';

export async function dashboardRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/dashboard/stats
  app.get('/dashboard/stats', async (request, reply) => {
    const orgId = request.orgId!;
    try {
      const [totalClients, withBrief] = await Promise.all([
        db.client.count({ where: { orgId } }),
        db.clientBrief.count({ where: { orgId } }),
      ]);

      const liveMonthFilter = { orgId, calendarMonth: { isArchived: false, isTest: false } };
      const [totalMonths, totalPosts, statusGroups, platformGroups] = await Promise.all([
        db.calendarMonth.count({ where: { orgId, isArchived: false, isTest: false } }),
        db.calendarPost.count({ where: liveMonthFilter }),
        db.calendarPost.groupBy({
          by: ['status'],
          where: liveMonthFilter,
          _count: { _all: true },
        }),
        db.calendarPost.groupBy({
          by: ['platform'],
          where: liveMonthFilter,
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

      const [totalItems, totalChunks] = await Promise.all([
        db.knowledgeItem.count({ where: { orgId } }),
        db.knowledgeChunk.count({ where: { orgId } }),
      ]);

      const recentMonths = await db.calendarMonth.findMany({
        where: { orgId, isTest: false, isArchived: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { _count: { select: { posts: true } } },
      });

      return {
        clients: { total: totalClients, withBrief },
        content: { totalMonths, totalPosts, byStatus, byPlatform },
        generation: { recentJobs: [] as { month: string; clientId: string; createdAt: string }[] },
        knowledge: { totalItems, totalChunks },
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

  // GET /api/dashboard/activity — real user activity feed from AuditLog
  app.get('/dashboard/activity', async (request, reply) => {
    const orgId = request.orgId!;
    try {
      const logs = await db.auditLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const clientIds = Array.from(new Set(logs.map(l => l.clientId).filter(Boolean) as string[]));
      const clients = clientIds.length > 0
        ? await db.client.findMany({
            where: { orgId, id: { in: clientIds } },
            select: { id: true, name: true },
          })
        : [];
      const clientById = new Map(clients.map(c => [c.id, c.name]));

      return logs.map(l => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        clientId: l.clientId,
        clientName: l.clientId ? (clientById.get(l.clientId) || null) : null,
        payload: l.payload,
        createdAt: l.createdAt.toISOString(),
      }));
    } catch (err) {
      app.log.error(err, 'activity feed failed');
      return reply.status(500).send({ error: 'Failed to fetch activity' });
    }
  });

  // GET /api/dashboard/insights — action center, trends, recent visual assets
  app.get('/dashboard/insights', async (request, reply) => {
    const orgId = request.orgId!;
    try {
      const now = new Date();
      const dayMs = 86400000;
      const sevenDaysAgo = new Date(now.getTime() - 7 * dayMs);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * dayMs);

      const liveMonth = { orgId, calendarMonth: { isArchived: false, isTest: false } };
      const [pendingReview, draftsOlderThan7d, recentAssets, dailyPosts] = await Promise.all([
        db.calendarPost.count({ where: { status: 'changes_requested', ...liveMonth } }),
        db.calendarPost.count({
          where: { status: 'draft', createdAt: { lt: sevenDaysAgo }, ...liveMonth },
        }),
        db.asset.findMany({
          where: { orgId, mimeType: { in: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'] } },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, fileUrl: true, thumbUrl: true, mimeType: true, name: true, createdAt: true, client: { select: { name: true } } },
        }),
        db.calendarPost.findMany({
          where: { createdAt: { gte: thirtyDaysAgo }, ...liveMonth },
          select: { createdAt: true, status: true, platform: true },
        }),
      ]);

      const sparkline: { date: string; posts: number; approved: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const day = new Date(now.getTime() - i * dayMs);
        const dayStr = day.toISOString().slice(0, 10);
        const dayPosts = dailyPosts.filter(p => p.createdAt.toISOString().slice(0, 10) === dayStr);
        sparkline.push({
          date: dayStr,
          posts: dayPosts.length,
          approved: dayPosts.filter(p => p.status === 'approved').length,
        });
      }

      const last7 = dailyPosts.filter(p => p.createdAt >= sevenDaysAgo).length;
      const prev7 = dailyPosts.filter(p => p.createdAt < sevenDaysAgo && p.createdAt >= new Date(now.getTime() - 14 * dayMs)).length;
      const postsTrend = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : (last7 > 0 ? 100 : 0);

      const insights: { type: 'positive' | 'warning' | 'info'; text: string }[] = [];
      if (postsTrend >= 25) insights.push({ type: 'positive', text: `Posts up ${postsTrend}% vs last week — momentum is strong` });
      else if (postsTrend <= -25) insights.push({ type: 'warning', text: `Posts down ${Math.abs(postsTrend)}% vs last week — slowing down` });
      if (draftsOlderThan7d >= 5) insights.push({ type: 'warning', text: `${draftsOlderThan7d} drafts have been sitting for 7+ days` });
      if (pendingReview >= 1) insights.push({ type: 'info', text: `${pendingReview} post${pendingReview === 1 ? '' : 's'} need${pendingReview === 1 ? 's' : ''} revision before approval` });

      const platformApproved: Record<string, number> = {};
      for (const p of dailyPosts) {
        if (p.status === 'approved') platformApproved[p.platform] = (platformApproved[p.platform] || 0) + 1;
      }
      const topPlatform = Object.entries(platformApproved).sort(([, a], [, b]) => b - a)[0];
      if (topPlatform && topPlatform[1] >= 3) {
        insights.push({ type: 'positive', text: `${topPlatform[0]} is your top platform with ${topPlatform[1]} approved posts this month` });
      }

      return {
        actionCenter: {
          pendingReview,
          draftsStuck: draftsOlderThan7d,
          totalActions: pendingReview + draftsOlderThan7d,
        },
        trends: { sparkline, postsTrend, last7Days: last7 },
        visualShowcase: recentAssets.map(a => ({
          id: a.id,
          fileUrl: a.fileUrl,
          thumbUrl: a.thumbUrl,
          mimeType: a.mimeType,
          name: a.name,
          createdAt: a.createdAt.toISOString(),
          clientName: a.client?.name || null,
        })),
        insights,
      };
    } catch (err) {
      app.log.error(err, 'dashboard insights failed');
      return reply.status(500).send({ error: 'Failed to fetch insights' });
    }
  });

  // GET /api/dashboard/ai-stats — provider health, token efficiency, fallback rates
  // (telemetry is in-memory and global; per-org breakdown lands in Phase 2 via UsageEvent)
  app.get('/dashboard/ai-stats', async (_request, reply) => {
    try {
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
    } catch (err) {
      app.log.error(err, 'ai-stats failed');
      return reply.status(500).send({ error: 'Failed to fetch AI stats' });
    }
  });
}
