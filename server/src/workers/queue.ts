// Job queue — in-memory for now, BullMQ+Redis in Phase 4
// This provides the same API surface so the migration to BullMQ is a drop-in swap

const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max per job (was 10; bumped for visual ref auto-populate headroom)

// PERF-5 eviction: completed/failed jobs older than this are deleted on
// every sweep, capping memory at roughly EVICTION_AGE_MS / job_rate. With
// PM2 --max-old-space-size=512, the unbounded map was a plausible cause
// of the 80-restart loop noted in MEMORY.md (especially when each job
// payload included base64 image data).
const EVICTION_AGE_MS = 60 * 60 * 1000; // keep completed/failed for 1h
const EVICTION_TICK_MS = 5 * 60 * 1000;
const HARD_SIZE_CAP = 5000; // emergency cap if eviction can't keep up

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

const jobs = new Map<string, Job>();

function sweep(): void {
  const cutoff = Date.now() - EVICTION_AGE_MS;
  let evicted = 0;
  for (const [id, job] of jobs) {
    if (job.status !== 'completed' && job.status !== 'failed') continue;
    if (new Date(job.updatedAt).getTime() < cutoff) {
      jobs.delete(id);
      evicted++;
    }
  }
  // Emergency cap: if still bloated after age-based eviction, drop the
  // oldest terminal jobs first regardless of age.
  if (jobs.size > HARD_SIZE_CAP) {
    const terminals = [...jobs.values()]
      .filter(j => j.status === 'completed' || j.status === 'failed')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    while (jobs.size > HARD_SIZE_CAP && terminals.length) {
      const victim = terminals.shift()!;
      jobs.delete(victim.id);
      evicted++;
    }
  }
  if (evicted > 0) console.log(`[queue] swept ${evicted} terminal job(s); ${jobs.size} remain`);
}

setInterval(sweep, EVICTION_TICK_MS).unref();

export function createJob(type: string, data: any): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: 'queued',
    progress: 0,
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

// Find an in-flight generate-month job for the same clientId+month so a
// double-click doesn't start two parallel workers (one wins on DB insert,
// other fails with unique-constraint error → user stuck on failed job).
export function findInflightGenerateJob(clientId: string, month: string): Job | undefined {
  for (const job of jobs.values()) {
    if (job.type !== 'generate-month') continue;
    if (job.status !== 'queued' && job.status !== 'processing') continue;
    if (job.data?.clientId === clientId && job.data?.month === month) return job;
  }
  return undefined;
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  // Stale-job timeout guard: if processing longer than JOB_TIMEOUT_MS, mark failed
  if (job.status === 'processing') {
    const elapsed = Date.now() - new Date(job.updatedAt).getTime();
    if (elapsed > JOB_TIMEOUT_MS) {
      const reason = `Job timed out after ${Math.round(elapsed / 1000)}s (limit: ${JOB_TIMEOUT_MS / 1000}s)`;
      console.error(`[JOB ZOMBIE] ${job.type} (${job.id}): ${reason}`);
      Object.assign(job, { status: 'failed', error: reason, updatedAt: new Date().toISOString() });
    }
  }

  return job;
}

export function updateJob(id: string, updates: Partial<Job>): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  return job;
}

// Process a job asynchronously — fires worker function, updates status
export function processJob(id: string, worker: (job: Job) => Promise<any>): void {
  const job = jobs.get(id);
  if (!job) return;

  updateJob(id, { status: 'processing', progress: 5 });

  worker(job)
    .then(result => {
      updateJob(id, { status: 'completed', progress: 100, result });
    })
    .catch(err => {
      const msg = err.message || String(err);
      console.error(`[JOB FAILED] ${job.type} (${id}): ${msg}`, err.stack || '');
      updateJob(id, { status: 'failed', error: msg });
    });
}
