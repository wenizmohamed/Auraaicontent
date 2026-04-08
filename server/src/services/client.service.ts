import { db } from '../db/prisma.js';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const clientService = {
  async list() {
    return db.client.findMany({ orderBy: { createdAt: 'desc' }, include: { brief: { select: { id: true } } } });
  },

  async getById(id: string) {
    return db.client.findUnique({ where: { id }, include: { brief: true } });
  },

  async create(data: { name: string; industry?: string; website?: string; instagramHandle?: string; primaryColor?: string; logoUrl?: string }) {
    const slug = slugify(data.name);
    const existing = await db.client.findUnique({ where: { slug } });
    if (existing) throw { statusCode: 409, message: `Client with slug "${slug}" already exists` };
    return db.client.create({ data: { ...data, slug } });
  },

  async update(id: string, data: Partial<{ name: string; industry: string; website: string; instagramHandle: string; primaryColor: string; logoUrl: string; status: string }>) {
    return db.client.update({ where: { id }, data });
  },

  async remove(id: string) {
    return db.client.delete({ where: { id } });
  },
};
