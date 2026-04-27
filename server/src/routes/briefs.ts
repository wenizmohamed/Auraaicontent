import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { briefService } from '../services/brief.service.js';
import { clientService } from '../services/client.service.js';
import { authGuard } from '../middleware/auth.js';
import { parseOr400 } from '../lib/parseOr400.js';

// ClientBrief upsert body — mirrors prisma/schema.prisma:93-118.
// Json columns (products/pillars/campaignMoments/channels/approvers) keep
// the existing "schema-light" posture via z.any() — over-modeling them now
// would force a frontend rewrite. Strings get reasonable max caps to stop
// runaway storage bills if a field gets pasted into.
const ClientBriefBody = z.object({
  objective: z.string().max(2000).optional(),
  audience: z.string().max(2000).optional(),
  tone: z.string().max(1000).optional(),
  brandDo: z.string().max(5000).optional(),
  brandDont: z.string().max(5000).optional(),
  products: z.any().optional(),
  pillars: z.any().optional(),
  campaignMoments: z.any().optional(),
  mandatoryInclusions: z.string().max(5000).optional(),
  complianceNotes: z.string().max(5000).optional(),
  channels: z.any().optional(),
  cadence: z.string().max(500).optional(),
  references: z.string().max(5000).optional(),
  approvers: z.any().optional(),
  seasonalNotes: z.string().max(5000).optional(),
  competitors: z.string().max(5000).optional(),
  successDefinition: z.string().max(5000).optional(),
  pastLearnings: z.string().max(5000).optional(),
});

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
  app.put('/clients/:clientId/brief', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const body = parseOr400(ClientBriefBody, request.body, reply);
    if (!body) return;
    // Validate the client exists FIRST so we return a clear 404 instead of leaking
    // a Prisma P2003 foreign-key violation as a generic 500.
    const client = await clientService.getById(clientId);
    if (!client) {
      return reply.status(404).send({ error: `Client not found: ${clientId}. The selected client may have been deleted — refresh the Clients page.` });
    }
    try {
      return await briefService.upsert(clientId, body);
    } catch (err: any) {
      // Defensive: if a race condition deletes the client between the check above
      // and the upsert, surface the FK violation as a 404 too.
      if (err?.code === 'P2003') {
        return reply.status(404).send({ error: `Client ${clientId} no longer exists.` });
      }
      throw err;
    }
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
