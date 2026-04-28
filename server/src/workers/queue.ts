// Job queue — BullMQ + Redis backed, with an in-memory handler registry.
// Shipped 2026-04-24 (rating P1: crash-safe job persistence).
//
// Callsite API preserved — every existing caller (createJob, getJob, updateJob,
// processJob) works without modification.  Underneath:
//   - createJob registers the Job in the local cache + BullMQ staging (pending).
//   - processJob stores the worker fn in a per-id handlers map, then enqueues
//     the job into BullMQ so the internal Worker can pick it up.  The actual
//     JS function runs in-process (closures + prisma access preserved).
//   - getJob / updateJob read/write the in-memory cache directly (sync).  Job
//     state is ALSO persisted in Redis via BullMQ so a server restart can
//     enumerate stale "active" jobs and mark them failed on boot.
//
// Tradeoff: a restart mid-job still loses the in-memory closure (the worker fn
// is gone), but we no longer silently leave callers waiting forever — the boot
// reconcile marks them failed with a clear error.

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { EventEmitter } from 'events';
import { errMsg, errStack } from '../lib/err.js';
import crypto from 'crypto';

// Job state-change emitter — sockets/jobs.ts subscribes here to push live
// updates to /socket.io rooms. Decoupled so the queue doesn't depend on the
// HTTP/socket layer; if no listener is attached, emits are no-ops.
export const jobEvents = new EventEmitter();

// Last successful job completion timestamp — read by /api/health/details O3
// gate to detect a stuck queue (no completion in > 5min while jobs waiting).
// Reset on every successful completion; never reset to null.
let lastCompletedAt: Date | null = null;

export async function getQueueStats(): Promise<{ waiting: number; active: number; lastCompletedAt: Date | null }> {
  if (!queue) return { waiting: 0, active: 0, lastCompletedAt };
  try {
    const counts = await queue.getJobCounts('waiting', 'active');
    return {
      waiting: Number(counts.waiting ?? 0),
      active: Number(counts.active ?? 0),
      lastCompletedAt,
    };
  } catch {
    return { waiting: 0, active: 0, lastCompletedAt };
  }
}
jobEvents.setMaxListeners(64);

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const QUEUE_NAME = 'radix-jobs';
const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '4', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Desktop mode (Electron-forked server with no Redis available) skips BullMQ
// entirely and runs handlers in-process via setImmediate. Single-user desktop
// has no need for queue persistence — process exit = state lost is acceptable.
const BULLMQ_DISABLED = process.env.DISABLE_BULLMQ === '1';

// BullMQ requires maxRetriesPerRequest=null so blocking commands work.
const connection = BULLMQ_DISABLED ? null : new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

if (connection) {
  connection.on('error', (err) => {
    console.error('[queue] redis connection error:', err.message);
  });
}

export interface Job {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  data: any;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

type WorkerFn = (job: Job) => Promise<any>;

// Per-process maps: the handler is the closure passed via processJob — it
// can't be serialized, so it only lives as long as the process.
const handlers = new Map<string, WorkerFn>();
const localCache = new Map<string, Job>();

// In desktop mode (BULLMQ_DISABLED) we don't construct a real queue/worker —
// processJob runs handlers in-process via setImmediate. Type the locals as
// nullable; downstream code-paths skip them when null.
const queue: Queue | null = (BULLMQ_DISABLED || !connection)
  ? null
  : new Queue(QUEUE_NAME, { connection });

// Worker picks up each queued job, looks up the handler, runs it, and
// reflects state back into localCache + BullMQ job state.
const bullWorker: Worker | null = (BULLMQ_DISABLED || !connection)
  ? null
  : new Worker(
      QUEUE_NAME,
      async (bullJob) => {
        const id = bullJob.id!;
        const fn = handlers.get(id);
        const cached = localCache.get(id);
        if (!fn || !cached) {
          // Server restarted or job registered from a different process.
          throw new Error(`No handler registered for job ${id} (type: ${bullJob.name})`);
        }

        cached.status = 'processing';
        cached.updatedAt = new Date().toISOString();
        localCache.set(id, cached);

        try {
          const result = await fn(cached);
          cached.status = 'completed';
          cached.progress = 100;
          cached.result = result;
          cached.updatedAt = new Date().toISOString();
          lastCompletedAt = new Date();
          localCache.set(id, cached);
          try { jobEvents.emit('job:update', cached); } catch {}
          handlers.delete(id);
          return result;
        } catch (err: unknown) {
          const msg = errMsg(err);
          console.error(`[JOB FAILED] ${cached.type} (${id}): ${msg}`, errStack(err) || '');
          cached.status = 'failed';
          cached.error = msg;
          cached.updatedAt = new Date().toISOString();
          localCache.set(id, cached);
          try { jobEvents.emit('job:update', cached); } catch {}
          handlers.delete(id);
          throw err;
        }
      },
      { connection, concurrency: CONCURRENCY, lockDuration: JOB_TIMEOUT_MS },
    );

bullWorker?.on('error', (err) => {
  console.error('[queue] worker error:', err.message);
});

// ─── Public API (unchanged callsite signatures) ─────────────────────

export function createJob(type: string, data: any): Job {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const job: Job = {
    id,
    type,
    status: 'queued',
    progress: 0,
    data,
    createdAt: now,
    updatedAt: now,
  };
  localCache.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return localCache.get(id);
}

export function updateJob(id: string, updates: Partial<Job>): Job | undefined {
  const job = localCache.get(id);
  if (!job) return undefined;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  localCache.set(id, job);
  // Broadcast to any Socket.IO listeners. Errors are isolated so a bad
  // listener can never break the job pipeline.
  try {
    jobEvents.emit('job:update', job);
  } catch (err: unknown) {
    console.warn('[queue] jobEvents emit failed:', errMsg(err));
  }
  return job;
}

export function processJob(id: string, worker: WorkerFn): void {
  const job = localCache.get(id);
  if (!job) return;

  handlers.set(id, worker);
  job.status = 'processing';
  job.updatedAt = new Date().toISOString();

  // Desktop mode: no Redis/BullMQ — run handler in-process via setImmediate.
  // Mirrors the Worker callback's status/result lifecycle so callers see the
  // same Job state transitions as the BullMQ path.
  if (!queue) {
    setImmediate(async () => {
      try {
        const result = await worker(job);
        job.status = 'completed';
        job.progress = 100;
        job.result = result;
        job.updatedAt = new Date().toISOString();
        lastCompletedAt = new Date();
        try { jobEvents.emit('job:update', job); } catch {}
        handlers.delete(id);
      } catch (err: unknown) {
        const msg = errMsg(err);
        console.error(`[JOB FAILED] ${job.type} (${id}): ${msg}`, errStack(err) || '');
        job.status = 'failed';
        job.error = msg;
        job.updatedAt = new Date().toISOString();
        try { jobEvents.emit('job:update', job); } catch {}
        handlers.delete(id);
      }
    });
    return;
  }

  queue
    .add(job.type, job.data, { jobId: id, removeOnComplete: 100, removeOnFail: 200 })
    .catch((err) => {
      console.error(`[queue] enqueue failed for ${id} (${job.type}):`, err?.message || err);
      job.status = 'failed';
      job.error = `Enqueue failed: ${err?.message || err}`;
      job.updatedAt = new Date().toISOString();
      handlers.delete(id);
    });
}

// Called once on server boot: any job left in BullMQ's "active" state after
// a crash is reclaimed and marked failed.  Same-process local cache is empty
// so the Worker would throw "no handler" — moveToFailed keeps Redis tidy.
export async function reconcileStaleJobs(): Promise<{ reconciled: number }> {
  if (!queue) return { reconciled: 0 };
  try {
    const active = await queue.getActive();
    let reconciled = 0;
    for (const bull of active) {
      const id = bull.id ?? 'unknown';
      try {
        await bull.moveToFailed(new Error('Server restarted mid-job'), 'boot-reconcile');
        reconciled += 1;
        console.warn(`[queue] reclaimed stale job ${id} (${bull.name})`);
      } catch {
        // Already completed or being processed — ignore.
      }
    }
    return { reconciled };
  } catch (err: unknown) {
    console.warn('[queue] stale-job reconcile failed:', errMsg(err));
    return { reconciled: 0 };
  }
}

// Graceful shutdown — close worker + queue so node exits cleanly.
export async function shutdownQueue(): Promise<void> {
  if (!bullWorker || !queue || !connection) return;
  try {
    await bullWorker.close();
    await queue.close();
    await connection.quit();
  } catch (err: unknown) {
    console.warn('[queue] shutdown error:', errMsg(err));
  }
}
