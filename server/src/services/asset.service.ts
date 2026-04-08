import { db } from '../db/prisma.js';

export const assetService = {
  async listByClient(clientId: string) {
    return db.asset.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  },

  async getById(id: string) {
    return db.asset.findUnique({ where: { id } });
  },

  async create(data: { clientId: string; name: string; fileUrl: string; thumbUrl?: string | null; mimeType: string; width?: number; height?: number }) {
    return db.asset.create({ data });
  },

  async update(id: string, data: Partial<{ name: string; tags: any; analysis: any; safeForClient: boolean }>) {
    return db.asset.update({ where: { id }, data });
  },

  async remove(id: string) {
    return db.asset.delete({ where: { id } });
  },

  async linkToPost(postId: string, assetId: string) {
    return db.calendarPostAsset.create({ data: { postId, assetId } });
  },

  async unlinkFromPost(postId: string, assetId: string) {
    return db.calendarPostAsset.delete({ where: { postId_assetId: { postId, assetId } } });
  },
};
