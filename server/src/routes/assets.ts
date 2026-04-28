import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { authGuard } from '../middleware/auth.js';
import { errMsg } from '../lib/err.js';
import { assetService } from '../services/asset.service.js';
import { storageService } from '../services/storage.service.js';
import { analyzeAssetWorker } from '../workers/assetAnalysis.worker.js';

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

export async function assetRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/assets/:assetId/download — authed, scoped to client visibility.
  // Path-traversal hardened: resolved file MUST live under UPLOADS_ROOT.
  // Single-tenant model means any authed user can download any client's
  // assets today; the clientId scope hook is here ready for the
  // multi-tenancy migration so we don't have to revisit every callsite.
  app.get('/assets/:assetId/download', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = await assetService.getById(assetId);
    if (!asset?.fileUrl) return reply.status(404).send({ error: 'Asset not found' });

    const absolute = storageService.getAbsolutePath(asset.fileUrl);
    const resolved = path.resolve(absolute);
    if (!resolved.startsWith(UPLOADS_ROOT + path.sep) && resolved !== UPLOADS_ROOT) {
      return reply.status(400).send({ error: 'Invalid asset path' });
    }
    if (!fs.existsSync(resolved)) {
      return reply.status(404).send({ error: 'Asset file missing on disk' });
    }

    const filename = asset.name || path.basename(resolved);
    const safe = filename.replace(/[^\w.\-]+/g, '_');
    return reply
      .header('Content-Type', asset.mimeType || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${safe}"`)
      .header('X-Asset-Id', asset.id)
      .send(fs.createReadStream(resolved));
  });

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
    } catch (err: unknown) {
      return reply.status(422).send({ error: errMsg(err) });
    }
  });

  // PATCH /api/assets/:assetId
  app.patch('/assets/:assetId', async (request) => {
    const { assetId } = request.params as { assetId: string };
    const { name, tags, safeForClient } = request.body as { name?: string; tags?: string[]; safeForClient?: boolean };
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
