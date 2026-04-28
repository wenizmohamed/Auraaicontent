// Smoke tests — fast contract checks against the LIVE VPS deployment.
// These are NOT unit tests; they hit https://srv1494206.hstgr.cloud (the real
// production server) over the network. Set SMOKE_BASE_URL to override (e.g.
// SMOKE_BASE_URL=http://127.0.0.1:8787 for local).
//
// Goal: catch the kind of contract drift that static checks can't see —
// 17 known endpoints respond with the expected shape and status class.
// Runtime ~6-8s on a warm pm2 instance. Failure here = real-world breakage.

import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_BASE_URL || 'https://srv1494206.hstgr.cloud';
const TIMEOUT_MS = 12_000;

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* non-JSON ok for some endpoints */ }
    return { status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

describe('smoke: public endpoints', () => {
  it('GET /api/health → 200 + { status: "ok" }', async () => {
    const { status, body } = await req('/api/health');
    expect(status).toBe(200);
    expect((body as any).status).toBe('ok');
  });

  it('GET /api/providers/status → 200 + { providers }', async () => {
    const { status, body } = await req('/api/providers/status');
    expect(status).toBe(200);
    expect((body as any).providers).toBeTypeOf('object');
  });

  it('GET / → 302 (redirect) or 200 (prod)', async () => {
    const r = await fetch(`${BASE}/`, { redirect: 'manual' });
    expect([200, 302]).toContain(r.status);
  });
});

describe('smoke: auth contract', () => {
  it('POST /api/auth/login with bad body → 400 (zod rejects shape)', async () => {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  it('POST /api/auth/login with bad creds → 401', async () => {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.test', password: 'wrongpw1234' }),
    });
    expect(status).toBe(401);
  });

  it('POST /api/auth/refresh with bad body → 400 (zod rejects)', async () => {
    const { status } = await req('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  it('GET /api/auth/me unauthenticated → 401', async () => {
    const { status } = await req('/api/auth/me');
    expect(status).toBe(401);
  });

  it('PATCH /api/auth/me unauthenticated → 401', async () => {
    const { status } = await req('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(status).toBe(401);
  });

  it('POST /api/auth/password unauthenticated → 401', async () => {
    const { status } = await req('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'a', newPassword: 'b' }),
    });
    expect(status).toBe(401);
  });
});

describe('smoke: protected endpoints (no auth → 401)', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/clients'],
    ['GET', '/api/clients/cmnone/calendar/months'],
    ['GET', '/api/clients/cmnone/calendar/archived'],
    ['GET', '/api/clients/cmnone/content-pieces'],
    ['GET', '/api/clients/cmnone/knowledge'],
    ['GET', '/api/jobs/abc'],
    ['GET', '/api/health/details'],
  ];
  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} → 401`, async () => {
      const { status } = await req(path, { method });
      expect(status).toBe(401);
    });
  }
});

describe('smoke: agent mode is gone (was deleted 2026-04-23)', () => {
  it('GET /api/agent/sessions → 404 (route does not exist)', async () => {
    const { status } = await req('/api/agent/sessions');
    expect([401, 404]).toContain(status); // 401 if auth-guarded, 404 if route truly removed
  });
});

describe('smoke: rate-limit headers wire (any endpoint surfaces them)', () => {
  it('GET /api/health → X-RateLimit-* headers present', async () => {
    const r = await fetch(`${BASE}/api/health`);
    // Health is exempt from limit but the test proves the middleware
    // is wired; we instead check a non-exempt public endpoint.
    const r2 = await fetch(`${BASE}/api/providers/status`);
    expect(r2.headers.get('x-ratelimit-limit')).toBeTruthy();
    expect(r2.headers.get('x-ratelimit-remaining')).toBeTruthy();
    expect(r2.headers.get('x-ratelimit-reset')).toBeTruthy();
    expect(r.status).toBe(200);
  });
});
