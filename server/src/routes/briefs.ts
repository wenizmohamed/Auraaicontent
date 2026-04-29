import { FastifyInstance } from 'fastify';
import { briefService } from '../services/brief.service.js';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';
import { assertClientInOrg } from '../lib/tenant.js';

export async function briefRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/brief
  app.get('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const brief = await briefService.getByClientId(request.orgId!, clientId);
    if (!brief) return reply.status(404).send({ error: 'No brief found for this client' });
    return brief;
  });

  // PUT /api/clients/:clientId/brief — upsert
  app.put('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    try {
      return await briefService.upsert(request.orgId!, clientId, request.body);
    } catch (err: any) {
      if (err?.code === 'P2003') {
        return reply.status(404).send({ error: `Client ${clientId} no longer exists.` });
      }
      throw err;
    }
  });

  // GET /api/clients/:clientId/brief/completeness
  app.get('/clients/:clientId/brief/completeness', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const brief = await briefService.getByClientId(request.orgId!, clientId);
    return briefService.completeness(brief);
  });

  // GET /api/clients/:clientId/brief/prompt-pack
  app.get('/clients/:clientId/brief/prompt-pack', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    try {
      await assertClientInOrg(clientId, request.orgId);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message });
    }
    const client = await clientService.getById(request.orgId!, clientId);
    if (!client) return reply.status(404).send({ error: 'Client not found' });
    const brief = await briefService.getByClientId(request.orgId!, clientId);
    return { promptPack: briefService.promptPack(client, brief) };
  });
}
