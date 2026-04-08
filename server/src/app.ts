import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'radix-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // Auth routes
  await app.register(authRoutes, { prefix: '/api/auth' });

  return app;
}
