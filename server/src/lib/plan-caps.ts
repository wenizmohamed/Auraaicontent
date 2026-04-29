// Plan-tier enforcement. Caps are per calendar month, evaluated by counting
// UsageEvent rows for the org since the start of the current billing period
// (calendar month for now; real-world: subscription anchor day).
//
// Returns 402 Payment Required from routes when the org is over its cap.
// Trial plans get the same caps as Studio so prospects can stress-test.

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

export interface QuotaResult {
  ok: boolean;
  reason?: string;
  used?: number;
  cap?: number;
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

  const plan = (org.plan as PlanTier) || 'trial';
  const field = KIND_TO_FIELD[kind];
  if (!field) return { ok: true }; // unknown kinds aren't quota-gated

  const cap = PLAN_LIMITS[plan][field] as number;
  if (cap === Infinity || cap === undefined) return { ok: true };

  const used = await db.usageEvent.count({
    where: { orgId, kind, createdAt: { gte: startOfPeriod() } },
  });
  if (used >= cap) {
    return {
      ok: false,
      reason: `You've used ${used}/${cap} ${kind} calls this month on the ${plan} plan.`,
      used,
      cap,
      upgradeUrl: '/billing',
    };
  }
  return { ok: true, used, cap };
}

export async function assertSeatAvailable(orgId: string): Promise<QuotaResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (!org) return { ok: false, reason: 'Organization not found' };
  const plan = (org.plan as PlanTier) || 'trial';
  const cap = PLAN_LIMITS[plan].seats;
  const used = await db.orgMembership.count({ where: { orgId } });
  if (used >= cap) return { ok: false, reason: `Seat cap reached (${used}/${cap})`, used, cap, upgradeUrl: '/billing' };
  return { ok: true, used, cap };
}

export async function assertClientSlotAvailable(orgId: string): Promise<QuotaResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (!org) return { ok: false, reason: 'Organization not found' };
  const plan = (org.plan as PlanTier) || 'trial';
  const cap = PLAN_LIMITS[plan].maxClients;
  const used = await db.client.count({ where: { orgId } });
  if (used >= cap) return { ok: false, reason: `Client cap reached (${used}/${cap})`, used, cap, upgradeUrl: '/billing' };
  return { ok: true, used, cap };
}
