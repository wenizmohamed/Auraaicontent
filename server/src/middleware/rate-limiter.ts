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
const AI_MAX_REQUESTS = 30; // AI generation routes
const AGENT_MAX_REQUESTS = 20; // agent runs burn $0.50+ each — keep tighter
const AUTH_MAX_REQUESTS = 10; // login / register brute-force defense

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
  // Auth is login/register brute-force territory; agent runs burn real money.
  // Both get their own stricter bucket separate from the generic AI pool.
  const AUTH_PREFIXES = ['/api/auth/login', '/api/auth/register'];
  const AGENT_PREFIXES = ['/api/agent/runs', '/api/agent/sessions'];

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip health checks
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

    const { allowed, remaining, resetAt } = checkLimit(`${keyPrefix}:${ip}`, max);

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
