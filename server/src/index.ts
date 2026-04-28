import 'dotenv/config';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { reconcileStaleJobs, shutdownQueue } from './workers/queue.js';
import { attachJobSockets } from './sockets/jobs.js';
import { errMsg } from './lib/err.js';

const app = await buildApp();

// Socket.IO mounts on the same HTTP server Fastify uses. We need
// app.ready() so app.server is the live http.Server instance, not undefined.
await app.ready();
const io = attachJobSockets(app.server);
app.log.info({ path: '/socket.io' }, '[socket] job-progress namespace attached');

// Reclaim any jobs left in BullMQ active from a prior crash.
reconcileStaleJobs()
  .then(({ reconciled }: { reconciled: number }) => {
    if (reconciled > 0) console.log(`[queue] boot reconcile: ${reconciled} stale job(s) marked failed`);
  })
  .catch((err: Error) => console.warn('[queue] boot reconcile failed:', err?.message));

const shutdown = async (signal: string) => {
  console.log(`[shutdown] ${signal} received, closing socket + queue + HTTP…`);
  try { io.close(); } catch (err: unknown) { console.warn('[shutdown] io.close failed:', errMsg(err)); }
  await shutdownQueue();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Radix server running on http://localhost:${env.PORT} (queue: bullmq+redis)`);

// IPC handshake to Electron parent (only when forked with stdio: ['inherit','inherit','inherit','ipc']).
// Tells the parent the server is bound and ready to accept connections.
if (typeof process.send === 'function') {
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : env.PORT;
  process.send({ type: 'radix:ready', port: boundPort });
}
