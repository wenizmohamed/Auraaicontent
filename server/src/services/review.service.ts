import { db } from '../db/prisma.js';
import crypto from 'crypto';

export const reviewService = {
  async createLink(clientId: string, calendarMonthId: string, expiresInDays?: number) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;
    return db.reviewLink.create({
      data: { clientId, calendarMonthId, token, expiresAt, isActive: true },
    });
  },

  async getByToken(token: string) {
    const link = await db.reviewLink.findUnique({ where: { token } });
    if (!link) return null;
    if (!link.isActive) return null;
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
    return link;
  },

  async getReviewPayload(token: string) {
    const link = await this.getByToken(token);
    if (!link) return null;

    const client = await db.client.findUnique({
      where: { id: link.clientId },
      select: { name: true, slug: true, industry: true, logoUrl: true },
    });

    const month = await db.calendarMonth.findUnique({
      where: { id: link.calendarMonthId },
      include: {
        posts: {
          orderBy: { date: 'asc' },
          include: { comments: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });

    return { client, month, linkId: link.id };
  },

  async addComment(postId: string, authorName: string, comment: string, status?: string) {
    return db.postComment.create({
      data: { postId, authorName, source: 'client', comment, status: status || 'note' },
    });
  },

  async approvePost(postId: string) {
    return db.calendarPost.update({
      where: { id: postId },
      data: { status: 'approved' },
    });
  },

  async approveMonth(calendarMonthId: string) {
    await db.calendarMonth.update({
      where: { id: calendarMonthId },
      data: { status: 'approved' },
    });
    await db.calendarPost.updateMany({
      where: { calendarMonthId, status: { not: 'approved' } },
      data: { status: 'approved' },
    });
    return { success: true };
  },
};
