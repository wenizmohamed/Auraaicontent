import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Simple in-memory rate limiter — no external deps.
// Tracks request counts per IP with a sliding window.
// For production: replace with @fastify/rate-limit backed by Redis.

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // per window per IP
const AI_MAX_REQUESTS = 30; // stricter for AI generation routes

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 300_000);

function getClientIp(request: FastifyRequest): string {
  return (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || request.ip
    || 'unknown';
}

function checkLimit(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count++;

  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * Register rate limiting as a Fastify hook.
 * AI routes (/api/creative/*, /api/assistant/*, /api/research, /api/design/*)
 * get a stricter limit. Everything else gets the standard limit.
 */
export function registerRateLimiter(app: FastifyInstance) {
  const AI_PREFIXES = ['/api/creative/', '/api/assistant/', '/api/research', '/api/design/'];

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip health checks
    if (request.url === '/api/health') return;

    const ip = getClientIp(request);
    const isAiRoute = AI_PREFIXES.some(p => request.url.startsWith(p));
    const max = isAiRoute ? AI_MAX_REQUESTS : MAX_REQUESTS;
    const key = isAiRoute ? `ai:${ip}` : `std:${ip}`;

    const { allowed, remaining, resetAt } = checkLimit(key, max);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (!allowed) {
      return reply.status(429).send({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      });
    }
  });
}
