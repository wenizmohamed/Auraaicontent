// Plan-cap enforcement tests.
//
// Context: the caps in src/lib/plan-caps.ts are sold on the Billing page but
// had zero call sites, so nothing was enforced. Enforcement is now real but
// gated on BILLING_ENFORCE=1 and defaults OFF, because the live org sits at
// 19/20 clients and 62/100 monthly videos and would be blocked mid-month.
//
// These tests pin all four behaviours: under cap allows, over cap blocks with
// the flag on, over cap only warns with the flag off, and a plan string we do
// not recognise never blocks anyone.
//
// No database: db/prisma.js is mocked, counts come from a mutable state object.
//
// Run:  npm test -- plan-caps.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = {
  org: { plan: 'agency', status: 'active' } as { plan: string | null; status?: string } | null,
  clients: 0,
  seats: 0,
  usage: 0,
};

const dbFake = {
  organization: { findUnique: vi.fn(async () => state.org) },
  client: { count: vi.fn(async () => state.clients) },
  orgMembership: { count: vi.fn(async () => state.seats) },
  usageEvent: { count: vi.fn(async () => state.usage) },
};

vi.mock('../src/db/prisma.js', () => ({ db: dbFake, systemDb: dbFake }));

const ORG = 'org_radix_media';

let warnSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

beforeEach(() => {
  vi.clearAllMocks(); // call history only, the fake implementations stay
  state.org = { plan: 'agency', status: 'active' };
  state.clients = 0;
  state.seats = 0;
  state.usage = 0;
  delete process.env.BILLING_ENFORCE;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) as unknown as typeof warnSpy;
});

afterEach(() => {
  warnSpy.mockRestore();
  delete process.env.BILLING_ENFORCE;
});

function warnLines(): string[] {
  return warnSpy.mock.calls.map((args) => args.map(String).join(' '));
}

describe('plan limits table', () => {
  it('agency sells 20 clients and 100 videos, which is what the Billing page shows', async () => {
    const { PLAN_LIMITS } = await import('../src/lib/plan-caps.js');
    expect(PLAN_LIMITS.agency.maxClients).toBe(20);
    expect(PLAN_LIMITS.agency.monthlyAiVideoCalls).toBe(100);
  });
});

describe('under cap: the request goes through', () => {
  it('allows a client create at 19/20 even with enforcement ON (the live org today)', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.clients = 19;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(false);
    expect(decision.used).toBe(19);
    expect(decision.cap).toBe(20);
    expect(decision.plan).toBe('agency');
    expect(warnLines()).toHaveLength(0);
  });

  it('allows the 62nd of 100 monthly videos with enforcement ON', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.usage = 62;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'ai.video', 'video.generate');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(false);
    expect(decision.used).toBe(62);
    expect(decision.cap).toBe(100);
  });

  it('allows a seat under the cap', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: 'studio', status: 'active' };
    state.seats = 4;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'seats', 'invitation.create');
    expect(decision.allowed).toBe(true);
    expect(decision.cap).toBe(5);
  });

  it('does not gate a kind that has no quota field', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.usage = 100_000;
    const { enforceQuota } = await import('../src/lib/plan-caps.js');

    expect(await enforceQuota(ORG, 'embedding')).toMatchObject({ ok: true });
  });
});

describe('over cap with BILLING_ENFORCE=1: blocked', () => {
  it('blocks the 21st client and reports the numbers and upgrade path', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.clients = 20;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(false);
    expect(decision.wouldBlock).toBe(true);
    expect(decision.enforced).toBe(true);
    expect(decision.used).toBe(20);
    expect(decision.cap).toBe(20);
    expect(decision.reason).toContain('20/20');
    expect(decision.upgradeUrl).toBe('/billing');
    expect(warnLines().join('\n')).toContain('BLOCKED');
  });

  it('blocks the 101st video of the month', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.usage = 100;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'ai.video', 'video.generate');
    expect(decision.allowed).toBe(false);
    expect(decision.wouldBlock).toBe(true);
    expect(decision.reason).toContain('ai.video');
  });

  it('blocks a seat over the cap', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: 'starter', status: 'active' };
    state.seats = 2;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'seats', 'invitation.create');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Seat cap reached (2/2)');
  });

  it('blocks a canceled subscription outright', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: 'agency', status: 'canceled' };
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'ai.text', 'caption.generate');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('canceled');
  });
});

describe('over cap with the flag OFF: warns, never blocks', () => {
  it('lets the 21st client through and logs one line naming org, cap, usage and action', async () => {
    state.clients = 20;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(true);
    expect(decision.enforced).toBe(false);

    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WOULD BLOCK');
    expect(lines[0]).toContain(`org=${ORG}`);
    expect(lines[0]).toContain('plan=agency');
    expect(lines[0]).toContain('cap=clients');
    expect(lines[0]).toContain('used=20/20');
    expect(lines[0]).toContain('action=client.create');
    expect(lines[0]).toContain('enforce=0');
    expect(lines[0].split('\n')).toHaveLength(1);
  });

  it('treats any value other than 1 as off', async () => {
    process.env.BILLING_ENFORCE = '0';
    state.usage = 100;
    const { checkCap, billingEnforceEnabled } = await import('../src/lib/plan-caps.js');

    expect(billingEnforceEnabled()).toBe(false);
    const decision = await checkCap(ORG, 'ai.video', 'video.generate');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(true);
    expect(warnLines()).toHaveLength(1);
  });

  it('stays silent while the org is under its cap', async () => {
    state.clients = 5;
    const { checkCap } = await import('../src/lib/plan-caps.js');

    await checkCap(ORG, 'clients', 'client.create');
    expect(warnLines()).toHaveLength(0);
  });
});

describe('unknown plan falls back safely', () => {
  it('never blocks on a plan string that is not in the limits table', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: 'enterprise', status: 'active' };
    state.clients = 9_999;
    const { checkCap, resolvePlan } = await import('../src/lib/plan-caps.js');

    expect(resolvePlan('enterprise')).toEqual({ plan: 'trial', known: false });

    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(false);
    expect(warnLines().join('\n')).toContain('unknown plan');
  });

  it('does not throw when the limits table is indexed with a stale plan', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: 'legacy_pro_2024', status: 'active' };
    state.usage = 5_000;
    const { enforceQuota, assertSeatAvailable, assertClientSlotAvailable } = await import('../src/lib/plan-caps.js');

    await expect(enforceQuota(ORG, 'ai.text')).resolves.toMatchObject({ ok: true });
    await expect(assertSeatAvailable(ORG)).resolves.toMatchObject({ ok: true });
    await expect(assertClientSlotAvailable(ORG)).resolves.toMatchObject({ ok: true });
  });

  it('an empty plan is the trial default, not an unknown plan', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.org = { plan: null, status: 'active' };
    state.clients = 5;
    const { checkCap, resolvePlan } = await import('../src/lib/plan-caps.js');

    expect(resolvePlan(null)).toEqual({ plan: 'trial', known: true });
    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(false);
    expect(decision.cap).toBe(5); // trial maxClients
  });

  it('fails open when the count query itself throws', async () => {
    process.env.BILLING_ENFORCE = '1';
    dbFake.client.count.mockRejectedValueOnce(new Error('connection reset'));
    const { checkCap } = await import('../src/lib/plan-caps.js');

    const decision = await checkCap(ORG, 'clients', 'client.create');
    expect(decision.allowed).toBe(true);
    expect(decision.wouldBlock).toBe(false);
    expect(warnLines().join('\n')).toContain('check FAILED');
  });
});

describe('capGuard preHandler', () => {
  function fakeReply() {
    const reply = {
      code: 0,
      payload: undefined as unknown,
      status(c: number) { reply.code = c; return reply; },
      send(p: unknown) { reply.payload = p; return reply; },
    };
    return reply;
  }

  it('sends 402 with the upgrade path when enforcement is on and the org is over', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.clients = 20;
    const { capGuard } = await import('../src/lib/plan-caps.js');
    const reply = fakeReply();

    await capGuard('clients', 'client.create')({ orgId: ORG } as never, reply as never);

    expect(reply.code).toBe(402);
    expect(reply.payload).toMatchObject({ code: 'PLAN_LIMIT_REACHED', cap: 'clients', used: 20, limit: 20, upgradeUrl: '/billing' });
  });

  it('does not touch the reply when enforcement is off', async () => {
    state.clients = 20;
    const { capGuard } = await import('../src/lib/plan-caps.js');
    const reply = fakeReply();

    await capGuard('clients', 'client.create')({ orgId: ORG } as never, reply as never);

    expect(reply.code).toBe(0);
    expect(reply.payload).toBeUndefined();
    expect(warnLines()).toHaveLength(1);
  });

  it('stays out of the way when the request has no org (authGuard owns that)', async () => {
    process.env.BILLING_ENFORCE = '1';
    state.clients = 20;
    const { capGuard } = await import('../src/lib/plan-caps.js');
    const reply = fakeReply();

    await capGuard('clients', 'client.create')({} as never, reply as never);

    expect(reply.code).toBe(0);
    expect(dbFake.client.count).not.toHaveBeenCalled();
  });
});
