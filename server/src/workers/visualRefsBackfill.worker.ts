/**
 * Visual-refs backfill worker (PERF-8).
 *
 * Was: synchronous loop inside POST .../visual-refs/backfill — held an HTTP
 * connection for 2-5 minutes while it fetched references for every eligible
 * post, often timing out at nginx 504 before completion.
 *
 * Now: route enqueues this worker and returns 202 + jobId. Frontend polls
 * /api/jobs/:id (or uses the websocket) until status='completed'. Inner
 * parallelism via p-limit-like Promise.all chunks keeps a single big job
 * from monopolizing visualSearchService.
 */
import { db } from '../db/prisma.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { type Job, updateJob } from './queue.js';

const SEARCH_CONCURRENCY = 4;

export async function visualRefsBackfillWorker(job: Job): Promise<{
  month: string;
  postsScanned: number;
  postsEligible: number;
  postsBackfilled: number;
  totalRefsAdded: number;
  failures: { postId: string; error: string }[];
}> {
  const { orgId, clientId, month, perPost, userId } = job.data as {
    orgId: string;
    clientId: string;
    month: string;
    perPost: number;
    userId?: string;
  };
  if (!orgId) throw new Error('visualRefsBackfill missing orgId');

  updateJob(job.id, { progress: 5 });

  const calMonth = await db.calendarMonth.findFirst({
    where: { orgId, clientId, month },
    include: {
      posts: {
        select: {
          id: true,
          referenceQuery: true,
          _count: { select: { visualRefs: true } },
        },
      },
    },
  });
  if (!calMonth) throw new Error('Calendar month not found');

  const candidates = calMonth.posts.filter(
    (p: any) => p._count.visualRefs === 0 && p.referenceQuery && p.referenceQuery.trim(),
  );

  if (candidates.length === 0) {
    return {
      month,
      postsScanned: calMonth.posts.length,
      postsEligible: 0,
      postsBackfilled: 0,
      totalRefsAdded: 0,
      failures: [],
    };
  }

  let totalRefsAdded = 0;
  let postsBackfilled = 0;
  const failures: { postId: string; error: string }[] = [];
  let processed = 0;

  // Process candidates in chunks of SEARCH_CONCURRENCY so we cap the
  // external HTTP fan-out (PERF-10 precaution) but still parallelize.
  for (let i = 0; i < candidates.length; i += SEARCH_CONCURRENCY) {
    const chunk = candidates.slice(i, i + SEARCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async (p: any) => {
        try {
          const { results } = await visualSearchService.search(p.referenceQuery!, perPost, { orgId, userId, clientId });
          if (results.length > 0) {
            await db.postVisualReference.createMany({
              data: results.map((r: any, idx: number) => ({
                orgId,
                postId: p.id,
                thumbnailUrl: r.thumbnailUrl,
                sourceUrl: r.sourceUrl,
                sourceDomain: r.sourceDomain,
                sourceType: r.sourceType,
                title: r.title || null,
                description: r.description || null,
                pinId: r.pinId || null,
                position: idx,
              })),
            });
            totalRefsAdded += results.length;
          }
          postsBackfilled++;
        } catch (err: any) {
          failures.push({ postId: p.id, error: err?.message?.slice(0, 200) || 'unknown' });
        }
      }),
    );
    processed += chunk.length;
    updateJob(job.id, { progress: 5 + Math.round((processed / candidates.length) * 90) });
  }

  return {
    month,
    postsScanned: calMonth.posts.length,
    postsEligible: candidates.length,
    postsBackfilled,
    totalRefsAdded,
    failures,
  };
}
