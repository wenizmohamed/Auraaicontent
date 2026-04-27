import type { FastifyInstance } from 'fastify';
import { db } from '../../db/prisma.js';
import { apiKeyGuard } from '../../middleware/api-key-guard.js';
import { ok, err } from './_common.js';

export async function v2PostRoutes(app: FastifyInstance) {
  app.addHook('preHandler', apiKeyGuard);

  // GET /v2/posts/:postId — single-post detail with assets + visual refs.
  // Cross-client access is blocked: the post's calendarMonth.clientId must
  // match the API key's clientId.
  app.get<{ Params: { postId: string } }>('/posts/:postId', async (request, reply) => {
    const { clientId } = request.apiKeyContext!;
    const post = await db.calendarPost.findUnique({
      where: { id: request.params.postId },
      include: {
        calendarMonth: { select: { clientId: true, month: true } },
        visualRefs: {
          orderBy: { position: 'asc' },
          select: { id: true, thumbnailUrl: true, sourceUrl: true, sourceDomain: true, title: true, position: true },
        },
        assets: {
          select: {
            asset: {
              select: { id: true, name: true, fileUrl: true, thumbUrl: true, mimeType: true },
            },
          },
        },
      },
    });
    if (!post) return err(reply, 'Post not found', 404);
    if (post.calendarMonth.clientId !== clientId) {
      return err(reply, 'Post not in this workspace', 403);
    }
    return ok(reply, {
      id: post.id,
      date: post.date,
      title: post.title,
      pillar: post.pillar,
      platform: post.platform,
      format: post.format,
      hook: post.hook,
      keyMessage: post.keyMessage,
      caption: post.caption,
      cta: post.cta,
      hashtags: post.hashtags,
      visualDirection: post.visualDirection,
      timing: post.timing,
      status: post.status,
      month: post.calendarMonth.month,
      visualRefs: post.visualRefs,
      assets: post.assets.map((a) => a.asset),
      updatedAt: post.updatedAt,
    });
  });
}
