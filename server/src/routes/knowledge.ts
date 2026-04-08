import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { knowledgeService } from '../services/knowledge.service.js';
import { storageService } from '../services/storage.service.js';
import { embedKnowledgeItem } from '../workers/embeddings.worker.js';
import { retrieveContext } from '../services/retrieval.service.js';

export async function knowledgeRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/clients/:clientId/knowledge
  app.get('/clients/:clientId/knowledge', async (request) => {
    const { clientId } = request.params as { clientId: string };
    return knowledgeService.listByClient(clientId);
  });

  // POST /api/clients/:clientId/knowledge/upload
  app.post('/clients/:clientId/knowledge/upload', async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await file.toBuffer();
    const { fileUrl } = await storageService.saveFile(buffer, file.filename, file.mimetype);

    const item = await knowledgeService.create({
      clientId,
      title: file.filename,
      type: file.mimetype,
      fileUrl,
    });

    return reply.status(201).send(item);
  });

  // DELETE /api/knowledge/:knowledgeItemId
  app.delete('/knowledge/:knowledgeItemId', async (request) => {
    const { knowledgeItemId } = request.params as { knowledgeItemId: string };
    const item = await knowledgeService.getById(knowledgeItemId);
    if (item?.fileUrl) await storageService.deleteFile(item.fileUrl);
    await knowledgeService.remove(knowledgeItemId);
    return { success: true };
  });

  // POST /api/knowledge/:knowledgeItemId/embed
  app.post('/knowledge/:knowledgeItemId/embed', async (request, reply) => {
    const { knowledgeItemId } = request.params as { knowledgeItemId: string };
    try {
      const result = await embedKnowledgeItem(knowledgeItemId);
      return result;
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // GET /api/clients/:clientId/knowledge/retrieve?q=query
  // Bonus: test endpoint for retrieval verification
  app.get('/clients/:clientId/knowledge/retrieve', async (request) => {
    const { clientId } = request.params as { clientId: string };
    const { q, k } = request.query as { q?: string; k?: string };
    if (!q) return { error: 'q query parameter required', chunks: [] };
    const chunks = await retrieveContext(clientId, q, parseInt(k || '5'));
    return { query: q, chunks };
  });
}
