// Cross-tenant isolation tests. Spawns the real Fastify app, seeds two
// scratch organizations, and asserts that org-A's user cannot read,
// update, or delete any org-B resource via any route. This file IS the
// asset technical due diligence will run.
//
// Run:  npm test -- tenancy.spec.ts
//
// Pre-req: DATABASE_URL points at a database that's safe to write to
// (local dev DB or CI scratch DB). Test rows are cleaned up in afterAll.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/prisma.js';

const TEST_PREFIX = 'tenancy_test_';

interface TestOrg {
  orgId: string;
  userId: string;
  email: string;
  token: string;
  clientId: string;
  monthId: string;
  postId: string;
}

let app: FastifyInstance;
let orgA: TestOrg;
let orgB: TestOrg;

async function seedOrg(label: 'a' | 'b'): Promise<TestOrg> {
  const orgId = `${TEST_PREFIX}org_${label}_${Date.now()}`;
  const email = `${TEST_PREFIX}${label}@example.com`;
  await db.organization.create({
    data: { id: orgId, name: `Tenancy Test Org ${label.toUpperCase()}`, slug: `${TEST_PREFIX}${label}-${Date.now()}`, plan: 'agency' },
  });
  const user = await db.user.create({
    data: { email, name: `Test ${label}`, passwordHash: 'x', currentOrgId: orgId },
  });
  await db.orgMembership.create({ data: { userId: user.id, orgId, role: 'OWNER' } });

  const client = await db.client.create({
    data: { orgId, name: `Client-${label}`, slug: `client-${label}-${Date.now()}` },
  });
  const month = await db.calendarMonth.create({
    data: { orgId, clientId: client.id, month: `Test Month ${label}` },
  });
  const post = await db.calendarPost.create({
    data: {
      orgId,
      calendarMonthId: month.id,
      date: '2026-05-01',
      title: `post-${label}`,
      pillar: 'test',
      platform: 'Instagram',
      format: 'Static',
      caption: 'test caption',
    },
  });

  const token = jwt.sign(
    { userId: user.id, email, role: 'member', orgId, orgRole: 'OWNER' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
  return { orgId, userId: user.id, email, token, clientId: client.id, monthId: month.id, postId: post.id };
}

async function cleanup() {
  await db.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await db.organization.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  orgA = await seedOrg('a');
  orgB = await seedOrg('b');
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

function bearer(t: string) { return { authorization: `Bearer ${t}` }; }

describe('Cross-tenant isolation', () => {
  it('org-B cannot read org-A clients', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot list org-A clients (list returns only org-B)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const c of body) expect(c.orgId).toBe(orgB.orgId);
    expect(body.find((c: any) => c.id === orgA.clientId)).toBeUndefined();
  });

  it('org-B cannot update org-A client', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/clients/${orgA.clientId}`, headers: bearer(orgB.token), payload: { name: 'pwned' } });
    expect(res.statusCode).toBe(404);
    const after = await db.client.findUnique({ where: { id: orgA.clientId, orgId: orgA.orgId } });
    expect(after?.name).not.toBe('pwned');
  });

  it('org-B cannot delete org-A client', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/clients/${orgA.clientId}`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
    const after = await db.client.findUnique({ where: { id: orgA.clientId, orgId: orgA.orgId } });
    expect(after).not.toBeNull();
  });

  it('org-B cannot read org-A brief endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}/brief`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot generate a calendar against org-A client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/clients/${orgA.clientId}/calendar/generate`,
      headers: bearer(orgB.token),
      payload: { month: 'October 2026' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot read org-A calendar months', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}/calendar/months`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot read org-A specific month', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}/calendar/${encodeURIComponent('Test Month a')}`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot delete org-A calendar month', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/clients/${orgA.clientId}/calendar/${encodeURIComponent('Test Month a')}?hard=true`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
    const after = await db.calendarMonth.findUnique({ where: { id: orgA.monthId, orgId: orgA.orgId } });
    expect(after).not.toBeNull();
  });

  it('org-B cannot patch org-A post', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/calendar-posts/${orgA.postId}`, headers: bearer(orgB.token), payload: { caption: 'pwned' } });
    expect(res.statusCode).toBe(404);
    const after = await db.calendarPost.findUnique({ where: { id: orgA.postId, orgId: orgA.orgId } });
    expect(after?.caption).not.toBe('pwned');
  });

  it('org-B cannot delete org-A post', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/calendar-posts/${orgA.postId}`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
    const after = await db.calendarPost.findUnique({ where: { id: orgA.postId, orgId: orgA.orgId } });
    expect(after).not.toBeNull();
  });

  it('org-B cannot list org-A assets', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}/assets`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot list org-A knowledge', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/clients/${orgA.clientId}/knowledge`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(404);
  });

  it('org-B dashboard returns only org-B data', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/dashboard/stats`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clients.total).toBe(1); // only Client-b
  });

  it('org-B activity feed excludes org-A audit logs', async () => {
    await db.auditLog.create({
      data: { orgId: orgA.orgId, userId: orgA.userId, action: 'test:probe', entityType: 'Probe' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/dashboard/activity`, headers: bearer(orgB.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.find((l: any) => l.action === 'test:probe')).toBeUndefined();
  });

  it('org-B cannot create an export for org-A client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/clients/${orgA.clientId}/calendar/${encodeURIComponent('Test Month a')}/export`,
      headers: bearer(orgB.token),
      payload: { type: 'pptx' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('org-B cannot create an agent session against org-A client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/agent/sessions`,
      headers: bearer(orgB.token),
      payload: { title: 'cross-org', clientId: orgA.clientId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('admin route blocks non-staff', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/metrics`, headers: bearer(orgB.token) });
    expect([403, 503]).toContain(res.statusCode); // 403 if STAFF_EMAILS is set, 503 if unconfigured
  });

  it('Prisma tenant guard throws on unscoped query when set to throw mode', async () => {
    const prev = process.env.RADIX_TENANT_GUARD;
    process.env.RADIX_TENANT_GUARD = 'throw';
    try {
      await expect(
        // @ts-expect-error — intentionally calling without `where: { orgId }`
        db.client.findMany({})
      ).rejects.toThrow(/tenant-guard/);
    } finally {
      process.env.RADIX_TENANT_GUARD = prev;
    }
  });
});
