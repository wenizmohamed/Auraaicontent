// BrandKit v2 (F3) — Wave 2.A surface, 2026-05-12.
// 1:1 with Client. POST is upsert (no separate create). Every successful
// upsert snapshots prior state into BrandKitVersion (version++).
//
// Routes (all org-scoped via authGuard preHandler):
//   GET    /api/clients/:clientId/brand-kit           — current row or null
//   POST   /api/clients/:clientId/brand-kit           — upsert + version bump
//   GET    /api/clients/:clientId/brand-kit/versions  — list versions desc
//   DELETE /api/clients/:clientId/brand-kit           — wipe row (versions cascade)
//
// Audit actions: brand-kit.upsert / brand-kit.delete.
// Failure mode: enricher is a no-op when no BrandKit row exists — see
// schema.prisma line 691 comment.

import type { FastifyInstance } from 'fastify';
import type { BrandKit, Prisma } from '@prisma/client';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';

interface BrandKitUpsertBody {
  secondaryColor?: string | null;
  accentColor?: string | null;
  fontPrimary?: string | null;
  fontSecondary?: string | null;
  voiceSamples?: Array<{ context?: string; sample?: string }>;
  voiceDoNot?: { rules?: string[] } | Prisma.InputJsonObject;
  voicePerPlatform?: Record<string, string>;
  sampleImages?: Array<{ url: string; label?: string; primary?: boolean; mimeType?: string }>;
}

export async function brandKitRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET — current BrandKit (or null)
  app.get<{ Params: { clientId: string } }>(
    '/clients/:clientId/brand-kit',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true, primaryColor: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const kit = await db.brandKit.findUnique({
        where: { clientId },
      });
      // Hand the frontend the Client.primaryColor too so it can display the
      // read-only primary swatch even before a BrandKit row exists.
      return { brandKit: kit, clientPrimaryColor: client.primaryColor ?? null };
    },
  );

  // POST — upsert with versioning. On update, snapshot prior state into
  // BrandKitVersion before mutating the live row.
  app.post<{ Params: { clientId: string }; Body: BrandKitUpsertBody }>(
    '/clients/:clientId/brand-kit',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      const userId = request.user?.userId;
      const body = (request.body || {}) as BrandKitUpsertBody;

      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true, primaryColor: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });

      const existing = await db.brandKit.findUnique({ where: { clientId } });

      // Normalize the payload — Prisma Json[] fields need arrays (not undefined)
      // and Json? fields accept null to clear.
      // NOTE(types): a bare `null` on the Json? columns is passed through as
      // before; Prisma's input type only admits Prisma.JsonNull / DbNull there,
      // hence the assertions on voiceDoNot / voicePerPlatform.
      const data = {
        primaryColor: client.primaryColor ?? null,  // mirror from Client for compute simplicity
        secondaryColor: body.secondaryColor ?? null,
        accentColor: body.accentColor ?? null,
        fontPrimary: body.fontPrimary ?? null,
        fontSecondary: body.fontSecondary ?? null,
        voiceSamples: Array.isArray(body.voiceSamples) ? body.voiceSamples : [],
        voiceDoNot: (body.voiceDoNot ?? null) as Prisma.InputJsonValue,
        voicePerPlatform: (body.voicePerPlatform ?? null) as Prisma.InputJsonValue,
        sampleImages: Array.isArray(body.sampleImages) ? body.sampleImages : [],
      };

      let saved: BrandKit;
      if (existing) {
        // Snapshot prior state — full row minus relations — before mutating.
        const { id: _id, changelogEntries: _ce, org: _org, client: _cl, createdAt: _ca, updatedAt: _ua, ...snapshot } = existing as BrandKit & { changelogEntries?: unknown; org?: unknown; client?: unknown };
        await db.brandKitVersion.create({
          data: {
            brandKitId: existing.id,
            version: existing.version,
            changedBy: userId ?? null,
            snapshot,
          },
        });
        saved = await db.brandKit.update({
          where: { id: existing.id },
          data: {
            ...data,
            version: { increment: 1 },
          },
        });
      } else {
        saved = await db.brandKit.create({
          data: {
            orgId,
            clientId,
            version: 1,
            ...data,
          },
        });
      }

      auditService.log({
        orgId,
        userId,
        clientId,
        action: 'brand-kit.upsert',
        entityType: 'BrandKit',
        entityId: saved.id,
        payload: {
          version: saved.version,
          voiceSampleCount: data.voiceSamples.length,
          sampleImageCount: data.sampleImages.length,
        },
      }).catch(() => {});

      return reply.status(existing ? 200 : 201).send(saved);
    },
  );

  // GET versions — desc by version
  app.get<{ Params: { clientId: string } }>(
    '/clients/:clientId/brand-kit/versions',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const kit = await db.brandKit.findUnique({
        where: { clientId },
        select: { id: true },
      });
      if (!kit) return [];
      const versions = await db.brandKitVersion.findMany({
        where: { brandKitId: kit.id },
        orderBy: { version: 'desc' },
        take: 50,
      });
      return versions;
    },
  );

  // DELETE — wipe BrandKit row (versions cascade via Prisma onDelete: Cascade)
  app.delete<{ Params: { clientId: string } }>(
    '/clients/:clientId/brand-kit',
    async (request, reply) => {
      const { clientId } = request.params;
      const orgId = request.orgId!;
      const userId = request.user?.userId;
      const client = await db.client.findFirst({
        where: { id: clientId, orgId },
        select: { id: true },
      });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const kit = await db.brandKit.findUnique({
        where: { clientId },
        select: { id: true, version: true },
      });
      if (!kit) return reply.status(404).send({ error: 'No brand kit to delete' });
      await db.brandKit.delete({ where: { id: kit.id } });
      auditService.log({
        orgId,
        userId,
        clientId,
        action: 'brand-kit.delete',
        entityType: 'BrandKit',
        entityId: kit.id,
        payload: { lastVersion: kit.version },
      }).catch(() => {});
      return { success: true, deletedId: kit.id };
    },
  );
}
