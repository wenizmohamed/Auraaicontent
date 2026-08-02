// Session-continuity guards for the auth surface. No database required:
// the Prisma client is replaced with an in-memory double, so these run in CI
// without a live Postgres.
//
// Covers two regressions:
//
//   1. POST /api/auth/register used to return only { token, ... }. The client
//      stores `refreshToken ?? null`, so rotateRefresh() short-circuited and
//      every account created through /register died at the 1 hour access-token
//      TTL with no silent refresh. Register must mirror /login: mint a refresh
//      token, persist its hash, and hand the raw value back.
//
//   2. Removing a member (or changing their role) used to leave their refresh
//      tokens alive, so a removed employee kept minting fresh access tokens for
//      the full 30 day refresh lifetime. Both paths must revoke.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Must be set before src/config/env.ts is evaluated (it throws on missing
// required vars). Stubbed so other spec files see their original values back.
vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL || 'postgresql://radix:radix@127.0.0.1:5432/radix_test');
vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET || 'auth-session-spec-secret');
vi.stubEnv('ALLOW_PUBLIC_REGISTER', 'true'); // bypass the prod signup gate
vi.stubEnv('AUTO_ORG_DOMAINS', ''); // force the personal-org branch
vi.stubEnv('TEAM_ADMIN_EMAILS', '');

const ORG_ID = 'org_test';
const OWNER_ID = 'user_owner';
const TARGET_ID = 'user_target';

vi.mock('../src/db/prisma.js', () => {
  const state = {
    refreshTokenCreates: [] as any[],
    refreshTokenRevocations: [] as any[],
    membershipUpdates: [] as any[],
    membershipDeletes: [] as any[],
    roles: new Map<string, string>([
      ['user_owner', 'OWNER'],
      ['user_target', 'EDITOR'],
    ]),
    ownerCount: 2,
  };

  const orgMembership = {
    findUnique: async ({ where }: any) => {
      const userId = where?.userId_orgId?.userId;
      const orgId = where?.userId_orgId?.orgId;
      const role = state.roles.get(userId);
      if (!role) return null;
      return { id: `mem_${userId}`, userId, orgId, role, createdAt: new Date() };
    },
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => state.ownerCount,
    create: async ({ data }: any) => ({ id: 'mem_new', ...data }),
    update: async (args: any) => {
      state.membershipUpdates.push(args);
      return { id: 'mem_updated', ...args.data };
    },
    delete: async (args: any) => {
      state.membershipDeletes.push(args);
      return { id: 'mem_deleted' };
    },
  };

  const refreshToken = {
    create: async ({ data }: any) => {
      state.refreshTokenCreates.push(data);
      return { id: `rt_${state.refreshTokenCreates.length}`, ...data };
    },
    updateMany: async (args: any) => {
      state.refreshTokenRevocations.push(args);
      return { count: 1 };
    },
  };

  const tx = {
    user: {
      create: async ({ data }: any) => ({ id: 'user_new', ...data }),
      update: async () => ({}),
      findUnique: async () => ({ currentOrgId: 'org_test' }),
    },
    organization: {
      create: async ({ data }: any) => ({ id: 'org_new', ...data }),
      findUnique: async () => null,
    },
    orgMembership,
    refreshToken,
  };

  const db = {
    __state: state,
    user: { findUnique: async () => null, update: async () => ({}) },
    organization: { findUnique: async () => ({ name: 'Test Org' }) },
    invitation: { findFirst: async () => null },
    orgMembership,
    refreshToken,
    auditLog: { create: async () => ({}) },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };

  return { db, systemDb: db };
});

let state: any;
let mintRefreshToken: () => { raw: string; hash: string; expiresAt: Date };
let hashRefreshToken: (raw: string) => string;
let registerStatus = 0;
let registerBody: any;
let ownerToken = '';
let orgsApp: any;

beforeAll(async () => {
  const prisma: any = await import('../src/db/prisma.js');
  state = prisma.db.__state;

  const authMod = await import('../src/middleware/auth.js');
  mintRefreshToken = authMod.mintRefreshToken;
  hashRefreshToken = authMod.hashRefreshToken;
  ownerToken = authMod.signToken({
    userId: OWNER_ID,
    email: 'owner@example.com',
    role: 'member',
    orgId: ORG_ID,
    orgRole: 'OWNER',
  });

  const Fastify = (await import('fastify')).default;
  const { authRoutes } = await import('../src/routes/auth.js');
  const { orgsRoutes } = await import('../src/routes/orgs.js');

  const authApp = Fastify();
  await authApp.register(authRoutes, { prefix: '/api/auth' });
  await authApp.ready();
  const res = await authApp.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'user-agent': 'auth-session-spec' },
    payload: { email: 'newuser@example.com', password: 'hunter2', name: 'New User' },
  });
  registerStatus = res.statusCode;
  registerBody = res.json();
  await authApp.close();

  orgsApp = Fastify();
  await orgsApp.register(orgsRoutes, { prefix: '/api/orgs' });
  await orgsApp.ready();
});

afterAll(async () => {
  if (orgsApp) await orgsApp.close();
  vi.unstubAllEnvs();
});

describe('mintRefreshToken / hashRefreshToken', () => {
  it('returns a raw token that differs from its stored hash', () => {
    const pair = mintRefreshToken();
    expect(pair.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.hash).not.toBe(pair.raw);
  });

  it('hashes deterministically so lookup by tokenHash works', () => {
    const pair = mintRefreshToken();
    expect(hashRefreshToken(pair.raw)).toBe(pair.hash);
    expect(hashRefreshToken(pair.raw)).toBe(hashRefreshToken(pair.raw));
  });

  it('mints a distinct token every call', () => {
    const seen = new Set(Array.from({ length: 25 }, () => mintRefreshToken().raw));
    expect(seen.size).toBe(25);
  });

  it('expires in the future, roughly 30 days out', () => {
    const pair = mintRefreshToken();
    const ms = pair.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5_000);
  });
});

describe('POST /api/auth/register response shape', () => {
  it('succeeds', () => {
    expect(registerStatus).toBe(200);
  });

  it('returns an access token and the account payload', () => {
    expect(typeof registerBody.token).toBe('string');
    expect(registerBody.token.length).toBeGreaterThan(0);
    expect(registerBody.user?.email).toBe('newuser@example.com');
    expect(typeof registerBody.activeOrgId).toBe('string');
  });

  it('returns a refreshToken so the client can silently rotate', () => {
    expect(registerBody.refreshToken).toBeTruthy();
    expect(registerBody.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a refreshExpiresAt in the future', () => {
    expect(typeof registerBody.refreshExpiresAt).toBe('string');
    const expiry = new Date(registerBody.refreshExpiresAt).getTime();
    expect(Number.isNaN(expiry)).toBe(false);
    expect(expiry).toBeGreaterThan(Date.now());
  });

  it('persists the hash and never the raw token, with request metadata', () => {
    const rows = state.refreshTokenCreates;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.tokenHash).toBe(hashRefreshToken(registerBody.refreshToken));
    expect(row.tokenHash).not.toBe(registerBody.refreshToken);
    expect(row.userId).toBe(registerBody.user.id);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.userAgent).toBe('auth-session-spec');
  });

  it('matches the /login contract keys', () => {
    for (const key of ['token', 'refreshToken', 'refreshExpiresAt', 'user', 'activeOrgId']) {
      expect(Object.keys(registerBody)).toContain(key);
    }
  });
});

describe('org membership changes revoke refresh tokens', () => {
  it('revokes on member removal', async () => {
    state.refreshTokenRevocations.length = 0;
    const res = await orgsApp.inject({
      method: 'DELETE',
      url: `/api/orgs/${ORG_ID}/members/${TARGET_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(state.membershipDeletes.length).toBe(1);
    expect(state.refreshTokenRevocations.length).toBe(1);
    const call = state.refreshTokenRevocations[0];
    expect(call.where.userId).toBe(TARGET_ID);
    expect(call.where.revokedAt).toBe(null);
    expect(call.data.revokedAt instanceof Date).toBe(true);
  });

  it('revokes on role change so the stale orgRole in the JWT cannot be renewed', async () => {
    state.refreshTokenRevocations.length = 0;
    const res = await orgsApp.inject({
      method: 'PATCH',
      url: `/api/orgs/${ORG_ID}/members/${TARGET_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'VIEWER' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, role: 'VIEWER' });
    expect(state.membershipUpdates.length).toBe(1);
    expect(state.refreshTokenRevocations.length).toBe(1);
    expect(state.refreshTokenRevocations[0].where.userId).toBe(TARGET_ID);
  });

  it('does not revoke when the role is unchanged', async () => {
    state.refreshTokenRevocations.length = 0;
    const res = await orgsApp.inject({
      method: 'PATCH',
      url: `/api/orgs/${ORG_ID}/members/${TARGET_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(200);
    expect(state.refreshTokenRevocations.length).toBe(0);
  });
});
