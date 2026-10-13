import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { authGuard } from '../middleware/auth.js';
import { db } from '../db/prisma.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { assertCalendarPostInOrg } from '../lib/tenant.js';

interface AddRefBody {
  thumbnailUrl?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceType?: string;
  title?: string;
  description?: string;
  pinId?: string;
}

interface UpdateRefBody {
  thumbnailUrl?: string;
  sourceUrl?: string;
  title?: string;
  description?: string;
  position?: number;
}

interface SearchBody {
  query?: string;
  count?: number;
}

interface AutoPopulateBody {
  count?: number;
}

function safeDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

async function nextPosition(orgId: string, postId: string): Promise<number> {
  const last = await db.postVisualReference.findFirst({
    where: { orgId, postId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

export async function visualRefRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/calendar-posts/:postId/visual-refs
  app.get('/calendar-posts/:postId/visual-refs', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    try {
      await assertCalendarPostInOrg(postId, request.orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    return db.postVisualReference.findMany({
      where: { orgId: request.orgId!, postId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  });

  // POST /api/calendar-posts/:postId/visual-refs
  app.post('/calendar-posts/:postId/visual-refs', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const orgId = request.orgId!;
    try {
      await assertCalendarPostInOrg(postId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const body = (request.body as AddRefBody) || {};
    if (!body.thumbnailUrl || !body.sourceUrl) {
      return reply.status(400).send({ error: 'thumbnailUrl and sourceUrl are required' });
    }

    const ref = await db.postVisualReference.create({
      data: {
        orgId,
        postId,
        thumbnailUrl: body.thumbnailUrl,
        sourceUrl: body.sourceUrl,
        sourceDomain: body.sourceDomain || safeDomain(body.sourceUrl),
        sourceType: body.sourceType || 'manual',
        title: body.title || null,
        description: body.description || null,
        pinId: body.pinId || null,
        position: await nextPosition(orgId, postId),
      },
    });

    return reply.status(201).send(ref);
  });

  // PATCH /api/visual-refs/:refId
  app.patch('/visual-refs/:refId', async (request, reply) => {
    const { refId } = request.params as { refId: string };
    const orgId = request.orgId!;
    const body = (request.body as UpdateRefBody) || {};

    const existing = await db.postVisualReference.findUnique({ where: { id: refId, orgId } });
    if (!existing) return reply.status(404).send({ error: 'visual ref not found' });

    const data: Prisma.PostVisualReferenceUpdateInput = {};
    if (typeof body.thumbnailUrl === 'string') data.thumbnailUrl = body.thumbnailUrl;
    if (typeof body.sourceUrl === 'string') {
      data.sourceUrl = body.sourceUrl;
      data.sourceDomain = safeDomain(body.sourceUrl);
    }
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.description === 'string') data.description = body.description;
    if (typeof body.position === 'number') data.position = body.position;

    return db.postVisualReference.update({ where: { id: refId, orgId }, data });
  });

  // DELETE /api/visual-refs/:refId
  app.delete('/visual-refs/:refId', async (request, reply) => {
    const { refId } = request.params as { refId: string };
    const orgId = request.orgId!;
    const existing = await db.postVisualReference.findUnique({ where: { id: refId, orgId }, select: { orgId: true } });
    if (!existing) return reply.status(404).send({ error: 'visual ref not found' });
    await db.postVisualReference.delete({ where: { id: refId, orgId } });
    return { success: true };
  });

  // POST /api/visual-refs/search
  app.post('/visual-refs/search', async (request, reply) => {
    const { query, count } = (request.body as SearchBody) || {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return reply.status(400).send({ error: 'query is required' });
    }
    const out = await visualSearchService.search(query.trim(), count || 8, { orgId: request.orgId, userId: request.user?.userId });
    return out;
  });

  // POST /api/calendar-posts/:postId/visual-refs/auto-populate
  app.post('/calendar-posts/:postId/visual-refs/auto-populate', async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const orgId = request.orgId!;
    try {
      await assertCalendarPostInOrg(postId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const { count } = (request.body as AutoPopulateBody) || {};

    const post = await db.calendarPost.findUnique({ where: { id: postId, orgId } });
    if (!post) return reply.status(404).send({ error: 'post not found' });
    if (!post.referenceQuery || !post.referenceQuery.trim()) {
      return reply.status(422).send({ error: 'post has no referenceQuery — add a referenceQuery first or use the manual add endpoint' });
    }

    const { results } = await visualSearchService.search(post.referenceQuery, count || 6, { orgId, userId: request.user?.userId });
    let position = await nextPosition(orgId, postId);

    const created = [];
    for (const r of results) {
      const ref = await db.postVisualReference.create({
        data: {
          orgId,
          postId,
          thumbnailUrl: r.thumbnailUrl,
          sourceUrl: r.sourceUrl,
          sourceDomain: r.sourceDomain,
          sourceType: r.sourceType,
          title: r.title || null,
          description: r.description || null,
          pinId: r.pinId || null,
          position: position++,
        },
      });
      created.push(ref);
    }

    return { added: created.length, refs: created };
  });
}
