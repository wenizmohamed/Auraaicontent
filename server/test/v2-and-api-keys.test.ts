import { describe, it, expect } from 'vitest';

const BASE = process.env.SMOKE_BASE_URL ?? 'https://srv1494206.hstgr.cloud';

// Contract gate for the /v2 Bearer surface and the JWT-authed /api/api-keys
// CRUD. We only assert on UNauth / wrong-key paths so the tests don't need
// to mint real credentials. A second-tier integration test (lives outside
// the smoke suite) covers the happy path.
describe('contract: /v2 Bearer surface', () => {
  it('GET /v2/client without auth → 401', async () => {
    const r = await fetch(`${BASE}/v2/client`);
    expect(r.status).toBe(401);
  });

  it('GET /v2/client with junk Bearer → 401 + {ok:false, error}', async () => {
    const r = await fetch(`${BASE}/v2/client`, {
      headers: { Authorization: 'Bearer sk-radix-deadbeefdeadbeefdeadbeefdeadbeef' },
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('GET /v2/calendars with junk Bearer → 401', async () => {
    const r = await fetch(`${BASE}/v2/calendars`, {
      headers: { Authorization: 'Bearer sk-radix-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(r.status).toBe(401);
  });
});

describe('contract: /api/api-keys CRUD (JWT-authed)', () => {
  it('GET /api/api-keys without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys?clientId=any`);
    expect(r.status).toBe(401);
  });

  it('POST /api/api-keys without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', name: 'test' }),
    });
    expect(r.status).toBe(401);
  });

  it('POST /api/api-keys/zzz/revoke without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/api-keys/zzz/revoke`, { method: 'POST' });
    expect(r.status).toBe(401);
  });
});

describe('contract: monthly report endpoint', () => {
  it('POST /api/clients/:id/reports/monthly without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/clients/zzz/reports/monthly?month=April%202026`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('GET /api/clients/:id/reports without JWT → 401', async () => {
    const r = await fetch(`${BASE}/api/clients/zzz/reports`);
    expect(r.status).toBe(401);
  });
});
