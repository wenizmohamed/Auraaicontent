// calendar_read -- read-only view of a client's content calendar.
//
// The agent can CREATE posts (calendar_plan) but had no way to SEE what
// already exists, so it re-invented work and guessed at post ids. This tool
// lists the calendar months available for a client and, when a month is
// given, returns that month's posts with REAL ids so caption_write and
// compliance_check can target actual rows instead of hallucinated ones.
//
// Read-only: no writes, no LLM calls. Every query is scoped by ctx.orgId.
// Failure modes (client not in org, month not found, DB error) come back as
// a plain { error } object the model can reason over. Only user aborts throw.
//
// Month format: the DB holds BOTH human labels ("July 2026") and ISO keys
// ("2026-07"). normalizeMonth() from brief.service bridges the two; callers
// may pass either form.

import { defineTool } from '../tool-types.js';
import { normalizeMonth } from '../../services/brief.service.js';

interface Args {
  clientId?: string;
  month?: string;
  status?: string;
  limit?: number;
}

interface MonthSummary {
  id: string;
  month: string;    // raw stored value ("July 2026" or "2026-07")
  monthKey: string; // canonical "YYYY-MM"
  status: string;
  postCount: number;
}

interface PostSummary {
  id: string;
  date: string;
  platform: string;
  format: string;
  title: string;
  caption: string; // truncated to CAPTION_PREVIEW_CHARS
  status: string;
  hashtags: string[];
  hasAsset: boolean;
}

interface Result {
  clientId?: string;
  clientName?: string;
  months?: MonthSummary[];
  month?: string; // canonical key of the month whose posts are returned
  monthStatus?: string;
  posts?: PostSummary[];
  totalPosts?: number; // total matching posts before the limit was applied
  note?: string;
  error?: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_MONTHS = 24;
const CAPTION_PREVIEW_CHARS = 160;
const MAX_HASHTAGS = 12;

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('AbortError: calendar_read cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

// hashtags is a Json column: usually string[], sometimes a single string.
function toHashtagArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((s) => s.length > 0)
      .slice(0, MAX_HASHTAGS);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_HASHTAGS);
  }
  return [];
}

export const tool = defineTool<Args, Result>({
  name: 'calendar_read',
  description:
    'Read the existing content calendar for a client (read-only). With no month arg, lists the months available ' +
    '(id, month, status, post count). With a month arg (either "2026-07" or "July 2026"), returns that month\'s posts ' +
    'with their REAL ids, dates, platforms, captions and statuses so follow-up tools (caption_write, compliance_check) ' +
    'can target actual posts. Optional status filter (draft/approved/scheduled/published/failed) and limit.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'Client id. Defaults to the session\'s active client.' },
      month: { type: 'string', description: 'Month to read, "YYYY-MM" or a label like "July 2026". Omit to list available months.' },
      status: { type: 'string', description: 'Optional post status filter: draft, approved, scheduled, published or failed.' },
      limit: { type: 'number', description: `Max posts to return (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}).` },
    },
    additionalProperties: false,
  },

  async handler(args, ctx) {
    checkAbort(ctx.signal);

    const clientId = (typeof args.clientId === 'string' && args.clientId.trim().length > 0)
      ? args.clientId.trim()
      : ctx.clientId ?? null;
    if (!clientId) {
      return { error: 'No clientId given and no active client in this session. Pass clientId or run client_switch first.' };
    }

    const limit = clampLimit(args.limit);
    const statusFilter = typeof args.status === 'string' && args.status.trim().length > 0
      ? args.status.trim().toLowerCase()
      : null;

    try {
      const client = await ctx.prisma.client.findUnique({
        where: { id: clientId, orgId: ctx.orgId },
        select: { id: true, name: true },
      });
      if (!client) {
        return { error: `Client ${clientId} not found in this organization.` };
      }

      checkAbort(ctx.signal);

      const monthRows = await ctx.prisma.calendarMonth.findMany({
        where: { orgId: ctx.orgId, clientId: client.id, isTest: false, isArchived: false },
        select: {
          id: true,
          month: true,
          status: true,
          _count: { select: { posts: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_MONTHS,
      });

      const months: MonthSummary[] = monthRows
        .map((m) => ({
          id: m.id,
          month: m.month,
          monthKey: normalizeMonth(m.month),
          status: m.status,
          postCount: m._count.posts,
        }))
        // Newest first by canonical key; unparseable keys sink to the end.
        .sort((a, b) => (b.monthKey > a.monthKey ? 1 : b.monthKey < a.monthKey ? -1 : 0));

      if (typeof args.month !== 'string' || args.month.trim().length === 0) {
        await ctx.emit('agent:thought', {
          text: `Calendar for ${client.name}: ${months.length} month${months.length === 1 ? '' : 's'} available.`,
          at: new Date().toISOString(),
        });
        return {
          clientId: client.id,
          clientName: client.name,
          months,
          note: months.length === 0
            ? 'No calendar months exist for this client yet. Use calendar_plan to create one.'
            : 'Pass one of these months to read its posts.',
        };
      }

      const wantedKey = normalizeMonth(args.month);
      const target = months.find((m) => m.monthKey === wantedKey);
      if (!target) {
        return {
          clientId: client.id,
          clientName: client.name,
          months,
          error: `Month "${args.month}" not found for ${client.name}. Pick from the months listed.`,
        };
      }

      checkAbort(ctx.signal);

      const postWhere = {
        orgId: ctx.orgId,
        calendarMonthId: target.id,
        ...(statusFilter ? { status: statusFilter } : {}),
      };

      const totalPosts = await ctx.prisma.calendarPost.count({ where: postWhere });
      const postRows = await ctx.prisma.calendarPost.findMany({
        where: postWhere,
        select: {
          id: true,
          date: true,
          platform: true,
          format: true,
          title: true,
          caption: true,
          status: true,
          hashtags: true,
          _count: { select: { assets: true } },
        },
        orderBy: { date: 'asc' },
        take: limit,
      });

      const posts: PostSummary[] = postRows.map((p) => ({
        id: p.id,
        date: p.date,
        platform: p.platform,
        format: p.format,
        title: p.title,
        caption: truncate(p.caption, CAPTION_PREVIEW_CHARS),
        status: p.status,
        hashtags: toHashtagArray(p.hashtags),
        hasAsset: p._count.assets > 0,
      }));

      let note: string | undefined;
      if (posts.length === 0) {
        note = statusFilter
          ? `Month exists but has no posts with status "${statusFilter}".`
          : 'Month exists but has no posts yet.';
      } else if (totalPosts > posts.length) {
        note = `Showing ${posts.length} of ${totalPosts} posts. Raise limit or filter by status to see the rest.`;
      }

      await ctx.emit('agent:thought', {
        text: `Read ${posts.length}/${totalPosts} posts for ${client.name} ${target.monthKey}${statusFilter ? ` (status=${statusFilter})` : ''}.`,
        at: new Date().toISOString(),
      });

      return {
        clientId: client.id,
        clientName: client.name,
        month: target.monthKey,
        monthStatus: target.status,
        months,
        posts,
        totalPosts,
        note,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      return { error: `Calendar read failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
