import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import crypto from 'crypto';
import { authGuard } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { briefRoutes } from './routes/briefs.js';
import { calendarRoutes } from './routes/calendar.js';
import { contentPieceRoutes } from './routes/content-pieces.js';
import { jobRoutes } from './routes/jobs.js';
import { reviewRoutes } from './routes/review.js';
import { assetRoutes } from './routes/assets.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { exportRoutes } from './routes/exports.js';
import { creativeRoutes } from './routes/creative.js';
import { changelogRoutes } from './routes/changelog.js';
import { searchRoutes } from './routes/search.js';
import { galleryShareRoutes } from './routes/gallery-share.js';
import { competitorIntelRoutes } from './routes/competitor-intel.js';
import { copywritingRoutes } from './routes/copywriting.js';
import { researchRoutes } from './routes/research.js';
import { aiRoutes } from './routes/ai.js';
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
import { historyRoutes } from './routes/history.js';
import { productReferenceRoutes } from './routes/product-references.js';
import { brandKitRoutes } from './routes/brand-kit.js';
import { memoryRoutes } from './routes/memory.js';
import { startTokenHealthWorker } from './workers/tokenHealth.worker.js';
import { startSchedulerWorker } from './workers/scheduler.worker.js';
import { initJobWorkers } from './workers/register.js';
import { startGeminiModelValidator } from './services/providers/gemini-model-validator.js';
import { initSentry } from './lib/sentry.js';
import { registerRateLimiter } from './middleware/rate-limiter.js';
import { kimiStatus } from './services/providers/kimi.provider.js';
import { chainStatus, DEFAULT_CHAIN } from './services/llm/chat.js';

import { execSync } from 'child_process';

const GIT_COMMIT = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.env.GIT_COMMIT || 'unknown'; } })();

export async function buildApp() {
  // Without this, attacker-supplied X-F-F headers would spoof rate-limit IP keys.
  // bodyLimit raised to 50MB so workshop #3 (Haneen) image-to-video can ship
  // start+end frames as base64 in one JSON payload — at ~30MB/frame max this
  // covers 1080p PNGs from the browser camera/upload. Multipart route stays
  // at 25MB per individual file (helmet/multipart config below).
  const app = Fastify({ logger: true, trustProxy: 'loopback', bodyLimit: 50 * 1024 * 1024 });

  // Global error handler — strips raw destructure / parser internals in prod
  // so /api/auth/login + others return 400 instead of 500 with leaked stack.
  app.setErrorHandler((err: any, request, reply) => {
    const status = (err && typeof err.statusCode === 'number') ? err.statusCode : 500;
    const message = (err && typeof err.message === 'string') ? err.message : '';
    const isClient = status >= 400 && status < 500;
    request.log.error({ err, path: request.url }, '[error-handler]');
    if (status === 500 && /destructure|JSON|Unexpected token|Expected property/i.test(message)) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }
    if (process.env.NODE_ENV === 'production' && !isClient) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
    return reply.status(status).send({ error: message || 'Internal server error' });
  });

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
  // 50 MiB to match nginx client_max_body_size (50M) and the JSON bodyLimit.
  // Was 25 MiB → real client video reels (25-50MB) passed nginx then hit a
  // Fastify 413 (FST_REQ_FILE_TOO_LARGE) on /assets/upload.
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
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
          role: 'PRIMARY. Orchestrator, assistant, analysis, image, video',
          rank: 1,
        },
        grok: {
          configured: !!process.env.XAI_API_KEY,
          model: process.env.XAI_TEXT_MODEL || 'grok-4.6',
          baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
          role: 'fallback (text + image + video)',
          rank: 2,
        },
        kimi: { ...kimiStatus(), role: 'tertiary. Long-context (text only)', rank: 3 },
        dashscope: {
          configured: !!process.env.DASHSCOPE_API_KEY,
          textModel: process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.8-max',
          imageModel: process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro',
          baseURL: process.env.DASHSCOPE_BASE_URL || 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
          role: 'fallback (text + image). Qwen/DeepSeek/GLM/MiniMax/Kimi + Qwen/Wan image; no video',
          rank: 4,
        },
      },
    };
  });

  // Health details (auth + staff-gated) — proves runtime env is fresh.
  // Returns SHA-256 fingerprints of secret prefixes; staff-only to prevent
  // anyone from confirming a leaked-key prefix matches the live key.
  app.get('/api/health/details', { preHandler: [authGuard] }, async (request, reply) => {
    const allowed = new Set((process.env.STAFF_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean));
    const email = request.user?.email;
    if (allowed.size === 0 || !email || !allowed.has(email)) {
      return reply.status(403).send({ error: 'Staff only' });
    }
    return buildHealthDetails();
  });

  function buildHealthDetails() {
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
  }

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(clientRoutes, { prefix: '/api/clients' });
  await app.register(briefRoutes, { prefix: '/api' });
  await app.register(calendarRoutes, { prefix: '/api' });
  await app.register(contentPieceRoutes, { prefix: '/api' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });
  await app.register(reviewRoutes, { prefix: '/api' });
  await app.register(assetRoutes, { prefix: '/api' });
  await app.register(knowledgeRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
  await app.register(creativeRoutes, { prefix: '/api' });
  await app.register(changelogRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(galleryShareRoutes, { prefix: '/api' });
  await app.register(competitorIntelRoutes, { prefix: '/api' });
  await app.register(copywritingRoutes, { prefix: '/api' });
  await app.register(researchRoutes, { prefix: '/api' });
  await app.register(aiRoutes, { prefix: '/api' });
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
  await app.register(historyRoutes, { prefix: '/api' });
  await app.register(productReferenceRoutes, { prefix: '/api' });
  await app.register(brandKitRoutes, { prefix: '/api' });
  await app.register(memoryRoutes, { prefix: '/api' });

  // Boot the token-health worker — runs hourly after a 60s warmup. Refreshes
  // platform connection tokens before they expire; flips status to
  // 'needs_reauth' when refresh fails so the UI can surface a Reconnect button.
  startTokenHealthWorker();

  // Boot the F2 post scheduler — BullMQ repeating job (every 60s) polling
  // CalendarPost rows with status='scheduled' AND scheduledAt <= now+60s,
  // SETNX-locked per (postId, scheduledAt). Kill switch: SCHEDULER_DISABLED=true.
  startSchedulerWorker();

  // Register all durable job workers so BullMQ starts consuming immediately and
  // any jobs still WAITING in Redis from a previous process resume after a
  // restart (instead of stranding until the next dispatch of that type).
  initJobWorkers();

  // Validate every configured GEMINI_*_MODEL against Google's live
  // ListModels response. Loud-warns on any dead model id so the next
  // preview-deprecation surfaces in logs immediately instead of as a
  // user-visible 500. Runs daily after a 5s warmup. (RES-2, after the
  // gemini-3.1-flash-lite-preview deprecation incident.)
  startGeminiModelValidator();

  return app;
}
