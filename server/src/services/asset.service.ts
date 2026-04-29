import { db } from '../db/prisma.js';

export const assetService = {
  async listByClient(orgId: string, clientId: string) {
    return db.asset.findMany({ where: { orgId, clientId }, orderBy: { createdAt: 'desc' } });
  },

  async getById(orgId: string, id: string) {
    return db.asset.findUnique({ where: { id, orgId } });
  },

  async create(orgId: string, data: { clientId: string; name: string; fileUrl: string; thumbUrl?: string | null; mimeType: string; width?: number; height?: number }) {
    return db.asset.create({ data: { ...data, orgId } });
  },

  async update(orgId: string, id: string, data: Partial<{ name: string; tags: any; analysis: any; safeForClient: boolean }>) {
    const a = await db.asset.findUnique({ where: { id, orgId }, select: { orgId: true } });
    if (!a) throw { statusCode: 404, message: 'Asset not found' };
    return db.asset.update({ where: { id, orgId }, data });
  },

  async remove(orgId: string, id: string) {
    const a = await db.asset.findUnique({ where: { id, orgId }, select: { orgId: true } });
    if (!a) throw { statusCode: 404, message: 'Asset not found' };
    return db.asset.delete({ where: { id, orgId } });
  },

  async linkToPost(orgId: string, postId: string, assetId: string) {
    return db.calendarPostAsset.create({ data: { postId, assetId, orgId } });
  },

  async unlinkFromPost(orgId: string, postId: string, assetId: string) {
    // Composite PK + orgId — keep guard happy and double-check scope at the
    // FK layer.  deleteMany returns count; we don't need the row back.
    return db.calendarPostAsset.deleteMany({ where: { postId, assetId, orgId } });
  },
};
