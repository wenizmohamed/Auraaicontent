// Sentry init shim. Safe to call when SENTRY_DSN is unset (no-op). When
// the env var IS set, dynamically loads @sentry/node and wires the
// Fastify error handler. Activate:
//   npm install @sentry/node
//   echo 'SENTRY_DSN=https://...@sentry.io/...' >> .env
//
// Why dynamic import: keeps the dep tree light when Sentry isn't
// configured (common in dev / self-hosted installs).

import type { FastifyInstance } from 'fastify';

let initialized = false;

export async function initSentry(app: FastifyInstance): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || initialized) return;

  try {
    // Dynamic import so we don't require the package when Sentry is disabled.
    const Sentry = await import('@sentry/node' as string).catch(() => null) as any;
    if (!Sentry) {
      app.log.warn('[sentry] SENTRY_DSN set but @sentry/node not installed — skipping');
      return;
    }
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      release: process.env.RADIX_RELEASE || 'unknown',
      tracesSampleRate: 0.1,
    });

    app.setErrorHandler((err: any, request, reply) => {
      Sentry.withScope((scope: any) => {
        scope.setTag('route', request.routeOptions?.url || request.url);
        scope.setUser({ id: request.user?.userId, email: request.user?.email });
        scope.setContext('org', { orgId: request.orgId });
        Sentry.captureException(err);
      });
      app.log.error(err);
      reply.status(err.statusCode || 500).send({ error: err.message || 'Internal Server Error' });
    });

    initialized = true;
    app.log.info('[sentry] error reporting enabled');
  } catch (err) {
    app.log.warn({ err }, '[sentry] init failed — continuing without error reporting');
  }
}
