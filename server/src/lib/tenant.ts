import { db } from '../db/prisma.js';

// Throw if the given clientId doesn't belong to the org. Use at the top of
// any route that takes :clientId in the path — one check protects every
// downstream query that filters by clientId. Returns the client row so
// callers don't double-fetch.
export async function assertClientInOrg(clientId: string, orgId: string | undefined) {
  if (!orgId) {
    const e: any = new Error('Missing org scope');
    e.statusCode = 401;
    throw e;
  }
  const client = await db.client.findUnique({
    where: { id: clientId, orgId },
    select: { id: true, orgId: true, name: true, slug: true },
  });
  if (!client) {
    const e: any = new Error('Client not found');
    e.statusCode = 404;
    throw e;
  }
  return client;
}

// Same guard for resources scoped by parent — looks up the parent row and
// verifies orgId. Used by routes that take :postId or :monthId etc.
export async function assertCalendarMonthInOrg(monthId: string, orgId: string | undefined) {
  if (!orgId) {
    const e: any = new Error('Missing org scope');
    e.statusCode = 401;
    throw e;
  }
  const m = await db.calendarMonth.findUnique({
    where: { id: monthId, orgId },
    select: { id: true, orgId: true, clientId: true, month: true },
  });
  if (!m) {
    const e: any = new Error('Calendar month not found');
    e.statusCode = 404;
    throw e;
  }
  return m;
}

export async function assertCalendarPostInOrg(postId: string, orgId: string | undefined) {
  if (!orgId) {
    const e: any = new Error('Missing org scope');
    e.statusCode = 401;
    throw e;
  }
  const p = await db.calendarPost.findUnique({
    where: { id: postId, orgId },
    select: { id: true, orgId: true, calendarMonthId: true },
  });
  if (!p) {
    const e: any = new Error('Post not found');
    e.statusCode = 404;
    throw e;
  }
  return p;
}
