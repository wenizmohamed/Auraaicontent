import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { createJob, processJob } from '../workers/queue.js';
import { exportWorker } from '../workers/export.worker.js';
import { parseOr400 } from '../lib/parseOr400.js';

const ExportTriggerBody = z.object({
  type: z.enum(['pptx']).default('pptx'),
});

export async function exportRoutes(app: FastifyInstance) {

  // POST /api/clients/:clientId/calendar/:month/export
  // Triggers an export job (PPTX or PDF)
  app.post('/clients/:clientId/calendar/:month/export', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const body = parseOr400(ExportTriggerBody, request.body ?? {}, reply);
    if (!body) return;
    const { type } = body;
    const decodedMonth = decodeURIComponent(month);

    const calendarMonth = await db.calendarMonth.findFirst({
      where: { clientId, month: decodedMonth },
    });
    if (!calendarMonth) return reply.status(404).send({ error: 'Calendar month not found' });

    const job = createJob('export', { clientId, calendarMonthId: calendarMonth.id, type });
    processJob(job.id, exportWorker);

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/exports/:clientId — list past exports for a client
  app.get('/exports/:clientId', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const exports = await db.exportJob.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return exports;
  });
}
