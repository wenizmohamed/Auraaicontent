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

    // Block duplicate month generation
    const existing = await db.calendarMonth.findFirst({ where: { clientId, month } });
    if (existing) {
      return reply.status(409).send({ error: `Calendar for "${month}" already exists. Delete it first or use a different month.`, existingId: existing.id });
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
  // Returns all months for a client, newest first, with post counts.
  // Used by Calendar/Review auto-loaders so we don't have to guess month names.
  app.get('/clients/:clientId/calendar/months', async (request) => {
    const { clientId } = request.params as { clientId: string };
    const months = await db.calendarMonth.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        month: true,
        status: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
    });
    return months.map(m => ({
      id: m.id,
      month: m.month,
      status: m.status,
      createdAt: m.createdAt,
      postCount: m._count.posts,
    }));
  });

  // GET /api/clients/:clientId/calendar/:month
  app.get('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const decodedMonth = decodeURIComponent(month);

    const calendarMonth = await db.calendarMonth.findFirst({
      where: { clientId, month: decodedMonth },
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

  // DELETE /api/clients/:clientId/calendar/:month — deletes ALL matching months (handles duplicates)
  app.delete('/clients/:clientId/calendar/:month', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const decodedMonth = decodeURIComponent(month);

    const all = await db.calendarMonth.findMany({ where: { clientId, month: decodedMonth } });
    if (all.length === 0) return reply.status(404).send({ error: 'Calendar month not found' });

    // Posts cascade-delete via Prisma schema
    for (const m of all) {
      await db.calendarMonth.delete({ where: { id: m.id } });
    }
    return { success: true, deleted: all.length, month: decodedMonth };
  });

  // PATCH /api/calendar-posts/:postId
  app.patch('/calendar-posts/:postId', async (request) => {
    const { postId } = request.params as { postId: string };
    const updates = request.body as any;
    const { id, calendarMonthId, createdAt, updatedAt, ...data } = updates;
    return db.calendarPost.update({ where: { id: postId }, data });
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
