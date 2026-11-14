import { describe, it, expect, vi, beforeEach } from 'vitest';

// 2026-11-14 access audit: a removed member kept full access for the life of
// their token (up to 7 days), a demoted member kept the old role, and the
// read-only VIEWER role could publish, delete and spend. authGuard now reads
// membership from the DB (cached 30s) and blocks VIEWER writes.

const env = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-membership-spec-0123456789';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
  return {};
});
void env;

const db = vi.hoisted(() => ({ orgMembership: { findUnique: vi.fn() } }));
vi.mock('../src/db/prisma.js', () => ({ db }));

const { authGuard, signToken, invalidateMembership } = await import('../src/middleware/auth.js');

function reply() {
  const r: any = { code: 0, body: null };
  r.status = (c: number) => { r.code = c; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  return r;
}
function request(token: string, method = 'GET', url = '/api/clients') {
  return { headers: { authorization: `Bearer ${token}` }, method, url } as any;
}
const tok = (orgRole = 'EDITOR') => signToken({ userId: 'u1', email: 'u1@example.com', role: 'member', orgId: 'org1', orgRole });

beforeEach(() => { db.orgMembership.findUnique.mockReset(); invalidateMembership('u1'); });

describe('authGuard membership', () => {
  it('a removed member is refused on the next request, whatever the token says', async () => {
    db.orgMembership.findUnique.mockResolvedValue(null);
    const r = reply();
    await authGuard(request(tok('OWNER')), r);
    expect(r.code).toBe(401);
  });

  it('the role comes from the DB, not the token', async () => {
    db.orgMembership.findUnique.mockResolvedValue({ role: 'VIEWER' });
    const req = request(tok('OWNER'));
    await authGuard(req, reply());
    expect(req.user.orgRole).toBe('VIEWER');
  });

  it('caches the lookup, and invalidateMembership drops it', async () => {
    db.orgMembership.findUnique.mockResolvedValue({ role: 'EDITOR' });
    await authGuard(request(tok()), reply());
    await authGuard(request(tok()), reply());
    expect(db.orgMembership.findUnique).toHaveBeenCalledTimes(1);
    invalidateMembership('u1', 'org1');
    await authGuard(request(tok()), reply());
    expect(db.orgMembership.findUnique).toHaveBeenCalledTimes(2);
  });

  it('a DB error falls back to the token instead of locking everyone out', async () => {
    db.orgMembership.findUnique.mockRejectedValue(new Error('db down'));
    const req = request(tok('EDITOR'));
    const r = reply();
    await authGuard(req, r);
    expect(r.code).toBe(0);
    expect(req.user.orgRole).toBe('EDITOR');
  });
});

describe('VIEWER is read-only on the server', () => {
  beforeEach(() => db.orgMembership.findUnique.mockResolvedValue({ role: 'VIEWER' }));

  it('blocks writes', async () => {
    for (const [method, url] of [['POST', '/api/creative/images/generate'], ['DELETE', '/api/brand-kit/c1'], ['POST', '/api/calendar-posts/p1/publish'], ['POST', '/api/agent/runs']]) {
      const r = reply();
      await authGuard(request(tok(), method, url), r);
      expect(r.code, `${method} ${url}`).toBe(403);
    }
  });

  it('allows reads, its own session, invites and assistant chat', async () => {
    for (const [method, url] of [['GET', '/api/clients'], ['POST', '/api/auth/logout'], ['PATCH', '/api/auth/me'], ['POST', '/api/invitations/abc/accept'], ['POST', '/api/assistant/chat']]) {
      const r = reply();
      await authGuard(request(tok(), method, url), r);
      expect(r.code, `${method} ${url}`).toBe(0);
    }
  });
});
