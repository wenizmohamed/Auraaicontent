import { errStatus, errMessage } from '../services/providers/errors.js';
import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { assertClientInOrg } from '../lib/tenant.js';
import { createJob, processJob } from '../workers/queue.js';
import { exportWorker } from '../workers/export.worker.js';
import { auditService } from '../services/audit.service.js';

export async function exportRoutes(app: FastifyInstance) {

  // POST /api/clients/:clientId/calendar/:month/export
  // Triggers an export job (PPTX or PDF). Tenant-guarded: caller's orgId
  // must own the client AND the calendar month, else 404.
  app.post('/clients/:clientId/calendar/:month/export', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const { type = 'pptx' } = (request.body as any) || {};
    const decodedMonth = decodeURIComponent(month);

    if (!['pptx'].includes(type)) {
      return reply.status(400).send({ error: `Unsupported export type: ${type}. Supported: pptx` });
    }

    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (e) {
      return reply.status(errStatus(e, 404)).send({ error: errMessage(e) });
    }

    const calendarMonth = await db.calendarMonth.findFirst({
      where: { clientId, month: decodedMonth, orgId: request.orgId },
    });
    if (!calendarMonth) return reply.status(404).send({ error: 'Calendar month not found' });

    const job = createJob('export', { orgId: request.orgId, clientId, calendarMonthId: calendarMonth.id, type });
    processJob(job.id, exportWorker);

    auditService.log({
      orgId: request.orgId,
      userId: request.user?.userId,
      clientId,
      action: 'export.create',
      entityType: 'ExportJob',
      entityId: job.id,
      payload: { format: type, scope: 'month', month: decodedMonth, calendarMonthId: calendarMonth.id },
    }).catch(() => {});

    return reply.status(202).send({ jobId: job.id });
  });

  // GET /api/exports/:clientId — list past exports for a client (org-scoped)
  app.get('/exports/:clientId', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (e) {
      return reply.status(errStatus(e, 404)).send({ error: errMessage(e) });
    }
    const exports = await db.exportJob.findMany({
      where: { clientId, orgId: request.orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return exports;
  });
}
