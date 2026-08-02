// post_schedule -- stage a CalendarPost for auto-publish by the scheduler
// worker. Scheduling ONLY: this tool never publishes immediately.
//
// Mirrors the hardened PATCH /api/calendar-posts/:postId (routes/calendar.ts):
//   1. org-scoped post lookup FIRST (assertCalendarPostInOrg pattern, via
//      ctx.prisma so tools share the tenant-guarded client),
//   2. a supplied platformConnectionId is proven in-org BEFORE it is written.
//      An unvalidated id would let the scheduler publish this org's content
//      through another org's social account, and recordSuccess scopes its
//      write-back by the connection's orgId so the post would never flip to
//      'published' and would republish every hour,
//   3. status stamped 'scheduled' + scheduleError cleared, exactly what
//      workers/scheduler.worker.ts polls for (status='scheduled' AND
//      scheduledAt <= now+60s).
//
// Contract with the loop: never throws; every failure is a { error } object.

import { defineTool } from '../tool-types.js';

interface Args {
  postId: string;
  scheduledAt: string;
  platformConnectionId?: string;
}

interface Result {
  scheduled: boolean;
  postId?: string;
  scheduledAt?: string;
  status?: string;
  platformConnectionId?: string | null;
  note?: string;
  error?: string;
}

// Pure helper so tests can pin the past-datetime refusal without a database.
// Strictly future: the worker polls now+60s, so accepting a past timestamp
// would make it fire on the next tick, which is an instant publish in
// everything but name.
export function parseFutureScheduleTime(
  iso: unknown,
  now: Date = new Date(),
): { ok: true; date: Date } | { ok: false; error: string } {
  if (typeof iso !== 'string' || !iso.trim()) {
    return { ok: false, error: 'scheduledAt is required (ISO datetime, e.g. "2026-08-15T09:00:00Z")' };
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: `scheduledAt "${iso}" is not a valid ISO datetime` };
  }
  if (date.getTime() <= now.getTime()) {
    return {
      ok: false,
      error:
        `scheduledAt ${date.toISOString()} is in the past (now: ${now.toISOString()}). ` +
        `Scheduling is future-only; this tool never publishes immediately. Pick a future time.`,
    };
  }
  return { ok: true, date };
}

export const tool = defineTool<Args, Result>({
  name: 'post_schedule',
  description:
    'Schedule an existing calendar post for auto-publish at a future time. ' +
    'Sets scheduledAt and status "scheduled" so the scheduler worker publishes it; never publishes immediately. ' +
    'Optionally attaches a platform connection (must belong to this workspace).',
  input_schema: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: 'CalendarPost id to schedule.' },
      scheduledAt: {
        type: 'string',
        description: 'Future ISO datetime to publish at, e.g. "2026-08-15T09:00:00Z". Past times are refused.',
      },
      platformConnectionId: {
        type: 'string',
        description: 'Optional PlatformConnection id to publish through. Must belong to this workspace.',
      },
    },
    required: ['postId', 'scheduledAt'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    try {
      if (ctx.signal.aborted) return { scheduled: false, error: 'post_schedule cancelled' };

      const postId = typeof args.postId === 'string' ? args.postId.trim() : '';
      if (!postId) return { scheduled: false, error: 'postId is required' };

      const parsed = parseFutureScheduleTime(args.scheduledAt);
      if (!parsed.ok) return { scheduled: false, error: parsed.error };

      // Org scope FIRST (assertCalendarPostInOrg pattern): the post must be in
      // ctx.orgId or it does not exist as far as this session is concerned.
      const post = await ctx.prisma.calendarPost.findUnique({
        where: { id: postId, orgId: ctx.orgId },
        select: {
          id: true,
          title: true,
          platform: true,
          calendarMonth: { select: { clientId: true } },
        },
      });
      if (!post) return { scheduled: false, error: `Post ${postId} not found in this workspace` };

      // Defense in depth (matches caption_write): a session pinned to one
      // client must not schedule another client's post.
      if (ctx.clientId && post.calendarMonth?.clientId && post.calendarMonth.clientId !== ctx.clientId) {
        return { scheduled: false, error: 'Post belongs to a different client than this session' };
      }

      // Prove a supplied connection is in-org BEFORE writing it (route parity).
      let connectionId: string | undefined;
      if (args.platformConnectionId) {
        const conn = await ctx.prisma.platformConnection.findFirst({
          where: { id: String(args.platformConnectionId), orgId: ctx.orgId },
          select: { id: true },
        });
        if (!conn) return { scheduled: false, error: 'Platform connection not found in this workspace' };
        connectionId = conn.id;
      }

      const data: Record<string, unknown> = {
        scheduledAt: parsed.date,
        status: 'scheduled',
        // Clear any stale schedule error from a previous failed attempt.
        scheduleError: null,
      };
      if (connectionId) data.platformConnectionId = connectionId;

      const updated = await ctx.prisma.calendarPost.update({
        where: { id: postId, orgId: ctx.orgId },
        data,
        select: { id: true, status: true, scheduledAt: true, platformConnectionId: true },
      });

      const scheduledAtIso =
        updated.scheduledAt instanceof Date ? updated.scheduledAt.toISOString() : parsed.date.toISOString();

      await ctx.emit('agent:thought', {
        text: `Post "${post.title}" (${post.platform}) scheduled for ${scheduledAtIso}.`,
        at: new Date().toISOString(),
      });

      const note = updated.platformConnectionId
        ? undefined
        : 'No platform connection attached yet; the scheduler needs one to auto-publish. Ask the user to connect an account or supply platformConnectionId.';

      return {
        scheduled: true,
        postId: updated.id,
        scheduledAt: scheduledAtIso,
        status: updated.status,
        platformConnectionId: updated.platformConnectionId ?? null,
        ...(note ? { note } : {}),
      };
    } catch (err) {
      return {
        scheduled: false,
        error: `Post schedule failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
