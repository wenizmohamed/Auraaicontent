import { FastifyInstance, FastifyRequest } from 'fastify';
import { getJob, requestJobCancel, type Job } from '../workers/queue.js';
import { authGuard, denyViewer } from '../middleware/auth.js';

export async function jobRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // Scoped by orgId/userId when the job was created with that metadata.
  // Prevents cross-org enumeration (or cancellation) by UUID guessing.
  function canSee(job: Job, request: FastifyRequest): boolean {
    const jobOrgId = job.data?.orgId;
    const jobUserId = job.data?.userId;
    if (jobOrgId && jobOrgId !== request.orgId) return false;
    if (!jobOrgId && jobUserId && jobUserId !== request.user?.userId) return false;
    return true;
  }

  // GET /api/jobs/:jobId
  app.get('/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job || !canSee(job, request)) return reply.status(404).send({ error: 'Job not found' });
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.result || null,
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  });

  // POST /api/jobs/:jobId/cancel — "Stop Generation". Cooperative: a waiting
  // job is removed; a running one aborts its AI call within ~5s and saves
  // nothing. Idempotent; a job that already finished is left as is.
  app.post('/:jobId/cancel', { preHandler: denyViewer }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job || !canSee(job, request)) return reply.status(404).send({ error: 'Job not found' });
    const outcome = await requestJobCancel(jobId);
    return { id: jobId, outcome };
  });
}
