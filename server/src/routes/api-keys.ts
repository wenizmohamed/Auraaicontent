import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { mintApiKey } from '../middleware/api-key-guard.js';

const CreateBody = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

// JWT-authed CRUD for managing external API keys. Plaintext key is returned
// exactly once on POST — never recoverable after that. Lost = revoke + reissue.
export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/api-keys?clientId=...
  app.get('/api-keys', async (request, reply) => {
    const { clientId } = request.query as { clientId?: string };
    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });
    const keys = await db.apiKey.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    return keys;
  });

  // POST /api/api-keys — mint a new key. Plaintext returned ONCE.
  app.post('/api-keys', async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { clientId, name, expiresInDays } = parsed.data;
    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    const { plaintext, prefix, hash } = mintApiKey();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const created = await db.apiKey.create({
      data: { clientId, name, keyHash: hash, keyPrefix: prefix, expiresAt },
      select: { id: true, name: true, keyPrefix: true, expiresAt: true, createdAt: true },
    });

    return reply.status(201).send({
      ...created,
      key: plaintext,
      warning: 'Store this key securely. It will not be shown again.',
    });
  });

  // POST /api/api-keys/:id/revoke
  app.post('/api-keys/:id/revoke', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'API key not found' });
    if (existing.revokedAt) return reply.status(409).send({ error: 'Already revoked' });
    const updated = await db.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true, revokedAt: true },
    });
    return updated;
  });

  // DELETE /api/api-keys/:id — hard delete (admin convenience for cleanup).
  app.delete('/api-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'API key not found' });
    await db.apiKey.delete({ where: { id } });
    return { success: true };
  });
}
