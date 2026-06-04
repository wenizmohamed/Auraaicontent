import { db } from '../db/prisma.js';
import crypto from 'crypto';
import { recordMemory } from './memory.service.js';

// Turn a reviewer's comment into a reusable learning. Client comments are
// human-written guidance ("shorten the captions", "more formal tone"), so they
// store verbatim — no LLM distillation needed. Scoped to the post's client so
// the lesson only colours that brand's future generations. Best-effort: any
// failure is swallowed so leaving a comment never breaks.
async function captureCommentLearning(orgId: string, postId: string, comment: string, status?: string) {
  try {
    const post = await db.calendarPost.findUnique({
      where: { id: postId, orgId },
      select: { title: true, calendarMonth: { select: { clientId: true } } },
    });
    const clientId = post?.calendarMonth?.clientId ?? null;
    const isRevision = /revis|reject|change|redo|fix|wrong|don'?t|do not|instead|should/i.test(`${status || ''} ${comment}`);
    await recordMemory({
      orgId,
      clientId,
      kind: isRevision ? 'correction' : 'preference',
      source: 'rejection',
      content: comment.trim(),
      context: post?.title ? `Reviewer feedback on post: ${post.title}` : undefined,
    });
  } catch (err: any) {
    console.warn('[review] capture comment learning failed:', err?.message || err);
  }
}

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
    const created = await db.postComment.create({
      data: { orgId, postId, authorName, source: 'client', comment, status: status || 'note' },
    });
    // Learn from the feedback (fire-and-forget — never delay/break the comment).
    if (comment?.trim()) void captureCommentLearning(orgId, postId, comment, status);
    return created;
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
