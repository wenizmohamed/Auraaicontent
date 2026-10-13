import { FastifyInstance } from 'fastify';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { authGuard, denyViewer } from '../middleware/auth.js';
import { knowledgeService } from '../services/knowledge.service.js';
import { storageService } from '../services/storage.service.js';
import { embedKnowledgeItem } from '../workers/embeddings.worker.js';
import { retrieveContext } from '../services/retrieval.service.js';
import { auditService } from '../services/audit.service.js';
import { assertClientInOrg } from '../lib/tenant.js';

export async function knowledgeRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/knowledge
  app.get('/clients/:clientId/knowledge', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    return knowledgeService.listByClient(orgId, clientId);
  });

  // POST /api/clients/:clientId/knowledge/upload
  app.post('/clients/:clientId/knowledge/upload', async (request, reply) => {
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
    const { fileUrl } = await storageService.saveFile(buffer, file.filename, file.mimetype);

    const item = await knowledgeService.create(orgId, {
      clientId,
      title: file.filename,
      type: file.mimetype,
      fileUrl,
    });

    auditService.log({
      orgId,
      userId: request.user?.userId,
      clientId,
      action: 'knowledge.upload',
      entityType: 'KnowledgeItem',
      entityId: item?.id,
      payload: { title: file.filename, sizeBytes: buffer.length },
    }).catch(() => {});

    // Server-side auto-embed (fire-and-forget). This is the GUARANTEE: embedding no
    // longer depends on the browser staying open or even being the upload client
    // (API/integration uploads get embedded too). Without it, an un-embedded doc is
    // invisible to the agent's RAG enricher. The frontend no longer calls /embed,
    // so there's no race on the worker's deleteMany+recreate.
    const itemId = item?.id;
    if (itemId) {
      embedKnowledgeItem(orgId, itemId)
        .then((r) => request.log.info({ itemId, ...r }, 'knowledge.autoEmbed.done'))
        .catch((err) => request.log.error({ itemId, err: String(err) }, 'knowledge.autoEmbed.failed'));
    }

    return reply.status(201).send(item);
  });

  // DELETE /api/knowledge/:knowledgeItemId
  app.delete('/knowledge/:knowledgeItemId', { preHandler: denyViewer }, async (request, reply) => {
    const { knowledgeItemId } = request.params as { knowledgeItemId: string };
    const orgId = request.orgId!;
    const item = await knowledgeService.getById(orgId, knowledgeItemId);
    if (!item) return reply.status(404).send({ error: 'Knowledge item not found' });
    if (item.fileUrl) await storageService.deleteFile(item.fileUrl);
    await knowledgeService.remove(orgId, knowledgeItemId);
    return { success: true };
  });

  // POST /api/knowledge/:knowledgeItemId/embed
  app.post('/knowledge/:knowledgeItemId/embed', async (request, reply) => {
    const { knowledgeItemId } = request.params as { knowledgeItemId: string };
    const orgId = request.orgId!;
    try {
      const result = await embedKnowledgeItem(orgId, knowledgeItemId);
      return result;
    } catch (err) {
      const geminiOnly = !!(err && typeof err === 'object' && 'geminiOnly' in err && (err as { geminiOnly?: unknown }).geminiOnly);
      const status = errStatus(err, geminiOnly ? 503 : 422);
      return reply.status(status).send({
        error: errMessage(err),
        ...(geminiOnly ? { geminiOnly: true } : {}),
      });
    }
  });

  // GET /api/clients/:clientId/knowledge/retrieve?q=query
  app.get('/clients/:clientId/knowledge/retrieve', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const { q, k } = request.query as { q?: string; k?: string };
    if (!q) return { error: 'q query parameter required', chunks: [] };
    const chunks = await retrieveContext(orgId, clientId, q, parseInt(k || '5'));
    return { query: q, chunks };
  });
}
