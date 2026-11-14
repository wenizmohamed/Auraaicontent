import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// The primary workspace guard used to be a hardcoded org id. It now comes from
// PRIMARY_ORG_IDS, or, when that is unset, the oldest organisation. These tests
// pin both paths so the guard can never silently lapse after an id change.

const db = vi.hoisted(() => ({
  organization: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  user: { findUnique: vi.fn() },
}));

vi.mock('../src/db/prisma.js', () => ({ db }));
vi.mock('../src/middleware/auth.js', () => ({
  authGuard: async (request: any) => {
    request.user = { userId: 'u_staff', email: 'staff@example.com' };
    request.orgId = 'org_current';
  },
}));

const { adminRoutes } = await import('../src/routes/admin.js');

async function app() {
  const a = Fastify();
  await a.register(adminRoutes, { prefix: '/api/admin' });
  return a;
}

const savedPrimary = process.env.PRIMARY_ORG_IDS;
const savedStaff = process.env.STAFF_EMAILS;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STAFF_EMAILS = 'staff@example.com';
  delete process.env.PRIMARY_ORG_IDS;
  db.organization.findFirst.mockResolvedValue({ id: 'org_oldest' });
  db.organization.findUnique.mockImplementation(async ({ where }: any) => ({ id: where.id, name: `Org ${where.id}` }));
  db.organization.delete.mockResolvedValue({});
});

afterEach(() => {
  if (savedPrimary === undefined) delete process.env.PRIMARY_ORG_IDS; else process.env.PRIMARY_ORG_IDS = savedPrimary;
  if (savedStaff === undefined) delete process.env.STAFF_EMAILS; else process.env.STAFF_EMAILS = savedStaff;
});

describe('admin primary workspace guard', () => {
  it('without PRIMARY_ORG_IDS, refuses to delete the oldest organisation', async () => {
    const a = await app();
    const res = await a.inject({ method: 'DELETE', url: '/api/admin/orgs/org_oldest' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/primary AURA workspace/);
    expect(db.organization.findFirst).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    expect(db.organization.delete).not.toHaveBeenCalled();
  });

  it('with PRIMARY_ORG_IDS set, protects every listed id and skips the oldest-org lookup', async () => {
    process.env.PRIMARY_ORG_IDS = 'org_a, org_b';
    const a = await app();
    const res = await a.inject({ method: 'DELETE', url: '/api/admin/orgs/org_b' });
    expect(res.statusCode).toBe(400);
    expect(db.organization.findFirst).not.toHaveBeenCalled();
    expect(db.organization.delete).not.toHaveBeenCalled();
  });

  it('still deletes a workspace that is not primary', async () => {
    const a = await app();
    const res = await a.inject({ method: 'DELETE', url: '/api/admin/orgs/org_other' });
    expect(res.statusCode).toBe(200);
    expect(db.organization.delete).toHaveBeenCalledWith({ where: { id: 'org_other' } });
  });

  it('the org list flags only the primary workspace', async () => {
    db.organization.findMany.mockResolvedValue(
      ['org_new', 'org_oldest'].map((id) => ({
        id, name: id, slug: id, plan: 'studio', status: 'active', stripeCustomerId: null,
        createdAt: new Date('2026-04-29T00:00:00Z'), _count: { memberships: 1, clients: 1, calendarMonths: 0 },
      })),
    );
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/api/admin/orgs' });
    expect(res.statusCode).toBe(200);
    const flags = Object.fromEntries(res.json().map((o: any) => [o.id, o.primary]));
    expect(flags).toEqual({ org_new: false, org_oldest: true });
  });
});
