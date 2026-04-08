import { FastifyInstance } from 'fastify';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';

export async function clientRoutes(app: FastifyInstance) {

  // All client routes require auth
  app.addHook('preHandler', authGuard);

  // GET /api/clients
  app.get('/', async () => {
    return clientService.list();
  });

  // POST /api/clients
  app.post('/', async (request, reply) => {
    const { name, industry, website, instagramHandle, primaryColor, logoUrl } =
      request.body as any;
    if (!name) return reply.status(400).send({ error: 'Client name is required' });
    try {
      const client = await clientService.create({ name, industry, website, instagramHandle, primaryColor, logoUrl });
      return reply.status(201).send(client);
    } catch (err: any) {
      if (err.statusCode === 409) return reply.status(409).send({ error: err.message });
      throw err;
    }
  });

  // GET /api/clients/:clientId
  app.get('/:clientId', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const client = await clientService.getById(clientId);
    if (!client) return reply.status(404).send({ error: 'Client not found' });
    return client;
  });

  // PATCH /api/clients/:clientId
  app.patch('/:clientId', async (request) => {
    const { clientId } = request.params as { clientId: string };
    return clientService.update(clientId, request.body as any);
  });

  // DELETE /api/clients/:clientId
  app.delete('/:clientId', async (request) => {
    const { clientId } = request.params as { clientId: string };
    await clientService.remove(clientId);
    return { success: true };
  });
}
