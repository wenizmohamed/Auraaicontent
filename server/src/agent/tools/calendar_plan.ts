import { defineTool } from '../tool-types.js';
import type { Piece } from './pieces_generate.js';

interface Args {
  clientId: string;
  month: string;
  pieces: Piece[];
}

interface Result {
  calendarMonthId: string;
  postIds: string[];
}

function now(): string {
  return new Date().toISOString();
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('calendar_plan aborted');
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    throw new Error(`Invalid month: ${month} (expected YYYY-MM)`);
  }
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid month number: ${month}`);
  }
  return { year, monthIndex };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function isWeekend(year: number, monthIndex: number, day: number): boolean {
  const dow = new Date(year, monthIndex, day).getDay();
  return dow === 0 || dow === 6;
}

function buildDateSlots(month: string, count: number, avoidWeekends: boolean): string[] {
  const { year, monthIndex } = parseMonth(month);
  const total = daysInMonth(year, monthIndex);

  const eligible: number[] = [];
  for (let d = 1; d <= total; d++) {
    if (avoidWeekends && isWeekend(year, monthIndex, d)) continue;
    eligible.push(d);
  }
  const pool = eligible.length > 0 ? eligible : Array.from({ length: total }, (_, i) => i + 1);

  const slots: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i * pool.length) / Math.max(count, 1));
    const day = pool[Math.min(idx, pool.length - 1)];
    slots.push(`${year}-${pad2(monthIndex + 1)}-${pad2(day)}`);
  }
  return slots;
}

function pieceDateFallback(piece: Piece, slot: string, month: string): string {
  if (typeof piece.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(piece.date) && piece.date.startsWith(month)) {
    return piece.date;
  }
  return slot;
}

function pieceTitle(piece: Piece, index: number): string {
  const hook = piece.hook?.trim();
  if (hook && hook.length > 0) return hook.slice(0, 120);
  const km = piece.keyMessage?.trim();
  if (km && km.length > 0) return km.slice(0, 120);
  return `Post ${index + 1}`;
}

export const tool = defineTool<Args, Result>({
  name: 'calendar_plan',
  description: 'Create or reuse a CalendarMonth and persist one CalendarPost per draft piece, distributing dates across the month.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string' },
      month: { type: 'string', description: 'YYYY-MM' },
      pieces: { type: 'array', description: 'Piece[] from pieces_generate' },
    },
    required: ['clientId', 'month', 'pieces'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    assertNotAborted(ctx.signal);

    if (!Array.isArray(args.pieces) || args.pieces.length === 0) {
      throw new Error('calendar_plan requires at least one piece');
    }

    const brief = await ctx.prisma.clientBrief.findFirst({
      where: { clientId: args.clientId, orgId: ctx.orgId },
      select: { seasonalNotes: true, complianceNotes: true, cadence: true },
    });

    const avoidWeekends = (() => {
      const hay = `${brief?.seasonalNotes ?? ''} ${brief?.complianceNotes ?? ''} ${brief?.cadence ?? ''}`.toLowerCase();
      return hay.includes('avoid weekend') || hay.includes('no weekend') || hay.includes('weekdays only');
    })();

    const existing = await ctx.prisma.calendarMonth.findFirst({
      where: { orgId: ctx.orgId, clientId: args.clientId, month: args.month, isTest: false },
    });

    const calendarMonth = existing ?? await ctx.prisma.calendarMonth.create({
      data: {
        orgId: ctx.orgId,
        clientId: args.clientId,
        month: args.month,
        status: 'draft',
        isTest: false,
      },
    });

    const slots = buildDateSlots(args.month, args.pieces.length, avoidWeekends);
    const postIds: string[] = [];

    for (let i = 0; i < args.pieces.length; i++) {
      assertNotAborted(ctx.signal);
      const piece = args.pieces[i];
      const date = pieceDateFallback(piece, slots[i], args.month);
      const title = pieceTitle(piece, i);

      const post = await ctx.prisma.calendarPost.create({
        data: {
          orgId: ctx.orgId,
          calendarMonthId: calendarMonth.id,
          date,
          title,
          pillar: piece.pillar || 'general',
          platform: piece.platform,
          format: piece.format || 'post',
          hook: piece.hook || null,
          keyMessage: piece.keyMessage || null,
          caption: piece.caption || '',
          cta: piece.cta || null,
          hashtags: piece.hashtags ?? [],
          visualDirection: piece.visualDirection || null,
          status: 'draft',
          version: 1,
        },
      });

      postIds.push(post.id);

      await ctx.emit('agent:thought', {
        text: `Placed ${title} on ${date}`,
        at: now(),
      });
    }

    return {
      calendarMonthId: calendarMonth.id,
      postIds,
    };
  },
});
