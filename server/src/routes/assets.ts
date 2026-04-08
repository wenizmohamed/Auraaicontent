import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { assetService } from '../services/asset.service.js';
import { storageService } from '../services/storage.service.js';
import { analyzeAssetWorker } from '../workers/assetAnalysis.worker.js';

export async function assetRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/assets
  app.get('/clients/:clientId/assets', async (request) => {
    const { clientId } = request.params as { clientId: string };
    return assetService.listByClient(clientId);
  });

  // POST /api/clients/:clientId/assets/upload
  app.post('/clients/:clientId/assets/upload', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await file.toBuffer();
    const { fileUrl, thumbUrl } = await storageService.saveFile(buffer, file.filename, file.mimetype);

    const asset = await assetService.create({
      clientId,
      name: file.filename,
      fileUrl,
      thumbUrl,
      mimeType: file.mimetype,
    });

    return reply.status(201).send(asset);
  });

  // POST /api/assets/:assetId/analyze
  app.post('/assets/:assetId/analyze', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    try {
      const analysis = await analyzeAssetWorker(assetId);
      return { assetId, analysis };
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // PATCH /api/assets/:assetId
  app.patch('/assets/:assetId', async (request) => {
    const { assetId } = request.params as { assetId: string };
    const { name, tags, safeForClient } = request.body as any;
    return assetService.update(assetId, { name, tags, safeForClient });
  });

  // DELETE /api/assets/:assetId
  app.delete('/assets/:assetId', async (request) => {
    const { assetId } = request.params as { assetId: string };
    const asset = await assetService.getById(assetId);
    if (asset?.fileUrl) await storageService.deleteFile(asset.fileUrl);
    if (asset?.thumbUrl) await storageService.deleteFile(asset.thumbUrl);
    await assetService.remove(assetId);
    return { success: true };
  });

  // POST /api/calendar-posts/:postId/link-asset
  app.post('/calendar-posts/:postId/link-asset', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const { assetId } = request.body as { assetId: string };
    if (!assetId) return reply.status(400).send({ error: 'assetId is required' });
    const link = await assetService.linkToPost(postId, assetId);
    return reply.status(201).send(link);
  });

  // DELETE /api/calendar-posts/:postId/link-asset/:assetId
  app.delete('/calendar-posts/:postId/link-asset/:assetId', async (request) => {
    const { postId, assetId } = request.params as { postId: string; assetId: string };
    await assetService.unlinkFromPost(postId, assetId);
    return { success: true };
  });
}
