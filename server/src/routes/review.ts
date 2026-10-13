import { FastifyInstance } from 'fastify';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { reviewService } from '../services/review.service.js';
import { env } from '../config/env.js';
import { assertClientInOrg } from '../lib/tenant.js';
import { auditService } from '../services/audit.service.js';

export async function reviewRoutes(app: FastifyInstance) {

  // ─── Authenticated: Create review link ─────────────────────────
  // POST /api/clients/:clientId/calendar/:month/review-links
  app.post('/clients/:clientId/calendar/:month/review-links', { preHandler: [authGuard] }, async (request, reply) => {
    const { clientId, month } = request.params as { clientId: string; month: string };
    const orgId = request.orgId!;
    try {
      await assertClientInOrg(clientId, orgId);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const { expiresInDays } = (request.body as { expiresInDays?: number }) || {};
    const decodedMonth = decodeURIComponent(month);

    const calendarMonth = await db.calendarMonth.findFirst({ where: { orgId, clientId, month: decodedMonth } });
    if (!calendarMonth) return reply.status(404).send({ error: 'Calendar month not found' });

    const link = await reviewService.createLink(orgId, clientId, calendarMonth.id, expiresInDays);
    // Use the live app domain (radixcontent.com) — NOT the decommissioned
    // synapseai-labs.com in the legacy PREVIEW_URL, which only resolves via a
    // fragile 301 and breaks every client review link if it ever lapses.
    const reviewUrl = `${env.RADIX_APP_BASE_URL}/review/${link.token}`;
    return reply.status(201).send({
      token: link.token,
      url: reviewUrl,
      expiresAt: link.expiresAt,
    });
  });

  // ─── Public: Token-based review endpoints ──────────────────────
  // No authGuard — clients access these with token only. The token IS
  // the auth; reviewService scopes the org via the link's orgId.

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

    // Verify postId belongs to the link's calendar (defense in depth — token
    // grants approval rights only for its own month).
    const post = await db.calendarPost.findFirst({ where: { id: postId, orgId: link.orgId }, select: { orgId: true, calendarMonthId: true } });
    if (!post || post.orgId !== link.orgId || post.calendarMonthId !== link.calendarMonthId) {
      return reply.status(404).send({ error: 'Post not in this review link' });
    }

    const result = await reviewService.addComment(link.orgId, postId, authorName, comment, status);
    return reply.status(201).send(result);
  });

  // POST /api/review/:token/posts/:postId/approve
  app.post('/review/:token/posts/:postId/approve', async (request, reply) => {
    const { token, postId } = request.params as { token: string; postId: string };
    const link = await reviewService.getByToken(token);
    if (!link) return reply.status(404).send({ error: 'Review link not found or expired' });

    const post = await db.calendarPost.findFirst({ where: { id: postId, orgId: link.orgId }, select: { orgId: true, calendarMonthId: true } });
    if (!post || post.orgId !== link.orgId || post.calendarMonthId !== link.calendarMonthId) {
      return reply.status(404).send({ error: 'Post not in this review link' });
    }

    const updated = await reviewService.approvePost(link.orgId, postId);

    auditService.log({
      orgId: link.orgId,
      action: 'review.approve',
      entityType: 'CalendarPost',
      entityId: updated.id,
      payload: { reviewToken: token.slice(0, 8), status: updated.status },
    }).catch(() => {});

    return { success: true, postId: updated.id, status: updated.status };
  });

  // POST /api/review/:token/month/approve
  app.post('/review/:token/month/approve', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = await reviewService.getByToken(token);
    if (!link) return reply.status(404).send({ error: 'Review link not found or expired' });

    const result = await reviewService.approveMonth(link.orgId, link.calendarMonthId);
    return result;
  });
}
