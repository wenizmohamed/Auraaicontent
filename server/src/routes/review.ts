import { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { reviewService } from '../services/review.service.js';
import { env } from '../config/env.js';

export async function reviewRoutes(app: FastifyInstance) {

  // ─── Authenticated: Create review link ─────────────────────────
  // POST /api/clients/:clientId/calendar/:month/review-links
  app.post('/clients/:clientId/calendar/:month/review-links', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const { expiresInDays } = (request.body as any) || {};
    const decodedMonth = decodeURIComponent(month);

    const calendarMonth = await db.calendarMonth.findFirst({ where: { clientId, month: decodedMonth } });
    if (!calendarMonth) return reply.status(404).send({ error: 'Calendar month not found' });

    const link = await reviewService.createLink(clientId, calendarMonth.id, expiresInDays);
    const reviewUrl = `${env.PREVIEW_URL}/review/${link.token}`;
    return reply.status(201).send({
      token: link.token,
      url: reviewUrl,
      expiresAt: link.expiresAt,
    });
  });

  // ─── Public: Token-based review endpoints ──────────────────────
  // No authGuard — clients access these with token only

  // GET /api/review/:token
  app.get('/review/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const payload = await reviewService.getReviewPayload(token);
    if (!payload) return reply.status(404).send({ error: 'Review link not found or expired' });
    return payload;
  });

  // POST /api/review/:token/posts/:postId/comments
  app.post('/review/:token/posts/:postId/comments', async (request, reply) => {
    const { token, postId } = request.params as { token: string; postId: string };
    const link = await reviewService.getByToken(token);
    if (!link) return reply.status(404).send({ error: 'Review link not found or expired' });

    const { authorName, comment, status } = request.body as { authorName: string; comment: string; status?: string };
    if (!authorName || !comment) return reply.status(400).send({ error: 'authorName and comment are required' });

    const result = await reviewService.addComment(postId, authorName, comment, status);
    return reply.status(201).send(result);
  });

  // POST /api/review/:token/posts/:postId/approve
  app.post('/review/:token/posts/:postId/approve', async (request, reply) => {
    const { token, postId } = request.params as { token: string; postId: string };
    const link = await reviewService.getByToken(token);
    if (!link) return reply.status(404).send({ error: 'Review link not found or expired' });

    const post = await reviewService.approvePost(postId);
    return { success: true, postId: post.id, status: post.status };
  });

  // POST /api/review/:token/month/approve
  app.post('/review/:token/month/approve', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = await reviewService.getByToken(token);
    if (!link) return reply.status(404).send({ error: 'Review link not found or expired' });

    const result = await reviewService.approveMonth(link.calendarMonthId);
    return result;
  });
}
