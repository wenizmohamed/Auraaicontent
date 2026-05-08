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

  // ── Finance-grade visibility helpers ─────────────────────────────────
  // Shared date-range parser. `from` defaults to first-of-current-month UTC,
  // `to` defaults to now. Returns 400 via a thrown sentinel if either is
  // present-but-invalid; callers translate the sentinel to a reply.
  function parseRange(q: any, defaultDays?: number): { from: Date; to: Date } {
    const now = new Date();
    let from: Date;
    let to: Date;

    if (q?.to) {
      const t = new Date(String(q.to));
      if (Number.isNaN(t.getTime())) throw new Error('BAD_TO');
      to = t;
    } else {
      to = now;
    }

    if (q?.from) {
      const f = new Date(String(q.from));
      if (Number.isNaN(f.getTime())) throw new Error('BAD_FROM');
      from = f;
    } else if (defaultDays && defaultDays > 0) {
      from = new Date(now.getTime() - defaultDays * 24 * 60 * 60 * 1000);
    } else {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }
    return { from, to };
  }

  function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // 1. GET /api/admin/usage/by-user — per-user totals + per-kind breakdown
  app.get<{ Querystring: { orgId?: string; from?: string; to?: string } }>(
    '/usage/by-user',
    async (request, reply) => {
      const { orgId } = request.query;
      if (!orgId) return reply.status(400).send({ error: 'orgId required' });
      let from: Date, to: Date;
      try { ({ from, to } = parseRange(request.query)); }
      catch (e: any) { return reply.status(400).send({ error: `Invalid ${e.message === 'BAD_FROM' ? 'from' : 'to'} date` }); }

      // Totals per user (raw — Prisma's groupBy on a nullable userId joined to User
      // is awkward; raw SQL is cleaner and lets us LEFT JOIN User in one shot).
      const totals = await db.$queryRaw<Array<{
        userId: string | null; userEmail: string | null; userName: string | null;
        calls: bigint; units: bigint; costUsd: any;
      }>>`
        SELECT u."userId"                        AS "userId",
               usr.email                          AS "userEmail",
               usr.name                           AS "userName",
               COUNT(*)::bigint                   AS calls,
               COALESCE(SUM(u.units), 0)::bigint  AS units,
               COALESCE(SUM(u."costUsd"), 0)      AS "costUsd"
        FROM "UsageEvent" u
        LEFT JOIN "User" usr ON usr.id = u."userId"
        WHERE u."orgId" = ${orgId}
          AND u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
        GROUP BY u."userId", usr.email, usr.name
        ORDER BY "costUsd" DESC
      `;

      // Per-(user,kind) breakdown.
      const breakdown = await db.$queryRaw<Array<{
        userId: string | null; kind: string;
        calls: bigint; units: bigint; costUsd: any;
      }>>`
        SELECT u."userId" AS "userId",
               u.kind     AS kind,
               COUNT(*)::bigint                   AS calls,
               COALESCE(SUM(u.units), 0)::bigint  AS units,
               COALESCE(SUM(u."costUsd"), 0)      AS "costUsd"
        FROM "UsageEvent" u
        WHERE u."orgId" = ${orgId}
          AND u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
        GROUP BY u."userId", u.kind
      `;

      const bdMap = new Map<string, Record<string, { calls: number; units: number; costUsd: number }>>();
      for (const row of breakdown) {
        const key = row.userId ?? '__null__';
        const inner = bdMap.get(key) ?? {};
        inner[row.kind] = {
          calls: Number(row.calls),
          units: Number(row.units),
          costUsd: Number(row.costUsd ?? 0),
        };
        bdMap.set(key, inner);
      }

      return totals.map((r) => ({
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        calls: Number(r.calls),
        units: Number(r.units),
        costUsd: Number(r.costUsd ?? 0),
        breakdown: bdMap.get(r.userId ?? '__null__') ?? {},
      }));
    },
  );

  // 2. GET /api/admin/usage/by-day — per-day totals + per-kind cost breakdown
  app.get<{ Querystring: { orgId?: string; from?: string; to?: string } }>(
    '/usage/by-day',
    async (request, reply) => {
      const { orgId } = request.query;
      if (!orgId) return reply.status(400).send({ error: 'orgId required' });
      let from: Date, to: Date;
      try { ({ from, to } = parseRange(request.query, 30)); }
      catch (e: any) { return reply.status(400).send({ error: `Invalid ${e.message === 'BAD_FROM' ? 'from' : 'to'} date` }); }

      const rows = await db.$queryRaw<Array<{
        day: Date; kind: string;
        calls: bigint; units: bigint; costUsd: any;
      }>>`
        SELECT DATE_TRUNC('day', u."createdAt") AS day,
               u.kind                            AS kind,
               COUNT(*)::bigint                  AS calls,
               COALESCE(SUM(u.units), 0)::bigint AS units,
               COALESCE(SUM(u."costUsd"), 0)     AS "costUsd"
        FROM "UsageEvent" u
        WHERE u."orgId" = ${orgId}
          AND u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
        GROUP BY day, u.kind
        ORDER BY day ASC
      `;

      const byDay = new Map<string, { date: string; calls: number; units: number; costUsd: number; breakdown: Record<string, number> }>();
      for (const r of rows) {
        const date = new Date(r.day).toISOString().slice(0, 10);
        const cur = byDay.get(date) ?? { date, calls: 0, units: 0, costUsd: 0, breakdown: {} };
        const cost = Number(r.costUsd ?? 0);
        cur.calls += Number(r.calls);
        cur.units += Number(r.units);
        cur.costUsd += cost;
        cur.breakdown[r.kind] = (cur.breakdown[r.kind] || 0) + cost;
        byDay.set(date, cur);
      }
      return Array.from(byDay.values());
    },
  );

  // 3. GET /api/admin/usage/export.csv — raw rows, capped at 10k.
  app.get<{ Querystring: { orgId?: string; from?: string; to?: string } }>(
    '/usage/export.csv',
    async (request, reply) => {
      const { orgId } = request.query;
      if (!orgId) return reply.status(400).send({ error: 'orgId required' });
      let from: Date, to: Date;
      try { ({ from, to } = parseRange(request.query)); }
      catch (e: any) { return reply.status(400).send({ error: `Invalid ${e.message === 'BAD_FROM' ? 'from' : 'to'} date` }); }

      const CAP = 10000;
      const rows = await db.$queryRaw<Array<{
        createdAt: Date; userId: string | null; userEmail: string | null;
        kind: string; metadata: any; units: number; costUsd: any; ref: string | null;
      }>>`
        SELECT u."createdAt"  AS "createdAt",
               u."userId"      AS "userId",
               usr.email       AS "userEmail",
               u.kind          AS kind,
               u.metadata      AS metadata,
               u.units         AS units,
               u."costUsd"    AS "costUsd",
               u.ref           AS ref
        FROM "UsageEvent" u
        LEFT JOIN "User" usr ON usr.id = u."userId"
        WHERE u."orgId" = ${orgId}
          AND u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
        ORDER BY u."createdAt" DESC
        LIMIT ${CAP + 1}
      `;

      const truncated = rows.length > CAP;
      const data = truncated ? rows.slice(0, CAP) : rows;

      const header = 'timestamp,userId,userEmail,kind,model,units,costUsd,ref';
      const lines: string[] = [header];
      for (const r of data) {
        const model = (r.metadata && typeof r.metadata === 'object' && (r.metadata as any).model) || '';
        lines.push(
          [
            csvEscape(new Date(r.createdAt).toISOString()),
            csvEscape(r.userId),
            csvEscape(r.userEmail),
            csvEscape(r.kind),
            csvEscape(model),
            csvEscape(r.units),
            csvEscape(Number(r.costUsd ?? 0)),
            csvEscape(r.ref),
          ].join(','),
        );
      }
      if (truncated) lines.push('# truncated at 10000 rows');

      const fromTag = from.toISOString().slice(0, 10);
      const toTag = to.toISOString().slice(0, 10);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="usage-${orgId}-${fromTag}-${toTag}.csv"`);
      return lines.join('\n');
    },
  );

  // 4. GET /api/admin/audit-log — recent audit rows with user email join
  app.get<{
    Querystring: {
      orgId?: string; userId?: string; action?: string;
      from?: string; to?: string; limit?: string;
    };
  }>('/audit-log', async (request, reply) => {
    const { orgId, userId, action } = request.query;
    if (!orgId) return reply.status(400).send({ error: 'orgId required' });
    let from: Date, to: Date;
    try { ({ from, to } = parseRange(request.query)); }
    catch (e: any) { return reply.status(400).send({ error: `Invalid ${e.message === 'BAD_FROM' ? 'from' : 'to'} date` }); }

    const lim = Math.min(1000, Math.max(1, Number(request.query.limit ?? 100) || 100));

    // Optional filters as parameter-bound NULL-safe predicates.
    const rows = await db.$queryRaw<Array<{
      id: string; orgId: string; userId: string | null; userEmail: string | null;
      clientId: string | null; action: string; entityType: string;
      entityId: string | null; payload: any; createdAt: Date;
    }>>`
      SELECT a.id              AS id,
             a."orgId"          AS "orgId",
             a."userId"         AS "userId",
             usr.email          AS "userEmail",
             a."clientId"       AS "clientId",
             a.action           AS action,
             a."entityType"     AS "entityType",
             a."entityId"       AS "entityId",
             a.payload          AS payload,
             a."createdAt"      AS "createdAt"
      FROM "AuditLog" a
      LEFT JOIN "User" usr ON usr.id = a."userId"
      WHERE a."orgId" = ${orgId}
        AND a."createdAt" >= ${from}
        AND a."createdAt" <= ${to}
        AND (${userId ?? null}::text IS NULL OR a."userId" = ${userId ?? null}::text)
        AND (${action ?? null}::text IS NULL OR a.action = ${action ?? null}::text)
      ORDER BY a."createdAt" DESC
      LIMIT ${lim}
    `;
    return rows;
  });

  // 5. GET /api/admin/usage/totals — global rollup with kind/provider/model splits
  app.get<{ Querystring: { orgId?: string; from?: string; to?: string } }>(
    '/usage/totals',
    async (request, reply) => {
      const { orgId } = request.query;
      let from: Date, to: Date;
      try { ({ from, to } = parseRange(request.query)); }
      catch (e: any) { return reply.status(400).send({ error: `Invalid ${e.message === 'BAD_FROM' ? 'from' : 'to'} date` }); }

      // Top-line totals + per-kind breakdown.
      const kindRows = await db.$queryRaw<Array<{
        kind: string; calls: bigint; units: bigint; costUsd: any;
      }>>`
        SELECT u.kind                            AS kind,
               COUNT(*)::bigint                  AS calls,
               COALESCE(SUM(u.units), 0)::bigint AS units,
               COALESCE(SUM(u."costUsd"), 0)     AS "costUsd"
        FROM "UsageEvent" u
        WHERE u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
          AND (${orgId ?? null}::text IS NULL OR u."orgId" = ${orgId ?? null}::text)
        GROUP BY u.kind
      `;

      let calls = 0, units = 0, costUsd = 0;
      const byKind: Record<string, { calls: number; units: number; costUsd: number }> = {};
      for (const r of kindRows) {
        const c = Number(r.calls), un = Number(r.units), co = Number(r.costUsd ?? 0);
        calls += c; units += un; costUsd += co;
        byKind[r.kind] = { calls: c, units: un, costUsd: co };
      }

      // Per-model + per-provider via metadata->>'model'. We pull raw model strings
      // and bucket provider in JS so we don't lock ourselves to a hardcoded list.
      const modelRows = await db.$queryRaw<Array<{
        model: string | null; calls: bigint; costUsd: any;
      }>>`
        SELECT (u.metadata->>'model') AS model,
               COUNT(*)::bigint        AS calls,
               COALESCE(SUM(u."costUsd"), 0) AS "costUsd"
        FROM "UsageEvent" u
        WHERE u."createdAt" >= ${from}
          AND u."createdAt" <= ${to}
          AND (${orgId ?? null}::text IS NULL OR u."orgId" = ${orgId ?? null}::text)
          AND u.metadata ? 'model'
        GROUP BY (u.metadata->>'model')
        ORDER BY "costUsd" DESC
      `;

      function providerOf(model: string): string {
        const m = model.toLowerCase();
        if (m.startsWith('gemini') || m.startsWith('imagen') || m.startsWith('veo')) return 'gemini';
        if (m.startsWith('grok') || m.startsWith('xai-') || m.startsWith('x-ai')) return 'xai';
        if (m.startsWith('kimi') || m.startsWith('moonshot')) return 'kimi';
        if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('openai')) return 'openai';
        if (m.startsWith('claude') || m.startsWith('anthropic')) return 'anthropic';
        return 'other';
      }

      const byProvider: Record<string, { calls: number; costUsd: number }> = {};
      const topModels: Array<{ model: string; calls: number; costUsd: number }> = [];
      for (const r of modelRows) {
        if (!r.model) continue;
        const c = Number(r.calls), co = Number(r.costUsd ?? 0);
        topModels.push({ model: r.model, calls: c, costUsd: co });
        const p = providerOf(r.model);
        const cur = byProvider[p] ?? { calls: 0, costUsd: 0 };
        cur.calls += c; cur.costUsd += co;
        byProvider[p] = cur;
      }

      return {
        calls,
        units,
        costUsd,
        byKind,
        byProvider,
        topModels: topModels.slice(0, 20),
      };
    },
  );
}
