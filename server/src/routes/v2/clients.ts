import type { FastifyInstance } from 'fastify';
import { db } from '../../db/prisma.js';
import { apiKeyGuard } from '../../middleware/api-key-guard.js';
import { ok, err } from './_common.js';

// Read-only /v2 surface for the client owning the API key. The single-tenant
// design means an API key is tightly scoped to one Client — there's no
// "list all clients" endpoint. Each /v2 caller sees their workspace only.

export async function v2ClientRoutes(app: FastifyInstance) {
  app.addHook('preHandler', apiKeyGuard);

  // GET /v2/client — the workspace this key belongs to.
  app.get('/client', async (request, reply) => {
    const { clientId } = request.apiKeyContext!;
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        slug: true,
        industry: true,
        website: true,
        instagramHandle: true,
        primaryColor: true,
        timezone: true,
        status: true,
        createdAt: true,
      },
    });
    if (!client) return err(reply, 'Client not found', 404);
    return ok(reply, client);
  });

  // GET /v2/brief — strategic brief snapshot.
  app.get('/brief', async (request, reply) => {
    const { clientId } = request.apiKeyContext!;
    const brief = await db.clientBrief.findUnique({ where: { clientId } });
    if (!brief) return err(reply, 'No brief found for this workspace', 404);
    return ok(reply, brief);
  });
}
