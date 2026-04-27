import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { createJob, processJob } from '../workers/queue.js';
import { reportWorker } from '../workers/report.worker.js';

const ReportBody = z.object({
  theme: z.enum(['aura', 'dark', 'pitch']).optional(),
});

// Monthly client-deliverable PPTX. Differs from /api/clients/:id/calendar/:m/export
// (which is the internal calendar dump) — this one is the agency-grade
// report meant to be sent TO the client.
export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/clients/:clientId/reports/monthly?month=April%202026
  app.post<{
    Params: { clientId: string };
    Querystring: { month?: string };
  }>('/clients/:clientId/reports/monthly', async (request, reply) => {
    const { clientId } = request.params;
    const monthRaw = request.query.month;
    if (!monthRaw) return reply.status(400).send({ error: 'month query param is required' });
    const month = decodeURIComponent(monthRaw);

    const parsed = ReportBody.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const theme = parsed.data.theme || 'aura';

    const calendarMonth = await db.calendarMonth.findFirst({
      where: { clientId, month },
      select: { id: true, month: true, _count: { select: { posts: true } } },
    });
    if (!calendarMonth) {
      return reply.status(404).send({ error: `Calendar month "${month}" not found for client` });
    }
    if (calendarMonth._count.posts === 0) {
      return reply.status(409).send({ error: 'Cannot generate report for empty calendar month' });
    }

    const job = createJob('report-monthly', {
      clientId,
      calendarMonthId: calendarMonth.id,
      theme,
    });
    processJob(job.id, reportWorker);

    return reply.status(202).send({
      jobId: job.id,
      month: calendarMonth.month,
      theme,
      postCount: calendarMonth._count.posts,
    });
  });

  // GET /api/clients/:clientId/reports — list past reports.
  app.get<{ Params: { clientId: string } }>('/clients/:clientId/reports', async (request) => {
    const { clientId } = request.params;
    return db.exportJob.findMany({
      where: { clientId, type: { startsWith: 'report-pptx-' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, status: true, fileUrl: true, calendarMonthId: true, createdAt: true },
    });
  });
}
