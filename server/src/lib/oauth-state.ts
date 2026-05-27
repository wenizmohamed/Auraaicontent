/**
 * OAuth state-param store — CSRF protection for the authorization-code flow.
 *
 * Redis-backed (5-min TTL via SETEX, single-use via GETDEL). Survives a PM2
 * restart mid-OAuth and works under multi-process / multi-replica deploys.
 * Falls back to a per-process Map only if Redis is unreachable at module-load
 * time (dev without Redis).
 *
 * Each entry is keyed by an unguessable random token and stores the
 * destination context (orgId, clientId, platform, returnUrl). The platform
 * callback validates the state matches before exchanging the code.
 */
import { randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

interface StateEntry {
  orgId: string;
  userId: string;
  clientId: string;
  platform: string;
  returnUrl: string;
}

const TTL_SEC = 300; // 5 min
const KEY_PREFIX = 'oauth:state:';

// Lazy Redis client — first call to issueState/consumeState connects.
let redis: IORedis | null = null;
let redisDead = false;

function getRedis(): IORedis | null {
  if (redisDead) return null;
  if (redis) return redis;
  try {
    redis = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    redis.on('error', (err) => {
      console.warn('[oauth-state] redis error:', err.message);
    });
    return redis;
  } catch (err: any) {
    console.warn('[oauth-state] redis init failed; falling back to in-proc map:', err?.message);
    redisDead = true;
    return null;
  }
}

// Process-local fallback used only when Redis is down (dev).
const fallback = new Map<string, { entry: StateEntry; expiresAt: number }>();

function gcFallback(): void {
  const now = Date.now();
  for (const [k, v] of fallback) if (v.expiresAt < now) fallback.delete(k);
}

export async function issueState(payload: StateEntry): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const r = getRedis();
  if (r) {
    try {
      await r.set(`${KEY_PREFIX}${token}`, JSON.stringify(payload), 'EX', TTL_SEC);
      return token;
    } catch (err: any) {
      console.warn('[oauth-state] redis SET failed, falling back to map:', err?.message);
    }
  }
  gcFallback();
  fallback.set(token, { entry: payload, expiresAt: Date.now() + TTL_SEC * 1000 });
  return token;
}

export async function consumeState(token: string): Promise<StateEntry | null> {
  const r = getRedis();
  if (r) {
    try {
      // GETDEL = atomic read-and-delete; single-use guarantee under concurrency.
      const raw = await r.getdel(`${KEY_PREFIX}${token}`);
      if (raw) return JSON.parse(raw) as StateEntry;
    } catch (err: any) {
      console.warn('[oauth-state] redis GETDEL failed, falling back to map:', err?.message);
    }
  }
  gcFallback();
  const hit = fallback.get(token);
  if (!hit) return null;
  fallback.delete(token);
  if (hit.expiresAt < Date.now()) return null;
  return hit.entry;
}
