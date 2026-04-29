import { db } from '../db/prisma.js';
import crypto from 'crypto';

// ReviewLink is the only tenant model that is intentionally readable by an
// unauthenticated party (the agency's client opens the link in a browser
// without a JWT). We compensate by keeping the token cryptographically
// random + carrying orgId on the row so any subsequent write the reviewer
// triggers (comments, approvals) is scoped through the link's orgId.
export const reviewService = {
  async createLink(orgId: string, clientId: string, calendarMonthId: string, expiresInDays?: number) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;
    return db.reviewLink.create({
      data: { orgId, clientId, calendarMonthId, token, expiresAt, isActive: true },
    });
  },

  async getByToken(token: string) {
    // ReviewLink.token is globally unique + this is the single auth path
    // for unauthenticated reviewers — `orgId: undefined` is the explicit
    // opt-out from the tenant guard.  The token IS the auth.
    const link = await db.reviewLink.findUnique({ where: { token, orgId: undefined } });
    if (!link) return null;
    if (!link.isActive) return null;
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
    return link;
  },

  async getReviewPayload(token: string) {
    const link = await this.getByToken(token);
    if (!link) return null;

    // Once we have the link, every downstream lookup is scoped to its orgId.
    const orgId = link.orgId;
    const client = await db.client.findUnique({
      where: { id: link.clientId, orgId },
      select: { name: true, slug: true, industry: true, logoUrl: true },
    });

    const month = await db.calendarMonth.findUnique({
      where: { id: link.calendarMonthId, orgId },
      include: {
        posts: {
          orderBy: { date: 'asc' },
          include: { comments: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });

    return { client, month, linkId: link.id, orgId: link.orgId };
  },

  async addComment(orgId: string, postId: string, authorName: string, comment: string, status?: string) {
    return db.postComment.create({
      data: { orgId, postId, authorName, source: 'client', comment, status: status || 'note' },
    });
  },

  async approvePost(orgId: string, postId: string) {
    return db.calendarPost.update({
      where: { id: postId, orgId },
      data: { status: 'approved' },
    });
  },

  async approveMonth(orgId: string, calendarMonthId: string) {
    await db.calendarMonth.update({
      where: { id: calendarMonthId, orgId },
      data: { status: 'approved' },
    });
    await db.calendarPost.updateMany({
      where: { orgId, calendarMonthId, status: { not: 'approved' } },
      data: { status: 'approved' },
    });
    return { success: true };
  },
};
