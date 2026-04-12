import Fastify from 'fastify';
import cors from '@fastify/cors';
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

import { execSync } from 'child_process';

const GIT_COMMIT = (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();

export async function buildApp() {
  const app = Fastify({ logger: true });

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

  // Plugins
  await app.register(cors, { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: path.resolve(process.cwd(), 'uploads'), prefix: '/uploads/', decorateReply: false });

  const PROCESS_START = new Date().toISOString();

  // Health check (public)
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'radix-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

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
        DATABASE_URL: fingerprint('DATABASE_URL'),
      },
      routing: {
        AI_TEXT_PRIMARY: process.env.AI_TEXT_PRIMARY || 'xai',
        AI_IMAGE_PRIMARY: process.env.AI_IMAGE_PRIMARY || 'xai',
        AI_VIDEO_PRIMARY: process.env.AI_VIDEO_PRIMARY || 'xai',
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

  return app;
}
