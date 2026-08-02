import { FastifyInstance } from 'fastify';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { clientService } from '../services/client.service.js';
import { authGuard, denyViewer } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';
import { capGuard } from '../lib/plan-caps.js';

export async function clientRoutes(app: FastifyInstance) {

  // All client routes require auth
  app.addHook('preHandler', authGuard);

  // GET /api/clients
  app.get('/', async (request) => {
    return clientService.list(request.orgId!);
  });

  // POST /api/clients
  // Plan cap on client slots. Inert unless BILLING_ENFORCE=1; with the flag
  // off it only records the breach so the blast radius is visible first.
  app.post('/', { preHandler: capGuard('clients', 'client.create') }, async (request, reply) => {
    const { name, industry, website, instagramHandle, primaryColor, logoUrl, locale, dialect, whatsappNumber } =
      request.body as any;
    if (!name) return reply.status(400).send({ error: 'Client name is required' });
    try {
      const client = await clientService.create(request.orgId!, { name, industry, website, instagramHandle, primaryColor, logoUrl, locale, dialect, whatsappNumber });
      auditService.log({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: client.id,
        action: 'client.create',
        entityType: 'Client',
        entityId: client.id,
        payload: { name: client.name, industry: client.industry ?? null },
      }).catch(() => {});
      return reply.status(201).send(client);
    } catch (err) {
      if (errStatus(err) === 409) return reply.status(409).send({ error: errMessage(err) });
      throw err;
    }
  });

  // GET /api/clients/:clientId
  app.get('/:clientId', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const client = await clientService.getById(request.orgId!, clientId);
    if (!client) return reply.status(404).send({ error: 'Client not found' });
    return client;
  });

  // PATCH /api/clients/:clientId
  app.patch('/:clientId', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      const updated = await clientService.update(request.orgId!, clientId, request.body as any);
      const updatedKeys = Object.keys((request.body as any) || {});
      auditService.log({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId,
        action: 'client.update',
        entityType: 'Client',
        entityId: clientId,
        payload: { fields: updatedKeys },
      }).catch(() => {});
      return updated;
    } catch (err) {
      if (errStatus(err) === 404) return reply.status(404).send({ error: errMessage(err) });
      throw err;
    }
  });

  // DELETE /api/clients/:clientId
  app.delete('/:clientId', { preHandler: denyViewer }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await clientService.remove(request.orgId!, clientId);
      auditService.log({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId,
        action: 'client.delete',
        entityType: 'Client',
        entityId: clientId,
      }).catch(() => {});
      return { success: true };
    } catch (err) {
      if (errStatus(err) === 404) return reply.status(404).send({ error: errMessage(err) });
      throw err;
    }
  });
}
