import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import crypto from 'crypto';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { briefRoutes } from './routes/briefs.js';
import { calendarRoutes } from './routes/calendar.js';
import { jobRoutes } from './routes/jobs.js';
import { reviewRoutes } from './routes/review.js';
import { assetRoutes } from './routes/assets.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { exportRoutes } from './routes/exports.js';
import { creativeRoutes } from './routes/creative.js';
import { researchRoutes } from './routes/research.js';
import { assistantRoutes } from './routes/assistant.js';
import { designRoutes } from './routes/design.js';
import { analyzeRoutes } from './routes/analyze.js';
import { visualRefRoutes } from './routes/visualRefs.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { agentRoutes } from './routes/agent.js';
import { billingRoutes } from './routes/billing.js';
import { adminRoutes } from './routes/admin.js';
import { orgsRoutes, invitationsRoutes } from './routes/orgs.js';
import { integrationsRoutes } from './routes/integrations.js';
import { publishRoutes } from './routes/publish.js';
import { startTokenHealthWorker } from './workers/tokenHealth.worker.js';
import { initSentry } from './lib/sentry.js';
import { registerRateLimiter } from './middleware/rate-limiter.js';
import { kimiStatus } from './services/providers/kimi.provider.js';
import { chainStatus, DEFAULT_CHAIN } from './services/llm/chat.js';

import { execSync } from 'child_process';

const GIT_COMMIT = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();

export async function buildApp() {
  const app = Fastify({ logger: true });

  // Sentry — no-op unless SENTRY_DSN + @sentry/node are configured.
  await initSentry(app);

  // Tolerate empty JSON body on DELETE — Fastify 5 throws FST_ERR_CTP_EMPTY_JSON_BODY
  // when Content-Type: application/json is sent with no body.
  // Using stream-based parser bypasses Fastify's rawBodyParser empty-body check.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', function (_req: any, payload: any, done: (err: Error | null, result?: any) => void) {
    let data = '';
    payload.on('data', (chunk: any) => { data += chunk.toString(); });
    payload.on('end', () => {
      if (!data || data.trim() === '') { done(null, undefined); return; }
      try { done(null, JSON.parse(data)); } catch (err) { done(err as Error, undefined); }
    });
    payload.on('error', (err: Error) => done(err));
  });

  // Rate limiter (before routes, after parser)
  registerRateLimiter(app);

  // Security headers — helmet sets HSTS, X-Content-Type-Options, Referrer-Policy,
  // Cross-Origin-*, and a strict CSP.  Electron renderer + browser frontend both
  // load from same origin as the backend in prod; devtools keeps the CSP lenient
  // enough for the Vite-served React app without going unsafe-inline.
  const isProd = process.env.NODE_ENV === 'production';
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inlines critical CSS in build
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // allow remote logos / avatars / BFL image CDN
        connectSrc: ["'self'", 'ws:', 'wss:', 'https:'], // Socket.IO + upstream AI provider APIs
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // loosen so uploaded assets render in <img>
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });

  // HTTP CORS — explicit allowlist, fails closed in prod (mirrors Socket.IO fix).
  // Env-driven via HTTP_CORS_ORIGINS (comma-separated).
  const corsOrigin: boolean | string[] | RegExp = (() => {
    const raw = process.env.HTTP_CORS_ORIGINS?.trim();
    if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (isProd) return []; // fail closed
    return [
      'http://127.0.0.1:3200',
      'http://localhost:3200',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'app://.',
      'file://',
    ];
  })();
  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.log.info({ corsOrigin }, '[http] CORS policy');
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: path.resolve(process.cwd(), 'uploads'), prefix: '/uploads/', decorateReply: false });

  const PROCESS_START = new Date().toISOString();

  // Root — redirect to frontend in dev, show API index in prod.
  app.get('/', async (_req, reply) => {
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3200';
    if (process.env.NODE_ENV === 'production') {
      return reply.send({
        service: 'radix-server',
        version: '1.0.0',
        docs: '/api/health',
        agent: 'POST /api/agent/runs  ·  socket.io /agent',
      });
    }
    return reply.redirect(frontend, 302);
  });

  // Health check (public)
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'radix-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // Provider matrix (public) — Gemini 3.1 Pro PRIMARY (Radix company-card
  // billing), Grok fallback, Kimi K2 tertiary.  No Claude in any form.
  // Chain enforced both at AiRouter (image/video/analysis) AND at the
  // chat-with-fallback helper (text/orchestrator/agent tools).
  app.get('/api/providers/status', async () => {
    return {
      orchestrator: process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview',
      fallbackChain: chainStatus(DEFAULT_CHAIN),
      providers: {
        gemini: {
          configured: !!process.env.GEMINI_API_KEY,
          chatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-3.1-pro-preview',
          analysisModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview',
          imageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
          videoModel: process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview',
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
          role: 'PRIMARY — orchestrator, assistant, analysis, image, video',
          rank: 1,
        },
        grok: {
          configured: !!process.env.XAI_API_KEY,
          model: process.env.XAI_TEXT_MODEL || 'grok-4.20',
          baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
          role: 'fallback (text + image + video)',
          rank: 2,
        },
        kimi: { ...kimiStatus(), role: 'tertiary — long-context (text only)', rank: 3 },
      },
    };
  });

  // Health details (auth-gated) — proves runtime env is fresh
  app.get('/api/health/details', async () => {
    const fingerprint = (key: string) => {
      const val = process.env[key] || '';
      if (!val) return 'NOT_SET';
      return crypto.createHash('sha256').update(val.slice(0, 8)).digest('hex').slice(0, 12);
    };
    return {
      status: 'ok',
      commit: GIT_COMMIT,
      processStart: PROCESS_START,
      cwd: process.cwd(),
      nodeVersion: process.version,
      envFingerprints: {
        GEMINI_API_KEY: fingerprint('GEMINI_API_KEY'),
        XAI_API_KEY: fingerprint('XAI_API_KEY'),
        MOONSHOT_API_KEY: fingerprint('MOONSHOT_API_KEY'),
        DATABASE_URL: fingerprint('DATABASE_URL'),
        JWT_SECRET: fingerprint('JWT_SECRET'),
        AGENT_MODEL: process.env.AGENT_MODEL || 'unset',
      },
      routing: {
        AI_TEXT_PRIMARY: process.env.AI_TEXT_PRIMARY || 'gemini',
        AI_IMAGE_PRIMARY: process.env.AI_IMAGE_PRIMARY || 'gemini',
        AI_VIDEO_PRIMARY: process.env.AI_VIDEO_PRIMARY || 'gemini',
        AI_ANALYSIS_PRIMARY: process.env.AI_ANALYSIS_PRIMARY || 'gemini',
        AI_ENABLE_FALLBACK: process.env.AI_ENABLE_FALLBACK || 'true',
      },
      timeouts: {
        XAI_TIMEOUT_MS: process.env.XAI_TIMEOUT_MS || '180000',
        GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS || '180000',
      },
    };
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(clientRoutes, { prefix: '/api/clients' });
  await app.register(briefRoutes, { prefix: '/api' });
  await app.register(calendarRoutes, { prefix: '/api' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });
  await app.register(reviewRoutes, { prefix: '/api' });
  await app.register(assetRoutes, { prefix: '/api' });
  await app.register(knowledgeRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
  await app.register(creativeRoutes, { prefix: '/api' });
  await app.register(researchRoutes, { prefix: '/api' });
  await app.register(assistantRoutes, { prefix: '/api' });
  await app.register(designRoutes, { prefix: '/api' });
  await app.register(analyzeRoutes, { prefix: '/api' });
  await app.register(visualRefRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(agentRoutes, { prefix: '/api/agent' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(orgsRoutes, { prefix: '/api/orgs' });
  await app.register(invitationsRoutes, { prefix: '/api/invitations' });
  await app.register(integrationsRoutes, { prefix: '/api' });
  await app.register(publishRoutes, { prefix: '/api' });

  // Boot the token-health worker — runs hourly after a 60s warmup. Refreshes
  // platform connection tokens before they expire; flips status to
  // 'needs_reauth' when refresh fails so the UI can surface a Reconnect button.
  startTokenHealthWorker();

  return app;
}
