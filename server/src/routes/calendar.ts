import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { briefService } from '../services/brief.service.js';
import { auditService } from '../services/audit.service.js';
import { createJob, processJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { visualSearchService } from '../services/visual-search.service.js';

export async function calendarRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // POST /api/clients/:clientId/calendar/generate → { jobId }
  app.post('/clients/:clientId/calendar/generate', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month, pieceCount } = (request.body as any) || {};

    if (!month) return reply.status(400).send({ error: 'month is required (e.g. "August 2026")' });

    // Block duplicate month generation — archived months don't block (soft-archive is for history).
    const existing = await db.calendarMonth.findFirst({ where: { clientId, month, isArchived: false } });
    if (existing) {
      return reply.status(409).send({ error: `Calendar for "${month}" already exists. Archive it first or use a different month.`, existingId: existing.id });
    }

    // Validate brief completeness
    const brief = await briefService.getByClientId(clientId);
    const { score } = briefService.completeness(brief);
    if (score < 50) {
      return reply.status(422).send({ error: `Brief completeness too low (${score}%). Need at least 50%.` });
    }

    // Create and process job
    const job = createJob('generate-month', { clientId, month, pieceCount: pieceCount || 18 });
    processJob(job.id, generateMonthWorker);

    // Audit
    const userId = (request as any).user?.id;
    auditService.log({ userId, clientId, action: 'generate', entityType: 'CalendarMonth', payload: { month, pieceCount, jobId: job.id } });

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/clients/:clientId/calendar/months
  // Returns ACTIVE (non-archived) months by default. Pass ?includeArchived=true to
  // get archived ones mixed in, or use /calendar/archived for archived-only.
  // Smoke-test months (isTest=true) are hidden by default; pass ?includeTest=true
  // for dev tooling that needs to see them.
  app.get('/clients/:clientId/calendar/months', async (request) => {
    const { clientId } = request.params as { clientId: string };
    const { includeTest, includeArchived } = (request.query as { includeTest?: string; includeArchived?: string }) || {};
    const showTest = includeTest === 'true' || includeTest === '1';
    const showArchived = includeArchived === 'true' || includeArchived === '1';

    const where: any = { clientId };
    if (!showTest) where.isTest = false;
    if (!showArchived) where.isArchived = false;

    const months = await db.calendarMonth.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        month: true,
        status: true,
        isTest: true,
        isArchived: true,
        archivedAt: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
    });
    return months.map(m => ({
      id: m.id,
      month: m.month,
      status: m.status,
      isTest: m.isTest,
      isArchived: m.isArchived,
      archivedAt: m.archivedAt,
      createdAt: m.createdAt,
      postCount: m._count.posts,
    }));
  });

  // GET /api/clients/:clientId/calendar/archived — archived-only, newest-archive first.
  // Drives the "Previous Months" drawer on the Calendar page (Manus-style history).
  app.get('/clients/:clientId/calendar/archived', async (request) => {
    const { clientId } = request.params as { clientId: string };
    const months = await db.calendarMonth.findMany({
      where: { clientId, isArchived: true },
      orderBy: [{ archivedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        month: true,
        status: true,
        isTest: true,
        archivedAt: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
    });
    return months.map(m => ({
      id: m.id,
      month: m.month,
      status: m.status,
      isTest: m.isTest,
      archivedAt: m.archivedAt,
      createdAt: m.createdAt,
      postCount: m._count.posts,
    }));
  });

  // GET /api/clients/:clientId/calendar/:month
  // Default: returns the ACTIVE (non-archived) month. Pass ?includeArchived=true
  // to fetch an archived month for read-only history viewing.
  app.get('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const { includeArchived } = (request.query as { includeArchived?: string }) || {};
    const showArchived = includeArchived === 'true' || includeArchived === '1';
    const decodedMonth = decodeURIComponent(month);

    const where: any = { clientId, month: decodedMonth };
    if (!showArchived) where.isArchived = false;

    const calendarMonth = await db.calendarMonth.findFirst({
      where,
      include: {
        posts: {
          orderBy: { date: 'asc' },
          include: {
            assets: { include: { asset: true } },
            visualRefs: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!calendarMonth) return reply.status(404).send({ error: 'Calendar month not found' });
    return calendarMonth;
  });

  // DELETE /api/clients/:clientId/calendar/:month
  // Default: SOFT-ARCHIVE (reversible). Posts + month stay in DB, just flagged.
  // Pass ?hard=true to permanently delete (cascades CalendarPost via schema).
  // Manus pattern: destructive actions are always explicit + reversible by default.
  app.delete('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const { hard } = (request.query as { hard?: string }) || {};
    const permanent = hard === 'true' || hard === '1';
    const decodedMonth = decodeURIComponent(month);

    const all = await db.calendarMonth.findMany({ where: { clientId, month: decodedMonth } });
    if (all.length === 0) return reply.status(404).send({ error: 'Calendar month not found' });

    if (permanent) {
      // Hard delete — CalendarPost cascades via Prisma schema relation
      for (const m of all) {
        await db.calendarMonth.delete({ where: { id: m.id } });
      }
      return { success: true, mode: 'hard', deleted: all.length, month: decodedMonth };
    }

    // Soft archive — data stays, restoreable via POST /restore
    const now = new Date();
    await db.calendarMonth.updateMany({
      where: { clientId, month: decodedMonth, isArchived: false },
      data: { isArchived: true, archivedAt: now },
    });
    return { success: true, mode: 'archive', archived: all.length, month: decodedMonth, archivedAt: now.toISOString() };
  });

  // POST /api/clients/:clientId/calendar/:month/restore — un-archive
  app.post('/clients/:clientId/calendar/:month/restore', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const decodedMonth = decodeURIComponent(month);

    const result = await db.calendarMonth.updateMany({
      where: { clientId, month: decodedMonth, isArchived: true },
      data: { isArchived: false, archivedAt: null },
    });
    if (result.count === 0) return reply.status(404).send({ error: 'No archived month to restore' });
    return { success: true, restored: result.count, month: decodedMonth };
  });

  // PATCH /api/calendar-posts/:postId
  app.patch('/calendar-posts/:postId', async (request) => {
    const { postId } = request.params as { postId: string };
    const updates = request.body as any;
    const { id, calendarMonthId, createdAt, updatedAt, ...data } = updates;
    return db.calendarPost.update({ where: { id: postId }, data });
  });

  // DELETE /api/calendar-posts/:postId
  app.delete('/calendar-posts/:postId', async (request) => {
    const { postId } = request.params as { postId: string };
    await db.calendarPost.delete({ where: { id: postId } });
    return { success: true, deletedId: postId };
  });

  // POST /api/clients/:clientId/calendar/:month/visual-refs/backfill
  // Auto-populates visual refs for every post in that month that has a referenceQuery and 0 refs.
  // Safe to call repeatedly — only fills gaps.
  app.post('/clients/:clientId/calendar/:month/visual-refs/backfill', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const decodedMonth = decodeURIComponent(month);
    const { count } = (request.body as { count?: number }) || {};
    const perPost = Math.max(1, Math.min(12, count || 6));

    const calMonth = await db.calendarMonth.findFirst({
      where: { clientId, month: decodedMonth },
      include: {
        posts: {
          select: {
            id: true,
            referenceQuery: true,
            _count: { select: { visualRefs: true } },
          },
        },
      },
    });
    if (!calMonth) return reply.status(404).send({ error: 'Calendar month not found' });

    const candidates = calMonth.posts.filter(
      p => p._count.visualRefs === 0 && p.referenceQuery && p.referenceQuery.trim(),
    );

    let totalRefsAdded = 0;
    let postsBackfilled = 0;
    const failures: { postId: string; error: string }[] = [];

    for (const p of candidates) {
      try {
        const { results } = await visualSearchService.search(p.referenceQuery!, perPost);
        let position = 0;
        for (const r of results) {
          await db.postVisualReference.create({
            data: {
              postId: p.id,
              thumbnailUrl: r.thumbnailUrl,
              sourceUrl: r.sourceUrl,
              sourceDomain: r.sourceDomain,
              sourceType: r.sourceType,
              title: r.title || null,
              description: r.description || null,
              pinId: r.pinId || null,
              position: position++,
            },
          });
          totalRefsAdded++;
        }
        postsBackfilled++;
      } catch (err: any) {
        failures.push({ postId: p.id, error: err?.message || 'unknown' });
      }
    }

    return {
      month: decodedMonth,
      postsScanned: calMonth.posts.length,
      postsEligible: candidates.length,
      postsBackfilled,
      totalRefsAdded,
      failures,
    };
  });

  // POST /api/calendar-posts/:postId/regenerate → { jobId } (stub)
  app.post('/calendar-posts/:postId/regenerate', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    // Stub — full single-post regeneration in a later commit
    return reply.status(501).send({ error: 'Single post regeneration not yet implemented', postId });
  });
}
