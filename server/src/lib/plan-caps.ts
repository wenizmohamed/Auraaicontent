// Plan-tier enforcement. Caps are per calendar month, evaluated by counting
// UsageEvent rows for the org since the start of the current billing period
// (calendar month for now; real-world: subscription anchor day).
//
// Returns 402 Payment Required from routes when the org is over its cap.
// Trial plans get the same caps as Studio so prospects can stress-test.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/prisma.js';

export type PlanTier = 'trial' | 'free' | 'starter' | 'studio' | 'agency';

interface PlanLimits {
  maxClients: number;            // hard cap on Client.count
  monthlyAiTextCalls: number;    // generation/captioning/research per month
  monthlyAiImageCalls: number;
  monthlyAiVideoCalls: number;
  seats: number;                 // OrgMembership.count cap
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  trial:   { maxClients: 5,  monthlyAiTextCalls: 300,  monthlyAiImageCalls: 50,   monthlyAiVideoCalls: 5,  seats: 5 },
  free:    { maxClients: 1,  monthlyAiTextCalls: 25,   monthlyAiImageCalls: 5,    monthlyAiVideoCalls: 0,  seats: 1 },
  starter: { maxClients: 1,  monthlyAiTextCalls: 50,   monthlyAiImageCalls: 25,   monthlyAiVideoCalls: 2,  seats: 2 },
  studio:  { maxClients: 5,  monthlyAiTextCalls: 300,  monthlyAiImageCalls: 200,  monthlyAiVideoCalls: 20, seats: 5 },
  agency:  { maxClients: 20, monthlyAiTextCalls: 2000, monthlyAiImageCalls: 1500, monthlyAiVideoCalls: 100, seats: 999 },
};

function startOfPeriod(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// Resolve the stored Organization.plan string to a tier we have limits for.
//
// Empty / null means the org never subscribed, which is the trial default.
// A NON-empty value that is missing from PLAN_LIMITS (a price wired up in
// Stripe but never added here) resolves with known=false, and every cap check
// then passes. Failing open is deliberate: a stale limits table must never be
// the reason a paying org is blocked. Indexing PLAN_LIMITS with an unknown
// string used to yield undefined and throw on the next property read.
export function resolvePlan(raw: string | null | undefined): { plan: PlanTier; known: boolean } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { plan: 'trial', known: true };
  }
  const candidate = String(raw).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PLAN_LIMITS, candidate)) {
    return { plan: candidate as PlanTier, known: true };
  }
  return { plan: 'trial', known: false };
}

export interface QuotaResult {
  ok: boolean;
  reason?: string;
  used?: number;
  cap?: number;
  plan?: PlanTier;
  upgradeUrl?: string;
}

const KIND_TO_FIELD: Record<string, keyof PlanLimits> = {
  'ai.text': 'monthlyAiTextCalls',
  'ai.image': 'monthlyAiImageCalls',
  'ai.video': 'monthlyAiVideoCalls',
};

// Read-only check — returns whether the org has remaining budget for a given
// kind. Call before invoking the AI provider; on `ok=false`, return 402 to
// the client with the upgradeUrl.
export async function enforceQuota(orgId: string, kind: string): Promise<QuotaResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true, status: true } });
  if (!org) return { ok: false, reason: 'Organization not found' };
  if (org.status === 'canceled') return { ok: false, reason: 'Subscription canceled', upgradeUrl: '/billing' };

  const { plan, known } = resolvePlan(org.plan);
  if (!known) return unknownPlanPass(orgId, org.plan, plan);

  const field = KIND_TO_FIELD[kind];
  if (!field) return { ok: true, plan }; // unknown kinds aren't quota-gated

  const cap = PLAN_LIMITS[plan][field] as number;
  if (cap === Infinity || cap === undefined) return { ok: true, plan };

  const used = await db.usageEvent.count({
    where: { orgId, kind, createdAt: { gte: startOfPeriod() } },
  });
  if (used >= cap) {
    return {
      ok: false,
      reason: `You've used ${used}/${cap} ${kind} calls this month on the ${plan} plan.`,
      used,
      cap,
      plan,
      upgradeUrl: '/billing',
    };
  }
  return { ok: true, used, cap, plan };
}

export async function assertSeatAvailable(orgId: string): Promise<QuotaResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (!org) return { ok: false, reason: 'Organization not found' };
  const { plan, known } = resolvePlan(org.plan);
  if (!known) return unknownPlanPass(orgId, org.plan, plan);
  const cap = PLAN_LIMITS[plan].seats;
  const used = await db.orgMembership.count({ where: { orgId } });
  if (used >= cap) return { ok: false, reason: `Seat cap reached (${used}/${cap})`, used, cap, plan, upgradeUrl: '/billing' };
  return { ok: true, used, cap, plan };
}

export async function assertClientSlotAvailable(orgId: string): Promise<QuotaResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (!org) return { ok: false, reason: 'Organization not found' };
  const { plan, known } = resolvePlan(org.plan);
  if (!known) return unknownPlanPass(orgId, org.plan, plan);
  const cap = PLAN_LIMITS[plan].maxClients;
  const used = await db.client.count({ where: { orgId } });
  if (used >= cap) return { ok: false, reason: `Client cap reached (${used}/${cap})`, used, cap, plan, upgradeUrl: '/billing' };
  return { ok: true, used, cap, plan };
}

// A plan string we do not recognise passes the check and says so once, so the
// gap shows up in logs instead of as a mystery 402 for a customer.
function unknownPlanPass(orgId: string, raw: string | null | undefined, fallback: PlanTier): QuotaResult {
  console.warn(`[plan-caps] unknown plan "${raw}" org=${orgId} check=skipped fallback=${fallback}`);
  return { ok: true, plan: fallback };
}

// ---------------------------------------------------------------------------
// Enforcement layer
// ---------------------------------------------------------------------------
//
// The caps above sell real limits on the Billing page but had zero call sites,
// so nothing was ever enforced. Turning them on blind is not safe either: the
// live org sits at 19/20 clients and 62/100 monthly videos, so a bad boundary
// would block paid work the same hour it deploys.
//
// So enforcement is behind BILLING_ENFORCE=1 and defaults OFF. The check still
// RUNS with the flag off and prints one warn line per breach naming the org,
// the cap, the usage and the action it would have blocked. Grep those lines for
// a week, confirm the blast radius, then flip the flag.

export type CapKind = 'clients' | 'seats' | 'ai.text' | 'ai.image' | 'ai.video';

export interface CapDecision {
  allowed: boolean;      // may the route proceed
  wouldBlock: boolean;   // was the cap actually exceeded
  enforced: boolean;     // was BILLING_ENFORCE=1 at decision time
  reason?: string;
  used?: number;
  cap?: number;
  plan?: PlanTier;
  upgradeUrl?: string;
}

export function billingEnforceEnabled(): boolean {
  return process.env.BILLING_ENFORCE === '1';
}

async function evaluateCap(orgId: string, kind: CapKind): Promise<QuotaResult> {
  if (kind === 'clients') return assertClientSlotAvailable(orgId);
  if (kind === 'seats') return assertSeatAvailable(orgId);
  return enforceQuota(orgId, kind);
}

// One call, one answer. `action` is the thing being attempted, and it is what
// the warn line names so the log reads like a decision instead of a metric.
export async function checkCap(orgId: string, kind: CapKind, action: string = kind): Promise<CapDecision> {
  const enforced = billingEnforceEnabled();

  let result: QuotaResult;
  try {
    result = await evaluateCap(orgId, kind);
  } catch (err) {
    // A cap check must never be why a request 500s. Fail open, loudly.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[plan-caps] check FAILED org=${orgId} cap=${kind} action=${action} error=${message}`);
    return { allowed: true, wouldBlock: false, enforced };
  }

  if (result.ok) {
    return { allowed: true, wouldBlock: false, enforced, used: result.used, cap: result.cap, plan: result.plan };
  }

  // Single greppable line: who, which cap, where they stand, what was attempted.
  console.warn(
    `[plan-caps] ${enforced ? 'BLOCKED' : 'WOULD BLOCK'} org=${orgId} plan=${result.plan ?? 'unknown'} ` +
    `cap=${kind} used=${result.used ?? '?'}/${result.cap ?? '?'} action=${action} enforce=${enforced ? '1' : '0'}`
  );

  return {
    allowed: !enforced,
    wouldBlock: true,
    enforced,
    reason: result.reason,
    used: result.used,
    cap: result.cap,
    plan: result.plan,
    upgradeUrl: result.upgradeUrl ?? '/billing',
  };
}

// Fastify preHandler factory so a route wires a cap in one line:
//   app.post('/', { preHandler: capGuard('clients', 'client.create') }, handler)
// Sends 402 with the upgrade URL only when BILLING_ENFORCE=1; otherwise the
// request continues and the breach is recorded in the log.
export function capGuard(kind: CapKind, action?: string) {
  return async function planCapGuard(request: FastifyRequest, reply: FastifyReply) {
    const orgId = request.orgId;
    if (!orgId) return; // authGuard owns the 401/403, not this hook

    const decision = await checkCap(orgId, kind, action ?? kind);
    if (decision.allowed) return;

    return reply.status(402).send({
      error: decision.reason ?? 'Plan limit reached',
      code: 'PLAN_LIMIT_REACHED',
      cap: kind,
      used: decision.used,
      limit: decision.cap,
      plan: decision.plan,
      upgradeUrl: decision.upgradeUrl ?? '/billing',
    });
  };
}
