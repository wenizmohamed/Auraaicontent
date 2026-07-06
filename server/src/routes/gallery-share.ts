// Client collaboration gallery (T3#15). A token-gated, client-facing view of a
// client's generated assets where the client can leave per-asset feedback
// (comment + approve/changes) — extends the ReviewLink pattern to the asset
// library. Public routes are UNAUTHENTICATED (token IS the credential); the
// create/list routes are org-scoped behind authGuard.
import { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { errStatus, errMessage } from '../services/providers/errors.js';

function newToken(): string {
  return randomBytes(18).toString('base64url');
}

export async function galleryShareRoutes(app: FastifyInstance) {
  // ── Authed: create a share link for a client ──────────────────────
  app.post('/clients/:clientId/gallery-share', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const orgId = request.orgId!;
      const { clientId } = request.params as { clientId: string };
      const { title, expiresInDays } = (request.body as { title?: string; expiresInDays?: number }) || {};
      const client = await db.client.findFirst({ where: { id: clientId, orgId }, select: { id: true, name: true } });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const token = newToken();
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 864e5) : null;
      await db.galleryShareLink.create({
        data: { orgId, clientId, token, title: title || `${client.name} — gallery`, expiresAt, isActive: true },
      });
      const base = process.env.RADIX_APP_BASE_URL || 'https://radixcontent.com';
      return { token, url: `${base}/g/${token}`, expiresAt };
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err, 'Could not create share link') });
    }
  });

  // ── Authed: list a client's share links + feedback the client left ──
  app.get('/clients/:clientId/gallery-share', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const orgId = request.orgId!;
      const { clientId } = request.params as { clientId: string };
      const [links, feedback] = await Promise.all([
        db.galleryShareLink.findMany({ where: { orgId, clientId }, orderBy: { createdAt: 'desc' } }),
        db.assetFeedback.findMany({ where: { orgId, assetId: { in: (await db.asset.findMany({ where: { orgId, clientId }, select: { id: true } })).map((a) => a.id) } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      return { links, feedback };
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err, 'Could not load share links') });
    }
  });

  // ── Public: the client-facing gallery ─────────────────────────────
  app.get('/gallery/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = await db.galleryShareLink.findUnique({ where: { token } });
    if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
      return reply.status(404).send({ error: 'This gallery link is no longer active.' });
    }
    const [client, assets, feedback] = await Promise.all([
      db.client.findFirst({ where: { id: link.clientId, orgId: link.orgId }, select: { name: true } }),
      db.asset.findMany({
        where: { orgId: link.orgId, clientId: link.clientId, safeForClient: true },
        select: { id: true, name: true, fileUrl: true, thumbUrl: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 200,
      }),
      db.assetFeedback.findMany({ where: { shareToken: token }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { title: link.title, clientName: client?.name ?? 'Client', assets, feedback };
  });

  // ── Public: leave feedback on an asset ────────────────────────────
  app.post('/gallery/:token/assets/:assetId/feedback', async (request, reply) => {
    const { token, assetId } = request.params as { token: string; assetId: string };
    const { authorName, comment, decision } = (request.body as { authorName?: string; comment?: string; decision?: string }) || {};
    if (!authorName?.trim()) return reply.status(400).send({ error: 'Your name is required' });
    if (!comment?.trim() && !decision) return reply.status(400).send({ error: 'Add a comment or a decision' });
    const link = await db.galleryShareLink.findUnique({ where: { token } });
    if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
      return reply.status(404).send({ error: 'This gallery link is no longer active.' });
    }
    // asset must belong to this link's client
    const asset = await db.asset.findFirst({ where: { id: assetId, orgId: link.orgId, clientId: link.clientId }, select: { id: true } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });
    const row = await db.assetFeedback.create({
      data: {
        orgId: link.orgId, assetId, shareToken: token,
        authorName: authorName.trim().slice(0, 120),
        comment: comment?.trim().slice(0, 2000) || null,
        decision: decision === 'approved' || decision === 'changes' ? decision : null,
      },
    });
    return { ok: true, id: row.id };
  });
}
