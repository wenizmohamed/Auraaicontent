import { FastifyInstance } from 'fastify';
import { briefService } from '../services/brief.service.js';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';

export async function briefRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/brief
  app.get('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const brief = await briefService.getByClientId(clientId);
    if (!brief) return reply.status(404).send({ error: 'No brief found for this client' });
    return brief;
  });

  // PUT /api/clients/:clientId/brief — upsert
  app.put('/clients/:clientId/brief', async (request) => {
    const { clientId } = request.params as { clientId: string };
    return briefService.upsert(clientId, request.body);
  });

  // GET /api/clients/:clientId/brief/completeness
  app.get('/clients/:clientId/brief/completeness', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const brief = await briefService.getByClientId(clientId);
    return briefService.completeness(brief);
  });

  // GET /api/clients/:clientId/brief/prompt-pack
  app.get('/clients/:clientId/brief/prompt-pack', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const client = await clientService.getById(clientId);
    if (!client) return reply.status(404).send({ error: 'Client not found' });
    const brief = await briefService.getByClientId(clientId);
    return { promptPack: briefService.promptPack(client, brief) };
  });
}
