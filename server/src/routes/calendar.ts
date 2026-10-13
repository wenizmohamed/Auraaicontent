import { FastifyInstance } from 'fastify';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { authGuard, denyViewer } from '../middleware/auth.js';
import { briefService } from '../services/brief.service.js';
import { auditService } from '../services/audit.service.js';
import { createJob, processJob, findInflightGenerateJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { visualRefsBackfillWorker } from '../workers/visualRefsBackfill.worker.js';
import { assertClientInOrg, assertCalendarPostInOrg } from '../lib/tenant.js';
import { runComplianceCheck, scorePost } from '../services/content-quality.service.js';
import { reviewService } from '../services/review.service.js';
import { capGuard } from '../lib/plan-caps.js';

export async function calendarRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // POST /api/clients/:clientId/calendar/generate → { jobId }
  app.post('/clients/:clientId/calendar/generate', { preHandler: capGuard('ai.text', 'calendar.generate') }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month, pieceCount } = (request.body as { month?: string; pieceCount?: number }) || {};
    const orgId = request.orgId!;

    if (!month) return reply.status(400).send({ error: 'month is required (e.g. "August 2026")' });

    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
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

    const inflight = await findInflightGenerateJob(clientId, month);
    if (inflight) {
      auditService.log({ orgId, userId, clientId, action: 'generate-deduped', entityType: 'CalendarMonth', payload: { month, existingJobId: inflight.id } });
      return { jobId: inflight.id, deduped: true };
    }

    // Validate brief completeness — prefer this month's dedicated brief, falling
    // back to the client default (brief-per-month, 2026-07-14).
    const brief = await briefService.getByClientId(orgId, clientId, month);
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
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
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
    return months.map((m) => ({
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
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
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
  app.delete('/clients/:clientId/calendar/:month', { preHandler: denyViewer }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
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
    auditService.log({
      orgId,
      userId: request.user?.userId,
      clientId,
      action: 'calendar.archive',
      entityType: 'CalendarMonth',
      entityId: all[0]?.id,
      payload: { month: decodedMonth, archivedCount: all.length },
    }).catch(() => {});
    return { success: true, mode: 'archive' as const, archived: all.length, month: decodedMonth, archivedAt: archivedAt.toISOString() };
  });

  // POST /api/clients/:clientId/calendar/:month/restore — undo archive
  app.post('/clients/:clientId/calendar/:month/restore', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
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
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const months = await db.calendarMonth.findMany({
      where: { orgId, clientId, isArchived: true },
      orderBy: { archivedAt: 'desc' },
      select: { id: true, month: true, status: true, isTest: true, createdAt: true, archivedAt: true, _count: { select: { posts: true } } },
    });
    return months.map((m) => ({
      id: m.id, month: m.month, status: m.status, isTest: m.isTest,
      createdAt: m.createdAt, archivedAt: m.archivedAt,
      postCount: m._count.posts,
    }));
  });

  // PATCH /api/calendar-posts/:postId
  // Explicit allowlist — denies mass-assignment of clientId, orgId, status-jumping,
  // platformPublishStatus (worker-only), etc. Blocking only on top-level fields
  // an authenticated org member is intended to edit.
  app.patch('/calendar-posts/:postId', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const PATCHABLE_FIELDS = [
      'title',
      'caption',
      'platform',
      'hashtags',
      'status',
      'date',
      'timing',
      'referenceQuery',
      'pillar',
      'format',
      'scheduledAt',
      'platformConnectionId',
      // NOTE: 'notes' and 'position' removed 2026-07-14 — neither is a column
      // on CalendarPost, so a PATCH including them threw Prisma "Unknown
      // argument" → 500 on the whole update. Per-post notes now live in
      // PostComment (see /calendar-posts/:postId/comments below).
    ] as const;
    const updates = request.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of PATCHABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updates, k)) data[k] = updates[k];
    }
    // platformConnectionId is a foreign key the SCHEDULER later publishes
    // through — an unvalidated id here would post this org's content to another
    // org's (or the wrong client's) social account, and recordSuccess scopes its
    // write-back by the connection's orgId so the post would never flip to
    // 'published' and would republish every hour. The manual publish route
    // validates the connection; the scheduled path must too.
    if (data.platformConnectionId) {
      const conn = await db.platformConnection.findFirst({
        where: { id: String(data.platformConnectionId), orgId: request.orgId! },
        select: { id: true },
      });
      if (!conn) return reply.status(404).send({ error: 'Platform connection not found' });
    }
    // F2 scheduler — when the caller writes a non-null scheduledAt and
    // doesn't override status, stamp status='scheduled' so the scheduler
    // worker (workers/scheduler.worker.ts) picks the row up on its next
    // tick. Caller can explicitly pass status to opt out.
    if (
      Object.prototype.hasOwnProperty.call(updates, 'scheduledAt') &&
      updates.scheduledAt &&
      !Object.prototype.hasOwnProperty.call(updates, 'status')
    ) {
      data.status = 'scheduled';
      // Clear any stale schedule error from a previous failed attempt.
      data.scheduleError = null;
    }
    const updated = await db.calendarPost.update({ where: { id: postId, orgId: request.orgId }, data });
    auditService.log({
      orgId: request.orgId,
      userId: request.user?.userId,
      clientId: (updated as typeof updated & { clientId?: string | null })?.clientId ?? undefined,
      action: 'post.upsert',
      entityType: 'CalendarPost',
      entityId: postId,
      payload: { fields: Object.keys(data) },
    }).catch(() => {});
    return updated;
  });

  // DELETE /api/calendar-posts/:postId
  app.delete('/calendar-posts/:postId', { preHandler: denyViewer }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    // orgId must be in the where clause on BOTH queries — the tenant guard runs
    // in throw mode in prod, so the unscoped versions made this route a
    // guaranteed 500 (and silently blanked clientId in the audit record).
    const existing = await db.calendarPost.findFirst({
      where: { id: postId, orgId: request.orgId! },
      include: { calendarMonth: { select: { clientId: true } } },
    }).catch(() => null);
    await db.calendarPost.delete({ where: { id: postId, orgId: request.orgId! } });
    auditService.log({
      orgId: request.orgId,
      userId: request.user?.userId,
      clientId: existing?.calendarMonth?.clientId ?? undefined,
      action: 'post.delete',
      entityType: 'CalendarPost',
      entityId: postId,
      payload: { calendarMonthId: existing?.calendarMonthId ?? null },
    }).catch(() => {});
    return { success: true, deletedId: postId };
  });

  // ─── Manual post add (Habiba + Asya, 2026-07-14) ────────────────
  // POST /api/clients/:clientId/calendar/:month/posts — add a custom post
  // OUTSIDE the generated plan. Also backs Asya's "duplicate to another
  // platform" (FE clones an existing post's fields with a new platform).
  app.post('/clients/:clientId/calendar/:month/posts', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const decodedMonth = decodeURIComponent(month);
    const cm = await db.calendarMonth.findFirst({ where: { orgId, clientId, month: decodedMonth }, select: { id: true } });
    if (!cm) return reply.status(404).send({ error: `No calendar exists for "${decodedMonth}". Generate it first, then add custom posts.` });
    const b = (request.body as {
      platform?: string; date?: string; title?: string; pillar?: string; format?: string;
      hook?: string; keyMessage?: string; caption?: string; cta?: string; hashtags?: unknown;
      visualDirection?: string; referenceQuery?: string; timing?: string;
    }) || {};
    if (!b.platform || typeof b.platform !== 'string') return reply.status(400).send({ error: 'platform is required' });
    const created = await db.calendarPost.create({
      data: {
        orgId,
        calendarMonthId: cm.id,
        date: typeof b.date === 'string' ? b.date : '',
        title: (b.title || 'Untitled post').toString().slice(0, 300),
        pillar: (b.pillar || '').toString(),
        platform: b.platform,
        format: (b.format || 'Static').toString(),
        hook: b.hook ? String(b.hook) : null,
        keyMessage: b.keyMessage ? String(b.keyMessage) : null,
        caption: (b.caption || '').toString(),
        cta: b.cta ? String(b.cta) : null,
        hashtags: Array.isArray(b.hashtags) ? b.hashtags : [],
        visualDirection: b.visualDirection ? String(b.visualDirection) : null,
        referenceQuery: b.referenceQuery ? String(b.referenceQuery) : null,
        timing: b.timing ? String(b.timing) : null,
        status: 'draft',
      },
    });
    auditService.log({ orgId, userId: request.user?.userId, clientId, action: 'post.manual-add', entityType: 'CalendarPost', entityId: created.id, payload: { month: decodedMonth, platform: created.platform } }).catch(() => {});
    return created;
  });

  // ─── Per-post compliance check (Tamer, 2026-07-14) ──────────────
  // POST /api/calendar-posts/:postId/compliance-check — audit the caption
  // against the client's brief rules; persist to metadata.compliance so the
  // Review page shows the badge on reload.
  app.post('/calendar-posts/:postId/compliance-check', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const post = await db.calendarPost.findFirst({
      where: { id: postId, orgId: request.orgId! },
      select: { caption: true, title: true, hook: true, cta: true, metadata: true, calendarMonth: { select: { clientId: true } } },
    });
    if (!post) return reply.status(404).send({ error: 'Post not found' });
    const clientId = post.calendarMonth?.clientId;
    if (!clientId) return reply.status(400).send({ error: 'Post is not linked to a client' });
    const text = [post.title, post.hook, post.caption, post.cta].filter(Boolean).join('\n');
    try {
      const result = await runComplianceCheck(request.orgId!, clientId, text, { userId: request.user?.userId });
      const existing = (post.metadata && typeof post.metadata === 'object' && !Array.isArray(post.metadata)) ? post.metadata as Record<string, unknown> : {};
      await db.calendarPost.update({ where: { id: postId, orgId: request.orgId! }, data: { metadata: JSON.parse(JSON.stringify({ ...existing, compliance: result })) } });
      return result;
    } catch (err) {
      return reply.status(errStatus(err, 502)).send({ error: errMessage(err, 'Compliance check failed') });
    }
  });

  // ─── Per-post content score (Tamer, 2026-07-14) ─────────────────
  // POST /api/calendar-posts/:postId/score — rate clarity/relevance/TOV/
  // platform-fit/engagement + one improvement tip; persist to metadata.score.
  app.post('/calendar-posts/:postId/score', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    try {
      const { score } = await scorePost(request.orgId!, postId, request.user?.userId);
      const post = await db.calendarPost.findFirst({ where: { id: postId, orgId: request.orgId! }, select: { metadata: true } });
      const existing = (post?.metadata && typeof post.metadata === 'object' && !Array.isArray(post.metadata)) ? post.metadata as Record<string, unknown> : {};
      await db.calendarPost.update({ where: { id: postId, orgId: request.orgId! }, data: { metadata: JSON.parse(JSON.stringify({ ...existing, score })) } });
      return score;
    } catch (err) {
      return reply.status(errStatus(err, 502)).send({ error: errMessage(err, 'Scoring failed') });
    }
  });

  // ─── Per-post quick notes (Asya, 2026-07-14) ────────────────────
  // Internal team notes on a post — reuses the PostComment model (threaded,
  // attributed, and already feeds the learn-from-feedback memory loop).
  app.get('/calendar-posts/:postId/comments', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const comments = await db.postComment.findMany({
      where: { orgId: request.orgId!, postId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, authorName: true, source: true, comment: true, status: true, createdAt: true },
    });
    return { comments };
  });

  app.post('/calendar-posts/:postId/comments', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const { comment, status } = (request.body as { comment?: string; status?: string }) || {};
    if (!comment || !comment.trim()) return reply.status(400).send({ error: 'comment is required' });
    const authorName = request.user?.email || 'Team';
    // reuse the review service so the note also feeds the memory learn-loop
    const created = await reviewService.addComment(request.orgId!, postId, authorName, comment.trim(), status || 'note');
    return created;
  });

  // POST /api/clients/:clientId/calendar/:month/visual-refs/backfill → { jobId }
  // PERF-8: was a 2-5min synchronous loop that nginx-504'd. Now enqueues the
  // visualRefsBackfillWorker and returns 202 + jobId; client polls /api/jobs/:id.
  app.post('/clients/:clientId/calendar/:month/visual-refs/backfill', async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const decodedMonth = decodeURIComponent(month);
    const { count } = (request.body as { count?: number }) || {};
    const perPost = Math.max(1, Math.min(12, count || 6));

    const job = createJob('visual-refs-backfill', {
      orgId, clientId, month: decodedMonth, perPost, userId: request.user?.userId,
    });
    processJob(job.id, visualRefsBackfillWorker);

    auditService.log({
      orgId, userId: request.user?.userId, clientId,
      action: 'visual-refs.backfill',
      entityType: 'CalendarMonth',
      payload: { month: decodedMonth, perPost, jobId: job.id },
    });

    return reply.status(202).send({ jobId: job.id });
  });

  // POST /api/calendar-posts/:postId/regenerate → { jobId } (stub)
  app.post('/calendar-posts/:postId/regenerate', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    return reply.status(501).send({ error: 'Single post regeneration not yet implemented', postId });
  });
}
