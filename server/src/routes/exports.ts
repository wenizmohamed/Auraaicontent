import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { createJob, processJob } from '../workers/queue.js';
import { exportWorker } from '../workers/export.worker.js';

export async function exportRoutes(app: FastifyInstance) {

  // POST /api/clients/:clientId/calendar/:month/export
  // Triggers an export job (PPTX or PDF)
  app.post('/clients/:clientId/calendar/:month/export', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const { type = 'pptx' } = (request.body as any) || {};
    const decodedMonth = decodeURIComponent(month);

    if (!['pptx'].includes(type)) {
      return reply.status(400).send({ error: `Unsupported export type: ${type}. Supported: pptx` });
    }

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
