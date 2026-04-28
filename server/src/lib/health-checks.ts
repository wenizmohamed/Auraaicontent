// Health-endpoint quantitative checks (O3 acceptance).
//
// Thresholds locked to docs/deployment-acceptance.md so the doc and
// the runtime stay in sync. Bumping these is a deliberate edit, not
// drift — keep them visible.
import { db } from '../db/prisma.js';

const DB_CHECK_TIMEOUT_MS = 500;
const REDIS_CHECK_TIMEOUT_MS = 200;
const QUEUE_WAITING_CAP = 1000;
const QUEUE_ACTIVE_CAP = 50;
const QUEUE_STALE_MS = 5 * 60 * 1000;

export async function checkDb(): Promise<boolean> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Date.now() - start < DB_CHECK_TIMEOUT_MS;
  } catch {
    return false;
  }
}

export async function checkRedis(): Promise<boolean> {
  const start = Date.now();
  try {
    const Redis = (await import('ioredis')).default;
    const r = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: REDIS_CHECK_TIMEOUT_MS,
    });
    await r.connect();
    await r.ping();
    await r.quit();
    return Date.now() - start < REDIS_CHECK_TIMEOUT_MS * 2; // allow connect+ping
  } catch {
    return false;
  }
}

export async function checkQueueStats(): Promise<{
  waiting: number;
  active: number;
  lastCompletedAt: string | null;
  healthy: boolean;
}> {
  try {
    const { getQueueStats } = await import('../workers/queue.js');
    const stats = await getQueueStats();
    const isHealthy =
      stats.waiting < QUEUE_WAITING_CAP &&
      stats.active < QUEUE_ACTIVE_CAP &&
      (stats.lastCompletedAt === null ||
        Date.now() - stats.lastCompletedAt.getTime() < QUEUE_STALE_MS);
    return {
      waiting: stats.waiting,
      active: stats.active,
      lastCompletedAt: stats.lastCompletedAt ? stats.lastCompletedAt.toISOString() : null,
      healthy: isHealthy,
    };
  } catch {
    return { waiting: 0, active: 0, lastCompletedAt: null, healthy: false };
  }
}
