/**
 * F2 Post scheduler — BullMQ repeating worker that auto-publishes
 * CalendarPost rows when their scheduledAt deadline arrives.
 *
 * Spec: docs/radix-v2-ultimate-spec.md §2.
 *
 * How it works:
 *   1. Single repeating job 'scheduler-tick' fires every 60s.
 *   2. Each tick queries  CalendarPost where status='scheduled'
 *      AND scheduledAt <= now+60s.
 *   3. For each candidate the worker takes a Redis SETNX lock keyed
 *      `sched:<postId>:<scheduledAt.toISOString()>` with TTL 3600s. A 0
 *      reply means a sibling tick (or a restarted worker) already claimed
 *      the slot — skip.
 *   4. On a fresh claim the worker resolves the PlatformConnection and
 *      calls dispatchPublish(post, conn) (the same function the manual
 *      /api/calendar-posts/:id/publish path uses).
 *   5. On success the post is set to 'published' (dispatchPublish handles
 *      the per-platform JSON write). On failure status='failed' +
 *      scheduleError=<msg>. Either way an audit log is written.
 *
 * Kill switch:
 *   SCHEDULER_DISABLED=true short-circuits startSchedulerWorker(). Nothing
 *   else changes — the queue is not even instantiated, so a halted worker
 *   does not consume Redis connections.
 *
 * Single-worker assumption:
 *   We assume one app instance is running the scheduler. If we ever scale
 *   horizontally the SETNX lock keeps double-publish off the table, but
 *   we should add a Redlock around the candidate query too.
 */
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { systemDb } from '../db/prisma.js';
import { dispatchPublish } from '../lib/publish-dispatch.js';
import { auditService } from '../services/audit.service.js';

type Redis = InstanceType<typeof IORedis>;

const QUEUE_NAME = 'radix-scheduler';
const TICK_JOB_NAME = 'scheduler-tick';
const TICK_EVERY_MS = 60_000;
const LOCK_TTL_SEC = 3600; // 1 hour
const LOOKAHEAD_MS = 60_000; // pick up posts due in the next minute

let started = false;
let queue: Queue | null = null;
let worker: Worker | null = null;
let redis: Redis | null = null;

export function startSchedulerWorker(): void {
  if (started) return;

  if (process.env.SCHEDULER_DISABLED === 'true') {
    console.log('[scheduler] SCHEDULER_DISABLED=true — worker not started');
    started = true;
    return;
  }

  // Redis connections for BullMQ must use maxRetriesPerRequest=null and
  // enableReadyCheck=false; otherwise BullMQ throws on startup.
  const makeClient = (): Redis => {
    const client = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    // Without an 'error' listener, a 1-second Redis blip (e.g. apt restarting
    // redis-server) floods the log with unhandled AggregateError stack dumps.
    client.on('error', (err) => {
      console.error('[scheduler] redis connection error:', err?.message ?? err);
    });
    return client;
  };

  // Shared Redis client used for SETNX idempotency locks (NOT shared with
  // BullMQ's internal connections — BullMQ owns its own).
  redis = makeClient();

  // BullMQ requires a connection factory or instance. Passing the env URL
  // through an IORedis instance keeps options consistent.
  queue = new Queue(QUEUE_NAME, { connection: makeClient() });
  worker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name !== TICK_JOB_NAME) return;
    await runTick();
  }, { connection: makeClient() });

  worker.on('failed', (job, err) => {
    console.error(`[scheduler] tick failed (job=${job?.id}):`, err?.message);
  });

  // Repeating job — every TICK_EVERY_MS. The repeat key is stable so we
  // don't multiply the schedule on each restart.
  // Fire-and-forget; queue.add() returns a promise that resolves once the
  // job descriptor is enqueued.
  void queue.add(
    TICK_JOB_NAME,
    {},
    {
      repeat: { every: TICK_EVERY_MS },
      removeOnComplete: 50,
      removeOnFail: 50,
      jobId: 'scheduler-tick-repeater', // stable id prevents dupes
    },
  ).catch((err) => {
    console.error('[scheduler] failed to register repeating tick job:', err?.message);
  });

  started = true;
  console.log(`[scheduler] started — queue=${QUEUE_NAME}, tick=${TICK_EVERY_MS}ms, lookahead=${LOOKAHEAD_MS}ms`);
}

/**
 * One tick: find due posts, lock them via SETNX, dispatch.
 */
async function runTick(): Promise<void> {
  if (!redis) return;

  const horizon = new Date(Date.now() + LOOKAHEAD_MS);
  let candidates: Array<{
    id: string;
    orgId: string;
    calendarMonthId: string;
    platform: string;
    caption: string;
    hashtags: any;
    scheduledAt: Date;
    platformConnectionId: string | null;
  }>;
  try {
    // PERF-1: collapse the per-candidate N+1 (was: 1 findMany + per-row
    // {calendarMonth.findUnique, platformConnection.findFirst,
    // calendarPostAsset.findFirst, 1-2 updates} = ~6 sequential queries
    // each × 50 candidates = ~300 queries inside a 60s tick) into ONE
    // findMany with includes that pull the only fields the processOne
    // happy path needs. Fallback connection lookup (legacy posts without
    // platformConnectionId) still runs one extra query when triggered.
    candidates = await (systemDb as any).calendarPost.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: horizon, not: null },
      },
      select: {
        id: true,
        orgId: true,
        calendarMonthId: true,
        platform: true,
        caption: true,
        hashtags: true,
        scheduledAt: true,
        platformConnectionId: true,
        calendarMonth: { select: { clientId: true } },
        platformConnection: true,
        assets: { include: { asset: true }, take: 1 },
      },
      take: 200, // raised from 50 — silent drop under burst load
    });
  } catch (err: any) {
    // Table/columns may not be migrated yet — log once, don't crash.
    console.warn('[scheduler] candidate query failed:', err?.message?.slice(0, 200));
    return;
  }

  if (candidates.length === 0) return;

  for (const post of candidates) {
    if (!post.scheduledAt) continue;
    const key = `sched:${post.id}:${post.scheduledAt.toISOString()}`;

    // SETNX with EX — atomic claim. SET key 1 EX 3600 NX returns 'OK'
    // when the key was set, null when it already existed.
    const claimed = await redis.set(key, '1', 'EX', LOCK_TTL_SEC, 'NX');
    if (claimed !== 'OK') {
      // Already handled by a sibling tick / restart. Skip silently.
      continue;
    }

    await processOne(post).catch((err) => {
      console.error(`[scheduler] processOne(${post.id}) crashed:`, err?.message);
    });
  }
}

async function processOne(post: {
  id: string;
  orgId: string;
  calendarMonthId: string;
  platform: string;
  caption: string;
  hashtags: any;
  scheduledAt: Date;
  platformConnectionId: string | null;
  // PERF-1: pre-joined by the candidate findMany so we skip 3 lookups.
  calendarMonth?: { clientId: string } | null;
  platformConnection?: any | null;
  assets?: { asset: { fileUrl: string } | null }[];
}): Promise<void> {
  const clientId = post.calendarMonth?.clientId ?? null;

  // Prefer the pre-loaded FK connection. Only fall back to a query when the
  // post has no platformConnectionId AND we have a clientId — covers legacy
  // posts created before the FK column existed.
  let conn: any = post.platformConnection ?? null;
  if (!conn && !post.platformConnectionId && clientId) {
    conn = await systemDb.platformConnection.findFirst({
      where: { orgId: post.orgId, clientId, platform: post.platform, status: 'connected' },
    });
  }

  if (!conn) {
    const msg = `No connected ${post.platform} account for this post`;
    await systemDb.calendarPost.update({
      where: { id: post.id },
      data: { status: 'failed', scheduleError: msg } as any,
    });
    await auditService.log({
      orgId: post.orgId,
      clientId: clientId ?? undefined,
      action: 'scheduler.publish',
      entityType: 'CalendarPost',
      entityId: post.id,
      payload: { postId: post.id, platform: post.platform, error: msg },
    });
    return;
  }

  // Asset is pre-loaded from the candidate query (take: 1).
  const assetUrl = post.assets?.[0]?.asset?.fileUrl;
  if (!assetUrl) {
    const msg = 'Post has no attached image asset';
    await systemDb.calendarPost.update({
      where: { id: post.id },
      data: { status: 'failed', scheduleError: msg } as any,
    });
    await auditService.log({
      orgId: post.orgId,
      clientId: clientId ?? undefined,
      action: 'scheduler.publish',
      entityType: 'CalendarPost',
      entityId: post.id,
      payload: { postId: post.id, platform: post.platform, error: msg },
    });
    return;
  }

  const result = await dispatchPublish(
    { id: post.id, caption: post.caption, hashtags: post.hashtags, assetUrl },
    conn,
  );

  if (result.success) {
    // dispatchPublish already set status='published' on success. Clear any
    // stale schedule error.
    await systemDb.calendarPost.update({
      where: { id: post.id },
      data: { scheduleError: null } as any,
    });
    await auditService.log({
      orgId: post.orgId,
      clientId: clientId ?? undefined,
      action: 'scheduler.publish',
      entityType: 'CalendarPost',
      entityId: post.id,
      payload: {
        postId: post.id,
        platform: post.platform,
        externalId: result.externalId,
        url: result.url,
      },
    });
  } else {
    await systemDb.calendarPost.update({
      where: { id: post.id },
      data: { status: 'failed', scheduleError: result.error ?? 'unknown error' } as any,
    });
    await auditService.log({
      orgId: post.orgId,
      clientId: clientId ?? undefined,
      action: 'scheduler.publish',
      entityType: 'CalendarPost',
      entityId: post.id,
      payload: { postId: post.id, platform: post.platform, error: result.error },
    });
  }
}

/**
 * Graceful shutdown — exposed for tests and SIGTERM handlers.
 */
export async function stopSchedulerWorker(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await redis?.quit();
  worker = null;
  queue = null;
  redis = null;
  started = false;
}
