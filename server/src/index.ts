import 'dotenv/config';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { reconcileStaleJobs, shutdownQueue } from './workers/queue.js';

const app = await buildApp();

// Reclaim any jobs left in BullMQ active from a prior crash.
reconcileStaleJobs()
  .then(({ reconciled }: { reconciled: number }) => {
    if (reconciled > 0) console.log(`[queue] boot reconcile: ${reconciled} stale job(s) marked failed`);
  })
  .catch((err: Error) => console.warn('[queue] boot reconcile failed:', err?.message));

const shutdown = async (signal: string) => {
  console.log(`[shutdown] ${signal} received, closing queue + HTTP…`);
  await shutdownQueue();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Radix server running on http://localhost:${env.PORT} (queue: bullmq+redis)`);
