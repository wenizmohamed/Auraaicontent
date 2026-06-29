import { db } from '../db/prisma.js';

export const knowledgeService = {
  async listByClient(orgId: string, clientId: string) {
    return db.knowledgeItem.findMany({
      where: { orgId, clientId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  },

  async getById(orgId: string, id: string) {
    return db.knowledgeItem.findUnique({ where: { id, orgId }, include: { chunks: true } });
  },

  async create(orgId: string, data: { clientId: string; title: string; type: string; fileUrl?: string; textContent?: string }) {
    return db.knowledgeItem.create({ data: { ...data, orgId } });
  },

  async remove(orgId: string, id: string) {
    const item = await db.knowledgeItem.findUnique({ where: { id, orgId }, select: { orgId: true } });
    if (!item) throw { statusCode: 404, message: 'Knowledge item not found' };
    return db.knowledgeItem.delete({ where: { id, orgId } });
  },

  async saveChunks(orgId: string, knowledgeItemId: string, chunks: { chunkText: string; metadata?: any }[]) {
    for (const chunk of chunks) {
      // Postgres text columns reject NUL bytes (error 22021); PDF/scraped
      // extractions sometimes carry them, which would fail the whole insert.
      const chunkText = chunk.chunkText.replace(/\u0000/g, '');
      await db.knowledgeChunk.create({
        data: { orgId, knowledgeItemId, chunkText, metadata: chunk.metadata || null },
      });
    }
  },

  async getChunksByItemId(orgId: string, knowledgeItemId: string) {
    return db.knowledgeChunk.findMany({ where: { orgId, knowledgeItemId } });
  },
};
