import { db } from '../db/prisma.js';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// All operations are scoped by orgId — slug uniqueness is per-org so two
// agencies can both have a client called "Acme" without collision.
export const clientService = {
  async list(orgId: string) {
    return db.client.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { brief: { select: { id: true } } },
    });
  },

  async getById(orgId: string, id: string) {
    const client = await db.client.findUnique({ where: { id, orgId }, include: { brief: true } });
    return client ?? null;
  },

  async create(orgId: string, data: { name: string; industry?: string; website?: string; instagramHandle?: string; primaryColor?: string; logoUrl?: string; locale?: string; dialect?: string; whatsappNumber?: string }) {
    const slug = slugify(data.name);
    const existing = await db.client.findUnique({ where: { orgId_slug: { orgId, slug } } });
    if (existing) throw { statusCode: 409, message: `Client with slug "${slug}" already exists in this organization` };
    return db.client.create({ data: { ...data, slug, orgId } });
  },

  async update(orgId: string, id: string, data: Partial<{ name: string; industry: string; website: string; instagramHandle: string; primaryColor: string; logoUrl: string; status: string; locale: string; dialect: string; whatsappNumber: string }>) {
    const existing = await db.client.findUnique({ where: { id, orgId }, select: { orgId: true } });
    if (!existing) throw { statusCode: 404, message: 'Client not found' };
    return db.client.update({ where: { id, orgId }, data });
  },

  async remove(orgId: string, id: string) {
    const existing = await db.client.findUnique({ where: { id, orgId }, select: { orgId: true } });
    if (!existing) throw { statusCode: 404, message: 'Client not found' };
    return db.client.delete({ where: { id, orgId } });
  },
};
