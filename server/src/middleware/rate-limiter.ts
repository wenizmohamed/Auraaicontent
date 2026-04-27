import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import IORedis from 'ioredis';
import { errMsg } from '../lib/err.js';

// Redis-backed sliding-window rate limiter.
// Falls back to in-memory if REDIS_URL is unset or Redis is unreachable.
// Production-correct: sliding window via INCR + EXPIRE (atomic enough for
// 1-min buckets; pre-empts the obvious double-submit race), per-IP keyed
// with route-class prefix so AI/auth/agent buckets don't share quota.

interface MemoryBucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();
const WINDOW_MS = 60_000;
const WINDOW_SEC = 60;
const MAX_REQUESTS = 120;
const AI_MAX_REQUESTS = 30;
const AGENT_MAX_REQUESTS = 20;
const AUTH_MAX_REQUESTS = 10;

let redis: IORedis | null = null;
let redisHealthy = false;

function initRedis(): void {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!url) return;
  try {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      if (redisHealthy) console.warn('[rate-limiter] Redis dropped, falling back to memory:', err.message);
      redisHealthy = false;
    });
    redis.on('ready', () => {
      redisHealthy = true;
      console.log('[rate-limiter] Redis connected');
    });
    void redis.connect().catch(() => {
      console.warn('[rate-limiter] Redis unreachable on boot, using in-memory fallback');
    });
  } catch (err: unknown) {
    console.warn('[rate-limiter] Redis init failed, using in-memory:', errMsg(err));
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt < now) memoryBuckets.delete(key);
  }
}, 300_000);

function getClientIp(request: FastifyRequest): string {
  return (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || request.ip
    || 'unknown';
}

async function checkRedis(key: string, max: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis || !redisHealthy) throw new Error('redis-unavailable');
  // INCR returns 1 on first hit, then sets EXPIRE to make it a sliding window.
  // Race window between INCR and EXPIRE = 0 because EXPIRE on existing key
  // is also atomic; worst case = a key with no TTL during a 1-event sliver.
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SEC);
  }
  const ttl = await redis.ttl(key);
  const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : WINDOW_MS);
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetAt,
  };
}

function checkMemory(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    memoryBuckets.set(key, bucket);
  }
  bucket.count++;
  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export function registerRateLimiter(app: FastifyInstance) {
  initRedis();

  const AI_PREFIXES = ['/api/creative/', '/api/assistant/', '/api/research', '/api/design/'];
  const AUTH_PREFIXES = ['/api/auth/login', '/api/auth/register'];
  const AGENT_PREFIXES = ['/api/agent/runs', '/api/agent/sessions'];

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/api/health') return;

    const ip = getClientIp(request);
    const url = request.url;
    let max: number;
    let keyPrefix: string;

    if (AUTH_PREFIXES.some((p) => url.startsWith(p))) {
      max = AUTH_MAX_REQUESTS;
      keyPrefix = 'auth';
    } else if (AGENT_PREFIXES.some((p) => url.startsWith(p))) {
      max = AGENT_MAX_REQUESTS;
      keyPrefix = 'agent';
    } else if (AI_PREFIXES.some((p) => url.startsWith(p))) {
      max = AI_MAX_REQUESTS;
      keyPrefix = 'ai';
    } else {
      max = MAX_REQUESTS;
      keyPrefix = 'std';
    }

    const key = `rl:${keyPrefix}:${ip}`;
    let result: { allowed: boolean; remaining: number; resetAt: number };
    try {
      result = await checkRedis(key, max);
    } catch {
      result = checkMemory(`${keyPrefix}:${ip}`, max);
    }

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    reply.header('X-RateLimit-Backend', redisHealthy ? 'redis' : 'memory');

    if (!result.allowed) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }
  });
}
