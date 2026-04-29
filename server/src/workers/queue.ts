// Job queue — in-memory for now, BullMQ+Redis in Phase 4
// This provides the same API surface so the migration to BullMQ is a drop-in swap

const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max per job (was 10; bumped for visual ref auto-populate headroom)

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
