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
    return orgs.map((o: any) => ({
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
    return groups.map((g: any) => ({
      kind: g.kind,
      calls: g._count._all,
      units: Number(g._sum.units ?? 0),
      costUsd: Number(g._sum.costUsd ?? 0),
    }));
  });

  // GET /api/admin/ops-digest — 24h ops summary for the daily Routine.
  // Reads the pm2 log files server-side (Anthropic-cloud Routines have no SSH
  // to the VPS), counts pattern matches, returns JSON ready for an email body.
  app.get('/ops-digest', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const PM2_LOG_DIR = process.env.PM2_LOG_DIR || '/root/.pm2/logs';
    const SERVICE = 'radix-api';
    const SINCE_MS = Date.now() - 24 * 60 * 60 * 1000;

    type PatternKey =
      | 'ladder_text_fail'
      | 'ladder_image_fail'
      | 'veo_safety_filtered'
      | 'json_parse_failed'
      | 'json_repair_fired'
      | 'job_failed'
      | 'http_5xx'
      | 'http_2xx';

    const patterns: Record<PatternKey, RegExp> = {
      ladder_text_fail: /\[ladder\] gemini\/text [\w.\-]+ failed/g,
      ladder_image_fail: /\[ladder\] gemini\/image [\w.\-]+ failed/g,
      veo_safety_filtered: /Veo safety-filtered/g,
      json_parse_failed: /JSON parse failed/g,
      json_repair_fired: /truncated JSON repaired/g,
      job_failed: /\[JOB FAILED\]/g,
      http_5xx: /"statusCode":5\d\d/g,
      http_2xx: /"statusCode":2\d\d/g,
    };

    const counts: Record<PatternKey, number> = Object.fromEntries(
      Object.keys(patterns).map((k) => [k, 0]),
    ) as Record<PatternKey, number>;

    async function tail(file: string, maxBytes = 2_000_000): Promise<string> {
      try {
        const fh = await fs.open(file, 'r');
        const stat = await fh.stat();
        const start = Math.max(0, Number(stat.size) - maxBytes);
        const buf = Buffer.alloc(Number(stat.size) - start);
        await fh.read(buf, 0, buf.length, start);
        await fh.close();
        return buf.toString('utf8');
      } catch {
        return '';
      }
    }

    const outLog = await tail(path.join(PM2_LOG_DIR, `${SERVICE}-out.log`));
    const errLog = await tail(path.join(PM2_LOG_DIR, `${SERVICE}-error.log`));
    const combined = outLog + '\n' + errLog;

    // Count pattern matches inside lines whose embedded "time":N is recent.
    // pm2 line-format from pino is JSON with "time":<unix-ms>; non-JSON lines
    // (provider chatter from console.warn) get scored unconditionally — they
    // tend to be timestamped by file rotation, not embedded clock.
    const lines = combined.split('\n');
    for (const line of lines) {
      const tm = line.match(/"time":(\d{13})/);
      if (tm && Number(tm[1]) < SINCE_MS) continue;
      for (const [key, re] of Object.entries(patterns)) {
        const matches = line.match(re);
        if (matches) counts[key as PatternKey] += matches.length;
      }
    }

    const totalRequests = counts.http_2xx + counts.http_5xx;
    const successRate =
      totalRequests > 0 ? Math.round((counts.http_2xx / totalRequests) * 1000) / 10 : 100;

    // Health probe of self
    const healthOk = (() => {
      try { return process.uptime() > 0; } catch { return false; }
    })();

    return {
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      health: {
        ok: healthOk,
        processUptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
      ai: {
        ladderTextFails: counts.ladder_text_fail,
        ladderImageFails: counts.ladder_image_fail,
        veoSafetyFiltered: counts.veo_safety_filtered,
        jsonParseFailed: counts.json_parse_failed,
        jsonRepairFired: counts.json_repair_fired,
        jobsFailed: counts.job_failed,
      },
      http: {
        success: counts.http_2xx,
        serverErrors: counts.http_5xx,
        successRatePct: successRate,
      },
      severity:
        counts.http_5xx > 5 || counts.job_failed > 3 || successRate < 90
          ? 'RED'
          : counts.json_repair_fired >= 5 || counts.ladder_text_fail > 20
          ? 'YELLOW'
          : 'GREEN',
      logBytesScanned: combined.length,
    };
  });
}
