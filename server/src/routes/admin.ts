// Cross-org admin dashboard. Gated on STAFF_EMAILS (comma-separated env list)
// — only Radix internal staff can see other orgs' data. Used to monitor MRR,
// active orgs, AI cost per org, and gross margin per org.
//
// Returns aggregate-only data (no per-row PII like calendar contents).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';

function staffEmails(): Set<string> {
  return new Set((process.env.STAFF_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

async function staffGuard(request: FastifyRequest, reply: FastifyReply) {
  const allowed = staffEmails();
  if (allowed.size === 0) {
    return reply.status(503).send({ error: 'Admin not enabled (set STAFF_EMAILS in env)' });
  }
  const email = request.user?.email;
  if (!email || !allowed.has(email)) {
    return reply.status(403).send({ error: 'Staff only' });
  }
}

const PLAN_PRICES: Record<string, number> = {
  starter: 49,
  studio: 149,
  agency: 399,
  trial: 0,
  free: 0,
};

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);
  app.addHook('preHandler', staffGuard);

  // GET /api/admin/orgs — list all orgs with key metrics
  app.get('/orgs', async () => {
    const orgs = await db.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { memberships: true, clients: true, calendarMonths: true } },
      },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: o.plan,
      status: o.status,
      stripeCustomerId: o.stripeCustomerId,
      createdAt: o.createdAt,
      seats: o._count.memberships,
      clients: o._count.clients,
      calendars: o._count.calendarMonths,
      mrr: PLAN_PRICES[o.plan] ?? 0,
    }));
  });

  // GET /api/admin/metrics — top-line numbers for the investor screenshot
  app.get('/metrics', async () => {
    const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    const orgs = await db.organization.findMany({ select: { plan: true, status: true } });

    let mrr = 0;
    const byPlan: Record<string, number> = {};
    for (const o of orgs) {
      if (o.status !== 'active') continue;
      const price = PLAN_PRICES[o.plan] ?? 0;
      mrr += price;
      byPlan[o.plan] = (byPlan[o.plan] || 0) + 1;
    }

    const [paidOrgs, trialOrgs, totalSeats, monthAiCostAgg] = await Promise.all([
      db.organization.count({ where: { plan: { in: ['starter', 'studio', 'agency'] }, status: 'active' } }),
      db.organization.count({ where: { plan: 'trial' } }),
      db.orgMembership.count(),
      db.usageEvent.aggregate({
        // Cross-org aggregate is intentional here (staff dashboard).
        // `orgId: undefined` is the explicit opt-out for the tenant guard:
        // the key is present in `where`, but Prisma drops the filter so the
        // query spans all orgs — exactly what we want for MRR/AI-cost totals.
        where: { orgId: undefined, createdAt: { gte: monthStart } },
        _sum: { costUsd: true, units: true },
        _count: { _all: true },
      }),
    ]);

    return {
      mrr,
      arr: mrr * 12,
      byPlan,
      paidOrgs,
      trialOrgs,
      totalSeats,
      monthAiCostUsd: Number(monthAiCostAgg._sum.costUsd ?? 0),
      monthAiTokens: Number(monthAiCostAgg._sum.units ?? 0),
      monthAiCalls: monthAiCostAgg._count._all,
      monthGrossMarginUsd: Math.max(0, mrr - Number(monthAiCostAgg._sum.costUsd ?? 0)),
    };
  });

  // GET /api/admin/orgs/:orgId/usage — per-org month-to-date usage breakdown
  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/usage', async (request) => {
    const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    const groups = await db.usageEvent.groupBy({
      by: ['kind'],
      where: { orgId: request.params.orgId, createdAt: { gte: monthStart } },
      _sum: { costUsd: true, units: true },
      _count: { _all: true },
    });
    return groups.map((g) => ({
      kind: g.kind,
      calls: g._count._all,
      units: Number(g._sum.units ?? 0),
      costUsd: Number(g._sum.costUsd ?? 0),
    }));
  });
}
