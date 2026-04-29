import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { briefService } from '../services/brief.service.js';
import { auditService } from '../services/audit.service.js';
import { createJob, processJob, findInflightGenerateJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { assertClientInOrg, assertCalendarPostInOrg } from '../lib/tenant.js';

export async function calendarRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // POST /api/clients/:clientId/calendar/generate → { jobId }
  app.post('/clients/:clientId/calendar/generate', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month, pieceCount } = (request.body as any) || {};
    const orgId = request.orgId!;

    if (!month) return reply.status(400).send({ error: 'month is required (e.g. "August 2026")' });

    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }

    // Block duplicate month generation. Even soft-archived months count
    // because @@unique([clientId, month]) blocks insert. The error message
    // MUST contain "already exists" so the frontend conflict modal triggers.
    const existing = await db.calendarMonth.findFirst({ where: { orgId, clientId, month } });
    if (existing) {
      const msg = existing.isArchived
        ? `Calendar for "${month}" already exists (archived). Delete and regenerate, or restore from Archived.`
        : `Calendar for "${month}" already exists. Delete it first or use a different month.`;
      return reply.status(409).send({ error: msg, existingId: existing.id, isArchived: existing.isArchived });
    }

    // Race-condition guard: if a worker is already processing this exact
    // clientId+month, return the in-progress jobId instead of starting a
    // second worker.
    const userId = request.user?.userId;

    const inflight = findInflightGenerateJob(clientId, month);
    if (inflight) {
      auditService.log({ orgId, userId, clientId, action: 'generate-deduped', entityType: 'CalendarMonth', payload: { month, existingJobId: inflight.id } });
      return { jobId: inflight.id, deduped: true };
    }

    // Validate brief completeness
    const brief = await briefService.getByClientId(orgId, clientId);
    const { score } = briefService.completeness(brief);
    if (score < 50) {
      return reply.status(422).send({ error: `Brief completeness too low (${score}%). Need at least 50%.` });
    }

    // Create and process job — orgId travels with the payload so the worker
    // doesn't need to re-resolve it from the request context.
    const job = createJob('generate-month', { orgId, clientId, month, pieceCount: pieceCount || 18 });
    processJob(job.id, generateMonthWorker);

    auditService.log({ orgId, userId, clientId, action: 'generate', entityType: 'CalendarMonth', payload: { month, pieceCount, jobId: job.id } });

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/clients/:clientId/calendar/months
  app.get('/clients/:clientId/calendar/months', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const { includeTest } = (request.query as { includeTest?: string }) || {};
    const showTest = includeTest === 'true' || includeTest === '1';

    const months = await db.calendarMonth.findMany({
      where: showTest
        ? { orgId, clientId, isArchived: false }
        : { orgId, clientId, isTest: false, isArchived: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        month: true,
        status: true,
        isTest: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
    });
    return months.map(m => ({
      id: m.id,
      month: m.month,
      status: m.status,
      isTest: m.isTest,
      createdAt: m.createdAt,
      postCount: m._count.posts,
    }));
  });

  // GET /api/clients/:clientId/calendar/:month
  app.get('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const decodedMonth = decodeURIComponent(month);

    const calendarMonth = await db.calendarMonth.findFirst({
      where: { orgId, clientId, month: decodedMonth },
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
  app.delete('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const { hard } = (request.query as { hard?: string }) || {};
    const decodedMonth = decodeURIComponent(month);
    const isHard = hard === 'true' || hard === '1';

    const all = await db.calendarMonth.findMany({ where: { orgId, clientId, month: decodedMonth } });
    if (all.length === 0) return reply.status(404).send({ error: 'Calendar month not found' });

    if (isHard) {
      for (const m of all) {
        await db.calendarMonth.delete({ where: { id: m.id, orgId } });
      }
      return { success: true, mode: 'hard' as const, deleted: all.length, month: decodedMonth };
    }

    const archivedAt = new Date();
    for (const m of all) {
      await db.calendarMonth.update({
        where: { id: m.id, orgId },
        data: { isArchived: true, archivedAt },
      });
    }
    return { success: true, mode: 'archive' as const, archived: all.length, month: decodedMonth, archivedAt: archivedAt.toISOString() };
  });

  // POST /api/clients/:clientId/calendar/:month/restore — undo archive
  app.post('/clients/:clientId/calendar/:month/restore', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const decodedMonth = decodeURIComponent(month);
    const all = await db.calendarMonth.findMany({ where: { orgId, clientId, month: decodedMonth, isArchived: true } });
    if (all.length === 0) return reply.status(404).send({ error: 'No archived months to restore' });
    for (const m of all) {
      await db.calendarMonth.update({ where: { id: m.id, orgId }, data: { isArchived: false, archivedAt: null } });
    }
    return { success: true, restored: all.length, month: decodedMonth };
  });

  // GET /api/clients/:clientId/calendar/archived — list archived months
  app.get('/clients/:clientId/calendar/archived', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const months = await db.calendarMonth.findMany({
      where: { orgId, clientId, isArchived: true },
      orderBy: { archivedAt: 'desc' },
      select: { id: true, month: true, status: true, isTest: true, createdAt: true, archivedAt: true, _count: { select: { posts: true } } },
    });
    return months.map(m => ({
      id: m.id, month: m.month, status: m.status, isTest: m.isTest,
      createdAt: m.createdAt, archivedAt: m.archivedAt,
      postCount: m._count.posts,
    }));
  });

  // PATCH /api/calendar-posts/:postId
  app.patch('/calendar-posts/:postId', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const updates = request.body as any;
    const { id, calendarMonthId, orgId: _omitOrgId, createdAt, updatedAt, ...data } = updates;
    return db.calendarPost.update({ where: { id: postId, orgId: request.orgId }, data });
  });

  // DELETE /api/calendar-posts/:postId
  app.delete('/calendar-posts/:postId', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    await db.calendarPost.delete({ where: { id: postId, orgId: request.orgId } });
    return { success: true, deletedId: postId };
  });

  // POST /api/clients/:clientId/calendar/:month/visual-refs/backfill
  app.post('/clients/:clientId/calendar/:month/visual-refs/backfill', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const decodedMonth = decodeURIComponent(month);
    const { count } = (request.body as { count?: number }) || {};
    const perPost = Math.max(1, Math.min(12, count || 6));

    const calMonth = await db.calendarMonth.findFirst({
      where: { orgId, clientId, month: decodedMonth },
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
              orgId,
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
    return reply.status(501).send({ error: 'Single post regeneration not yet implemented', postId });
  });
}
