import { FastifyInstance } from 'fastify';
import { getJob } from '../workers/queue.js';
import { authGuard } from '../middleware/auth.js';

export async function jobRoutes(app: FastifyInstance) {

  app.addHook('preHandler', authGuard);

  // GET /api/jobs/:jobId — scoped by orgId/userId when the job was created
  // with that metadata. Prevents cross-org enumeration by UUID guessing.
  app.get('/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    const jobOrgId = job.data?.orgId;
    const jobUserId = job.data?.userId;
    if (jobOrgId && jobOrgId !== request.orgId) {
      return reply.status(404).send({ error: 'Job not found' });
    }
    if (!jobOrgId && jobUserId && jobUserId !== request.user?.userId) {
      return reply.status(404).send({ error: 'Job not found' });
    }
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
}
