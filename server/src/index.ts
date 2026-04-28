import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { reconcileStaleJobs, shutdownQueue } from './workers/queue.js';
import { attachJobSockets } from './sockets/jobs.js';
import { errMsg } from './lib/err.js';
import { db } from './db/prisma.js';

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
const queueMode = process.env.DISABLE_BULLMQ === '1' ? 'in-memory (desktop)' : 'bullmq+redis';
console.log(`Radix server running on http://localhost:${env.PORT} (queue: ${queueMode})`);

// First-launch seed for desktop mode — Electron's main.cjs sets RADIX_AUTOSEED=1
// only when the SQLite db file didn't exist at boot, so this runs ONCE per install.
// Creates the demo-admin user so the shareable installer works out of the box.
if (process.env.RADIX_AUTOSEED === '1' && process.env.DB_TARGET === 'sqlite') {
  try {
    const passwordHash = await bcrypt.hash('demoAdmin2026!', 12);
    await db.user.upsert({
      where: { email: 'demo-admin@radix.local' },
      update: {},
      create: { email: 'demo-admin@radix.local', name: 'Demo Admin', passwordHash, role: 'admin' },
    });
    console.log('[radix] auto-seeded demo-admin (first launch)');
  } catch (err: unknown) {
    console.warn('[radix] auto-seed failed:', errMsg(err));
  }
}

// IPC handshake to Electron parent (only when forked with stdio: ['inherit','inherit','inherit','ipc']).
// Tells the parent the server is bound and ready to accept connections.
if (typeof process.send === 'function') {
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : env.PORT;
  process.send({ type: 'radix:ready', port: boundPort });
}
