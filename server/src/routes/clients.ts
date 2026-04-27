import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';
import { parseOr400 } from '../lib/parseOr400.js';

// Common client fields shared between create + update.
// Service auto-derives slug + ignores timezone, so neither belongs in the body.
// nullable() permits clients sending `null` to clear a field; .optional()
// permits omitting it entirely. The service signature accepts `field?: string`
// (not nullable), so we strip nulls at the boundary.
const ClientBaseFields = {
  name: z.string().min(1).max(200),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  instagramHandle: z.string().max(60).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  logoUrl: z.string().max(2000).nullable().optional(),
};
const CreateClientBody = z.object(ClientBaseFields);
const UpdateClientBody = z.object({
  ...ClientBaseFields,
  name: z.string().min(1).max(200).optional(),
});

// Bridge zod's nullable→undefined so it matches `field?: string` service shape.
function stripNulls<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], null> } {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null) out[k] = v;
  }
  return out;
}

export async function clientRoutes(app: FastifyInstance) {

  // All client routes require auth
  app.addHook('preHandler', authGuard);

  // GET /api/clients
  app.get('/', async () => {
    return clientService.list();
  });

  // POST /api/clients
  app.post('/', async (request, reply) => {
    const body = parseOr400(CreateClientBody, request.body, reply);
    if (!body) return;
    try {
      const client = await clientService.create(stripNulls(body));
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
  app.patch('/:clientId', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = parseOr400(UpdateClientBody, request.body, reply);
    if (!body) return;
    return clientService.update(clientId, stripNulls(body));
  });

  // DELETE /api/clients/:clientId
  app.delete('/:clientId', async (request) => {
    const { clientId } = request.params as { clientId: string };
    await clientService.remove(clientId);
    return { success: true };
  });
}
