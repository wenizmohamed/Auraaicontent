/**
 * Per-connection OAuth refresh lock (HARD-2).
 *
 * Why: TikTok rotates its refresh_token on every refresh call. If the
 * scheduler tick and the hourly tokenHealth sweep both decide to refresh
 * the same connection concurrently, the slower writer persists a token
 * derived from an already-invalidated rotation — the connection silently
 * flips to needs_reauth despite both refresh calls returning 200. Meta
 * and LinkedIn don't rotate per-call but the lock costs nothing for them.
 *
 * SETNX with TTL is the standard distributed-lock pattern. We don't need
 * Redlock for this; one Redis instance is the source of truth and the
 * worst case if a lock holder dies mid-refresh is a 30-second wait until
 * the next eligible run.
 */
import IORedis from 'ioredis';
import { env } from '../config/env.js';

const LOCK_PREFIX = 'lock:refresh:';
const LOCK_TTL_SEC = 30;

let redis: IORedis | null = null;
let redisDead = false;

function getRedis(): IORedis | null {
  if (redisDead) return null;
  if (redis) return redis;
  try {
    redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
    redis.on('error', () => { /* surfaced once in oauth-state */ });
    return redis;
  } catch {
    redisDead = true;
    return null;
  }
}

/**
 * Acquire-and-release wrapper. Returns `null` if the lock is already held —
 * caller skips this refresh (a sibling will do it). If Redis is unavailable
 * the lock degrades to a no-op (preserves single-process correctness; only
 * loses defense against multi-process races, which is also what the v1
 * deployment looks like).
 */
export async function withRefreshLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const r = getRedis();
  if (!r) return await fn();
  const key = `${LOCK_PREFIX}${connectionId}`;
  // NX = only set if not exists; EX = TTL in seconds.
  const acquired = await r.set(key, '1', 'EX', LOCK_TTL_SEC, 'NX');
  if (acquired !== 'OK') return null;
  try {
    return await fn();
  } finally {
    // Best-effort release. If we crash before this, the TTL handles it.
    r.del(key).catch(() => {});
  }
}
