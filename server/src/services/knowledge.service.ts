import { db } from '../db/prisma.js';

export const knowledgeService = {
  async listByClient(clientId: string) {
    return db.knowledgeItem.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  },

  async getById(id: string) {
    return db.knowledgeItem.findUnique({ where: { id }, include: { chunks: true } });
  },

  async create(data: { clientId: string; title: string; type: string; fileUrl?: string; textContent?: string }) {
    return db.knowledgeItem.create({ data });
  },

  async remove(id: string) {
    // Cascade deletes chunks automatically
    return db.knowledgeItem.delete({ where: { id } });
  },

  async saveChunks(knowledgeItemId: string, chunks: { chunkText: string; metadata?: any }[]) {
    for (const chunk of chunks) {
      await db.knowledgeChunk.create({
        data: { knowledgeItemId, chunkText: chunk.chunkText, metadata: chunk.metadata || null },
      });
    }
  },

  async getChunksByItemId(knowledgeItemId: string) {
    return db.knowledgeChunk.findMany({ where: { knowledgeItemId } });
  },
};
