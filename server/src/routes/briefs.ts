import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { errStatus, errMessage, errCode } from '../services/providers/errors.js';
import { briefService, normalizeMonth } from '../services/brief.service.js';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';
import { assertClientInOrg } from '../lib/tenant.js';

export async function briefRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/brief[?month=August%202026]
  app.get('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month } = (request.query as { month?: string }) || {};
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const brief = await briefService.getByClientId(request.orgId!, clientId, month);
    if (!brief) return reply.status(404).send({ error: 'No brief found for this client' });
    return brief;
  });

  // GET /api/clients/:clientId/briefs — all briefs (for "copy last month" + history)
  app.get('/clients/:clientId/briefs', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    return briefService.list(request.orgId!, clientId);
  });

  // PUT /api/clients/:clientId/brief[?month=...] — upsert this month's brief
  app.put('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month } = (request.query as { month?: string }) || {};
    const bodyMonth = (request.body as { month?: unknown } | null | undefined)?.month;
    const targetMonth = typeof month === 'string' && month ? month : (typeof bodyMonth === 'string' ? bodyMonth : '');
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    // Detect create vs update by checking for an existing brief BEFORE upsert.
    // Briefs are stored under the normalized ISO month key; normalize here too
    // or a label-form month ("August 2026") never matches → create/update mislabel.
    const existingBefore = await db.clientBrief.findFirst({ where: { clientId, orgId: request.orgId!, month: normalizeMonth(targetMonth) } }).catch(() => null);
    try {
      const saved = await briefService.upsert(request.orgId!, clientId, request.body, targetMonth);
      auditService.log({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId,
        action: 'brief.save',
        entityType: 'ClientBrief',
        entityId: saved?.id,
        payload: {
          mode: existingBefore ? 'update' : 'create',
          fields: Object.keys((request.body as Record<string, unknown> | null | undefined) || {}),
        },
      }).catch(() => {});
      return saved;
    } catch (err) {
      if (errCode(err) === 'P2003') {
        return reply.status(404).send({ error: `Client ${clientId} no longer exists.` });
      }
      throw err;
    }
  });

  // GET /api/clients/:clientId/brief/completeness[?month=...]
  app.get('/clients/:clientId/brief/completeness', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { month } = (request.query as { month?: string }) || {};
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const brief = await briefService.getByClientId(request.orgId!, clientId, month);
    return briefService.completeness(brief);
  });

  // GET /api/clients/:clientId/brief/prompt-pack
  app.get('/clients/:clientId/brief/prompt-pack', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const client = await clientService.getById(request.orgId!, clientId);
    if (!client) return reply.status(404).send({ error: 'Client not found' });
    const brief = await briefService.getByClientId(request.orgId!, clientId);
    return { promptPack: briefService.promptPack(client, brief) };
  });
}
