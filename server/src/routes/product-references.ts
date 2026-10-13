// Product reference gallery — workshop 2026-05-06 #4 (Haneen Malak).
// Per-client catalog of products with multiple angle images. Frontend
// drag-drops these into generation prompts so the AI uses consistent
// visuals across a campaign (Magnetic-style flow).
//
// Routes (all org-scoped via authGuard preHandler):
//   GET    /api/clients/:clientId/product-refs        — list
//   POST   /api/clients/:clientId/product-refs        — create
//   PATCH  /api/clients/:clientId/product-refs/:id    — update name/desc/angles/tags
//   DELETE /api/clients/:clientId/product-refs/:id    — delete
//
// `angles` shape: [{ url: string, thumbUrl?: string, mimeType: string, label?: string, primary?: boolean }]
// We don't upload bytes here — caller uses the existing /api/assets upload
// flow to land the file in storage, then references the returned URLs.

import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';

export async function productReferenceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // List all product references for a client
  app.get<{ Params: { clientId: string } }>(
    '/clients/:clientId/product-refs',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      // Confirm the client belongs to this org before exposing its refs
      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const refs = await db.productReference.findMany({
        where: { clientId, orgId },
        orderBy: { createdAt: 'desc' },
      });
      return refs;
    },
  );

  // Create a product reference
  app.post<{ Params: { clientId: string } }>(
    '/clients/:clientId/product-refs',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      const userId = request.user?.userId;
      const body = request.body as { name: string; description?: string; angles: Prisma.InputJsonValue[]; tags?: Prisma.InputJsonValue };
      if (!body?.name || !Array.isArray(body?.angles) || body.angles.length === 0) {
        return reply.status(400).send({ error: 'name + at least one angle required' });
      }
      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const created = await db.productReference.create({
        data: {
          orgId, clientId,
          name: body.name,
          description: body.description ?? null,
          angles: body.angles,
          // NOTE(types): bare `null` kept as before; Prisma's Json? input type
          // only admits Prisma.JsonNull / DbNull, hence the assertion.
          tags: (body.tags ?? null) as Prisma.InputJsonValue,
        },
      });
      auditService.log({
        orgId, userId, clientId,
        action: 'product-ref.create',
        entityType: 'ProductReference',
        entityId: created.id,
        payload: { name: created.name, angleCount: body.angles.length },
      }).catch(() => {});
      return reply.status(201).send(created);
    },
  );

  // Update
  app.patch<{ Params: { clientId: string; id: string } }>(
    '/clients/:clientId/product-refs/:id',
    async (request, reply) => {
      const { clientId, id } = request.params;
      const orgId = request.orgId!;
      const body = request.body as Partial<{ name: string; description: string; angles: Prisma.InputJsonValue[]; tags: Prisma.InputJsonValue }>;
      const existing = await db.productReference.findFirst({
        where: { id, clientId, orgId },
      });
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      const updated = await db.productReference.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.angles !== undefined ? { angles: body.angles } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
        },
      });
      return updated;
    },
  );

  // Delete
  app.delete<{ Params: { clientId: string; id: string } }>(
    '/clients/:clientId/product-refs/:id',
    async (request, reply) => {
      const { clientId, id } = request.params;
      const orgId = request.orgId!;
      const userId = request.user?.userId;
      const existing = await db.productReference.findFirst({
        where: { id, clientId, orgId },
        select: { id: true, name: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      await db.productReference.delete({ where: { id } });
      auditService.log({
        orgId, userId, clientId,
        action: 'product-ref.delete',
        entityType: 'ProductReference',
        entityId: id,
        payload: { name: existing.name },
      }).catch(() => {});
      return { success: true, deletedId: id };
    },
  );
}
