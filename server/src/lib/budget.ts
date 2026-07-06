/**
 * Per-org AI spend gate.
 *
 * checkOrgBudget(orgId) sums UsageEvent.costUsd for the current calendar
 * month and compares against Organization.monthlyAiBudgetUsd. A budget of 0
 * means "no enforcement" (the historical default for every existing org).
 *
 * Called from ai-router.ts BEFORE a provider call fires, so an exhausted
 * org gets an explicit error instead of being charged for a successful call.
 *
 * Soft-warn at 80% is reported via the returned `warning` flag; the
 * /api/dashboard/ai-stats route surfaces it to the UI.
 */
import { db } from '../db/prisma.js';
import { env } from '../config/env.js';

export interface BudgetState {
  orgId: string;
  limit: number;        // monthly cap in USD; 0 = unlimited
  used: number;         // MTD spend in USD
  remaining: number;    // limit - used (clamped to 0); meaningless when limit=0
  percentUsed: number;  // used/limit; 0 when limit=0
  exceeded: boolean;    // true only when limit > 0 AND used >= limit
  warning: boolean;     // true when limit > 0 AND percentUsed >= 0.80
}

export async function getOrgBudgetState(orgId: string): Promise<BudgetState> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const [org, agg] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { monthlyAiBudgetUsd: true } }),
    db.usageEvent.aggregate({
      where: { orgId, kind: { startsWith: 'ai.' }, createdAt: { gte: start } },
      _sum: { costUsd: true },
    }),
  ]);

  const limit = org ? Number(org.monthlyAiBudgetUsd) : 0;
  const used = Number(agg._sum.costUsd ?? 0);
  const percentUsed = limit > 0 ? used / limit : 0;
  return {
    orgId,
    limit,
    used,
    remaining: limit > 0 ? Math.max(0, limit - used) : 0,
    percentUsed,
    exceeded: limit > 0 && used >= limit,
    warning: limit > 0 && percentUsed >= 0.80,
  };
}

export class OrgBudgetExceededError extends Error {
  readonly statusCode = 402;        // Payment Required
  readonly code = 'org_budget_exceeded';
  constructor(public readonly state: BudgetState) {
    super(
      `Org ${state.orgId} has reached its monthly AI budget ` +
      `($${state.used.toFixed(2)} / $${state.limit.toFixed(2)})`,
    );
    this.name = 'OrgBudgetExceededError';
  }
}

/**
 * Throws OrgBudgetExceededError if the org has hit its cap.
 * No-ops silently if orgId is missing or budget is 0 (unlimited).
 */
export async function assertOrgBudget(orgId?: string): Promise<BudgetState | null> {
  if (!orgId) return null;
  const state = await getOrgBudgetState(orgId);
  if (state.exceeded) throw new OrgBudgetExceededError(state);
  return state;
}

export class VideoDailyCapError extends Error {
  readonly statusCode = 402;
  readonly code = 'video_daily_cap';
  constructor(public readonly usedToday: number, public readonly cap: number) {
    super(`Daily video budget reached ($${usedToday.toFixed(2)} / $${cap.toFixed(2)}). Resets at 00:00 UTC.`);
    this.name = 'VideoDailyCapError';
  }
}

/**
 * Video-spend guardrail. Video is the dominant cost line and can 5x in a month.
 * Sums the org's ai.video spend since 00:00 UTC today; logs a WARN past the soft
 * threshold (the watchdog sentinel greps these) and — only when a HARD cap is
 * configured (>0) — throws VideoDailyCapError to stop further video gen for the
 * day. No-op when orgId absent or SOFT<=0. Call BEFORE kicking off a video gen.
 */
export async function assertVideoDailyGuardrail(orgId?: string): Promise<void> {
  if (!orgId) return;
  const soft = Number(env.VIDEO_DAILY_SOFT_USD) || 0;
  const hard = Number(env.VIDEO_DAILY_HARD_USD) || 0;
  if (soft <= 0 && hard <= 0) return;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const agg = await db.usageEvent.aggregate({
    where: { orgId, kind: 'ai.video', createdAt: { gte: start } },
    _sum: { costUsd: true },
  });
  const used = Number(agg._sum.costUsd ?? 0);
  if (hard > 0 && used >= hard) throw new VideoDailyCapError(used, hard);
  if (soft > 0 && used >= soft) {
    console.warn(`[video-guardrail] org ${orgId} video spend $${used.toFixed(2)} today ≥ soft cap $${soft.toFixed(2)}`);
  }
}
