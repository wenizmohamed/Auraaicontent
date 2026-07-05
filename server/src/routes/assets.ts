import { FastifyInstance } from 'fastify';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { authGuard } from '../middleware/auth.js';
import { assetService } from '../services/asset.service.js';
import { storageService } from '../services/storage.service.js';
import { analyzeAssetWorker } from '../workers/assetAnalysis.worker.js';
import { auditService } from '../services/audit.service.js';
import { db } from '../db/prisma.js';
import { assertClientInOrg } from '../lib/tenant.js';

export async function assetRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/assets — gallery scoped to the active org
  app.get('/assets', async (request) => {
    const orgId = request.orgId!;
    const q = (request.query || {}) as { type?: string; clientId?: string; q?: string; take?: string };
    const take = Math.min(parseInt(q.take || '200', 10) || 200, 500);
    const where: any = { orgId };
    if (q.clientId) where.clientId = q.clientId;
    if (q.type === 'image') where.mimeType = { startsWith: 'image/' };
    else if (q.type === 'video') where.mimeType = { startsWith: 'video/' };
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };

    const assets = await db.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { client: { select: { id: true, name: true } } },
    });
    return assets.map((a: any) => ({
      id: a.id,
      name: a.name,
      fileUrl: a.fileUrl,
      thumbUrl: a.thumbUrl,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      tags: a.tags,
      createdAt: a.createdAt.toISOString(),
      client: a.client ? { id: a.client.id, name: a.client.name } : null,
    }));
  });

  // GET /api/clients/:clientId/assets
  app.get('/clients/:clientId/assets', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    return assetService.listByClient(orgId, clientId);
  });

  // POST /api/clients/:clientId/assets/upload
  app.post('/clients/:clientId/assets/upload', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await file.toBuffer();
    const { fileUrl, thumbUrl } = await storageService.saveFile(buffer, file.filename, file.mimetype);

    const asset = await assetService.create(orgId, {
      clientId,
      name: file.filename,
      fileUrl,
      thumbUrl,
      mimeType: file.mimetype,
    });

    auditService.log({
      orgId,
      userId: request.user?.userId,
      clientId,
      action: 'asset.upload',
      entityType: 'Asset',
      entityId: (asset as any)?.id,
      payload: { mimeType: file.mimetype, sizeBytes: buffer.length },
    }).catch(() => {});

    return reply.status(201).send(asset);
  });

  // POST /api/assets/:assetId/analyze
  app.post('/assets/:assetId/analyze', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const orgId = request.orgId!;
    try {
      const analysis = await analyzeAssetWorker(orgId, assetId, request.user?.userId);
      return { assetId, analysis };
    } catch (err) {
      return reply.status(422).send({ error: errMessage(err) });
    }
  });

  // PATCH /api/assets/:assetId
  app.patch('/assets/:assetId', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const orgId = request.orgId!;
    const { name, tags, safeForClient } = request.body as any;
    try {
      return await assetService.update(orgId, assetId, { name, tags, safeForClient });
    } catch (err) {
      if (errStatus(err) === 404) return reply.status(404).send({ error: errMessage(err) });
      throw err;
    }
  });

  // DELETE /api/assets/:assetId
  app.delete('/assets/:assetId', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const orgId = request.orgId!;
    const asset = await assetService.getById(orgId, assetId);
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });
    if (asset.fileUrl) await storageService.deleteFile(asset.fileUrl);
    if (asset.thumbUrl) await storageService.deleteFile(asset.thumbUrl);
    await assetService.remove(orgId, assetId);
    auditService.log({
      orgId,
      userId: request.user?.userId,
      clientId: (asset as any)?.clientId ?? undefined,
      action: 'asset.delete',
      entityType: 'Asset',
      entityId: assetId,
      payload: { mimeType: (asset as any)?.mimeType },
    }).catch(() => {});
    return { success: true };
  });

  // POST /api/calendar-posts/:postId/link-asset
  app.post('/calendar-posts/:postId/link-asset', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const { assetId } = request.body as { assetId: string };
    const orgId = request.orgId!;
    if (!assetId) return reply.status(400).send({ error: 'assetId is required' });
    const link = await assetService.linkToPost(orgId, postId, assetId);
    return reply.status(201).send(link);
  });

  // DELETE /api/calendar-posts/:postId/link-asset/:assetId
  app.delete('/calendar-posts/:postId/link-asset/:assetId', async (request) => {
    const { postId, assetId } = request.params as { postId: string; assetId: string };
    const orgId = request.orgId!;
    await assetService.unlinkFromPost(orgId, postId, assetId);
    return { success: true };
  });
}
