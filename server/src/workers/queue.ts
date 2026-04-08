// Job queue — in-memory for now, BullMQ+Redis in Phase 4
// This provides the same API surface so the migration to BullMQ is a drop-in swap

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

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
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
      updateJob(id, { status: 'failed', error: err.message || String(err) });
    });
}
