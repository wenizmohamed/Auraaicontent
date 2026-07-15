// Job queue — BullMQ + Redis (durable). Replaces the former in-memory Map so
// in-flight generations survive process restarts/deploys and can't be silently
// lost, and so N concurrent clients can't OOM the box (bounded worker
// concurrency). The PUBLIC API is preserved (createJob/processJob/updateJob +
// now-async getJob/findInflightGenerateJob/queueStats) so route/worker callers
// barely change.
//
// Safety notes for this codebase:
//  - generate-month/export/publish are NON-idempotent (they create DB rows), so
//    we set attempts:1 (no auto-retry) and maxStalledCount:0 (a job whose worker
//    died is marked FAILED, never silently re-run → no duplicate calendars). The
//    win is durable STATE (the FE always gets a real status instead of polling a
//    ghost) + graceful drain, not blind auto-resume.
//  - Worker concurrency = RADIX_JOB_CONCURRENCY (default 3): at most N heavy jobs
//    run at once; the rest wait in Redis and drain as slots free.
import { Queue, Worker, type Job as BmqJob } from 'bullmq';
import IORedis from 'ioredis';
import crypto from 'crypto';
import { env } from '../config/env.js';

const QUEUE_NAME = 'radix-jobs';
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.RADIX_JOB_CONCURRENCY || '3', 10));
const KEEP_TERMINAL_S = 60 * 60; // keep completed/failed jobs 1h (FE poll window)

// BullMQ requires maxRetriesPerRequest:null on its connections. Give the Worker
// its own blocking connection, separate from the Queue's.
const queueConn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerConn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

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

const queue = new Queue(QUEUE_NAME, {
  connection: queueConn,
  defaultJobOptions: {
    attempts: 1, // non-idempotent workers → no auto-retry
    removeOnComplete: { age: KEEP_TERMINAL_S, count: 2000 },
    removeOnFail: { age: KEEP_TERMINAL_S, count: 2000 },
  },
});

// type -> worker fn. A single BullMQ Worker consumes the queue and dispatches
// by job.name (=type). Populated lazily by processJob.
const workerRegistry = new Map<string, (job: Job) => Promise<any>>();
// Active BullMQ jobs by id, so updateJob(id,{progress}) can forward progress.
const activeBmq = new Map<string, BmqJob>();
// Data for jobs created but not yet dispatched (createJob before processJob).
const pendingData = new Map<string, { type: string; data: any }>();

let worker: Worker | null = null;
function ensureWorker(): void {
  if (worker) return;
  worker = new Worker(
    QUEUE_NAME,
    async (bmqJob: BmqJob) => {
      const fn = workerRegistry.get(bmqJob.name);
      if (!fn) throw new Error(`No worker registered for job type "${bmqJob.name}"`);
      const shim: Job = {
        id: bmqJob.id!,
        type: bmqJob.name,
        status: 'processing',
        progress: 5,
        data: bmqJob.data,
        createdAt: new Date(bmqJob.timestamp).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      activeBmq.set(bmqJob.id!, bmqJob);
      try {
        return await fn(shim);
      } finally {
        activeBmq.delete(bmqJob.id!);
      }
    },
    {
      connection: workerConn,
      concurrency: MAX_CONCURRENT,
      maxStalledCount: 0, // dead-worker job → FAILED, never re-run (non-idempotent)
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[JOB FAILED] ${job?.name} (${job?.id}): ${err?.message || err}`);
  });
  worker.on('error', (err) => { console.error(`[queue] worker error: ${err?.message || err}`); });
}

// Register a worker for a job type AT BOOT (via workers/register.ts) so that
// jobs enqueued by a PREVIOUS process — still waiting in Redis after a restart —
// get picked up immediately, instead of stranding until a same-type job is
// next dispatched. Starts the consuming Worker on first registration.
export function registerWorkerType(type: string, workerFn: (job: Job) => Promise<any>): void {
  workerRegistry.set(type, workerFn);
  ensureWorker();
}

export function createJob(type: string, data: any): Job {
  const id = crypto.randomUUID();
  pendingData.set(id, { type, data });
  return {
    id, type, status: 'queued', progress: 0, data,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

export function processJob(id: string, workerFn: (job: Job) => Promise<any>): void {
  const pending = pendingData.get(id);
  if (!pending) { console.error(`[queue] processJob(${id}) — no pending data (createJob first)`); return; }
  pendingData.delete(id);
  workerRegistry.set(pending.type, workerFn);
  ensureWorker();
  // Enqueue in Redis (durable). Fire-and-forget: the Worker picks it up
  // respecting the concurrency cap; excess jobs wait in Redis.
  queue.add(pending.type, pending.data, { jobId: id })
    .catch(err => console.error(`[queue] add failed for ${id}: ${err?.message || err}`));
}

function mapState(state: string): Job['status'] {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'processing';
  return 'queued'; // waiting | delayed | prioritized | paused | waiting-children | unknown
}

function toJob(bmqJob: BmqJob, state: string): Job {
  const status = mapState(state);
  const rawProg = typeof bmqJob.progress === 'number' ? bmqJob.progress : 0;
  return {
    id: bmqJob.id!,
    type: bmqJob.name,
    status,
    progress: status === 'completed' ? 100 : rawProg,
    data: bmqJob.data,
    result: bmqJob.returnvalue ?? undefined,
    error: bmqJob.failedReason ?? undefined,
    createdAt: new Date(bmqJob.timestamp).toISOString(),
    updatedAt: new Date(bmqJob.finishedOn || bmqJob.processedOn || bmqJob.timestamp).toISOString(),
  };
}

export async function getJob(id: string): Promise<Job | undefined> {
  const bmqJob = await queue.getJob(id);
  if (!bmqJob) return undefined;
  const state = await bmqJob.getState();
  return toJob(bmqJob, state);
}

// Only `progress` is meaningful here — status/result/error transitions are
// automatic in BullMQ (return value → result, throw → failed). Workers call
// updateJob(job.id, { progress }) throughout; we forward it to the live job.
export function updateJob(id: string, updates: Partial<Job>): void {
  if (typeof updates.progress === 'number') {
    const bmqJob = activeBmq.get(id);
    if (bmqJob) bmqJob.updateProgress(updates.progress).catch(() => { /* best-effort */ });
  }
}

// Find an in-flight generate-month job for the same clientId+month so a
// double-click doesn't start two parallel workers.
export async function findInflightGenerateJob(clientId: string, month: string): Promise<Job | undefined> {
  const inflight = await queue.getJobs(['waiting', 'active', 'delayed', 'prioritized', 'paused']);
  for (const j of inflight) {
    if (j.name !== 'generate-month') continue;
    if (j.data?.clientId === clientId && j.data?.month === month) {
      const state = await j.getState();
      return toJob(j, state);
    }
  }
  return undefined;
}

export async function queueStats(): Promise<{ running: number; pending: number; cap: number }> {
  const c = await queue.getJobCounts('waiting', 'active', 'delayed');
  return { running: c.active || 0, pending: (c.waiting || 0) + (c.delayed || 0), cap: MAX_CONCURRENT };
}

// Graceful shutdown: on SIGTERM/SIGINT (pm2 restart/deploy), stop taking new
// jobs and let active ones finish before exit — deploys no longer drop
// in-flight generations. pm2 kill_timeout must exceed the longest job.
let shuttingDown = false;
async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[queue] ${sig} — draining ${activeBmq.size} active job(s) before exit...`);
  try {
    if (worker) await worker.close(); // waits for active jobs to finish
    await queue.close();
  } catch (err: any) {
    console.error(`[queue] shutdown error: ${err?.message || err}`);
  }
  console.log('[queue] drained — exiting');
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
