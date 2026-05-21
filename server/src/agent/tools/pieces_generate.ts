import { chatStream } from '../../services/llm/chat.js';
import { defineTool } from '../tool-types.js';
import type { NormalizedBrief } from './brief_analyze.js';

// Tool LLM rides the Gemini → Grok → Kimi fallback chain.
const DEFAULT_PIECE_COUNT = 18;
const ALLOWED_PLATFORMS = ['Instagram', 'LinkedIn', 'TikTok'] as const;
type Platform = (typeof ALLOWED_PLATFORMS)[number];

interface Piece {
  date: string;
  platform: Platform;
  format: string;
  hook: string;
  keyMessage: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualDirection: string;
  pillar: string;
}

interface Args {
  clientId: string;
  month: string;
  pieceCount?: number;
  brief: NormalizedBrief;
  /** If true (default), persist to CalendarMonth + CalendarPost so the
   *  Calendar / Review / Pieces pages see the work.  Set to false only
   *  when you want a pure-preview draft (rare). */
  persist?: boolean;
}

interface Result {
  pieces: Piece[];
  /** Populated when persist=true.  These ids are what caption_write,
   *  hashtag_research, and compliance_check should target to refine
   *  individual posts. */
  calendarMonthId?: string;
  postIds?: string[];
}

function now(): string {
  return new Date().toISOString();
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('pieces_generate aborted');
  }
}

function selectPlatforms(brief: NormalizedBrief): Platform[] {
  const requested = new Set(
    brief.platforms.map((p) => p.toLowerCase().trim()),
  );
  const matched = ALLOWED_PLATFORMS.filter((p) => requested.has(p.toLowerCase()));
  return matched.length > 0 ? matched : [...ALLOWED_PLATFORMS];
}

function buildSystemPrompt(): string {
  return [
    'You are a senior social content strategist drafting a monthly content plan.',
    'Return STRICT JSON only — no prose, no code fences, no commentary.',
    'Output shape: {"pieces": Piece[]} where Piece matches the schema given by the user.',
    'Every field must be present and non-empty. Hashtags must be an array of 3-8 lowercase tags prefixed with #.',
  ].join(' ');
}

function buildUserPrompt(args: Args, platforms: Platform[], count: number): string {
  return [
    `Client ID: ${args.clientId}`,
    `Target month: ${args.month}`,
    `Number of pieces: ${count}`,
    `Allowed platforms (mix across these): ${platforms.join(', ')}`,
    '',
    'BRIEF:',
    `- Objective: ${args.brief.objective}`,
    `- Audience: ${args.brief.audience}`,
    `- Tone: ${args.brief.tone}`,
    `- Pillars: ${args.brief.pillars.join(', ') || 'n/a'}`,
    `- Mandatory inclusions: ${args.brief.mandatoryInclusions || 'none'}`,
    `- Compliance notes: ${args.brief.complianceNotes || 'none'}`,
    `- Competitors to contrast against: ${args.brief.competitors || 'none'}`,
    '',
    'Piece schema (JSON):',
    '{ "date": "YYYY-MM-DD", "platform": "Instagram|LinkedIn|TikTok", "format": string, "hook": string,',
    '  "keyMessage": string, "caption": string, "cta": string, "hashtags": string[], "visualDirection": string, "pillar": string }',
    '',
    `Return exactly ${count} pieces. Dates must land inside ${args.month}. Distribute platforms and pillars sensibly.`,
    'Respond with a single JSON object only.',
  ].join('\n');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output did not contain a JSON object');
  }
  const slice = trimmed.slice(start, end + 1);
  return JSON.parse(slice);
}

function coerceHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
}

function coercePlatform(raw: unknown, fallback: Platform): Platform {
  if (typeof raw !== 'string') return fallback;
  const lower = raw.toLowerCase();
  const hit = ALLOWED_PLATFORMS.find((p) => p.toLowerCase() === lower);
  return hit ?? fallback;
}

function coercePiece(raw: unknown, fallbackPlatform: Platform): Piece {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    date: typeof r.date === 'string' ? r.date : '',
    platform: coercePlatform(r.platform, fallbackPlatform),
    format: typeof r.format === 'string' ? r.format : 'post',
    hook: typeof r.hook === 'string' ? r.hook : '',
    keyMessage: typeof r.keyMessage === 'string' ? r.keyMessage : '',
    caption: typeof r.caption === 'string' ? r.caption : '',
    cta: typeof r.cta === 'string' ? r.cta : '',
    hashtags: coerceHashtags(r.hashtags),
    visualDirection: typeof r.visualDirection === 'string' ? r.visualDirection : '',
    pillar: typeof r.pillar === 'string' ? r.pillar : '',
  };
}

export const tool = defineTool<Args, Result>({
  name: 'pieces_generate',
  description: 'Stream-generate N content pieces for a client month using Claude, returning structured drafts.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string' },
      month: { type: 'string', description: 'YYYY-MM' },
      pieceCount: { type: 'number', description: 'How many pieces to draft (default 18)' },
      brief: { type: 'object', description: 'NormalizedBrief from brief_analyze' },
      persist: { type: 'boolean', description: 'Persist to CalendarMonth + CalendarPost (default true).' },
    },
    required: ['clientId', 'month', 'brief'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    assertNotAborted(ctx.signal);


    const count = typeof args.pieceCount === 'number' && args.pieceCount > 0
      ? Math.min(Math.floor(args.pieceCount), 60)
      : DEFAULT_PIECE_COUNT;

    const platforms = selectPlatforms(args.brief);
    await ctx.emit('agent:thought', {
      text: `Drafting ${count} pieces across ${platforms.join(', ')}\u2026`,
      at: now(),
    });

    const opened = await chatStream(
      {
        max_tokens: 8192,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(args, platforms, count) },
        ],
      },
      {
        signal: ctx.signal,
        meta: { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: ctx.clientId ?? undefined, jobId: ctx.sessionUid },
      },
    );

    let buffer = '';
    let flushed = 0;
    const CHUNK_FLUSH = 160;

    for await (const chunk of opened.stream) {
      assertNotAborted(ctx.signal);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        buffer += delta;
        if (buffer.length - flushed >= CHUNK_FLUSH) {
          await ctx.emit('agent:message', {
            text: buffer.slice(flushed),
            streaming: true,
            at: now(),
          });
          flushed = buffer.length;
        }
      }
    }

    if (buffer.length > flushed) {
      await ctx.emit('agent:message', {
        text: buffer.slice(flushed),
        streaming: true,
        at: now(),
      });
    }

    const parsed = extractJson(buffer);
    const rawPieces = (parsed as { pieces?: unknown }).pieces;
    if (!Array.isArray(rawPieces)) {
      throw new Error('Model response missing "pieces" array');
    }

    const pieces = rawPieces.map((p, i) => coercePiece(p, platforms[i % platforms.length]));

    await ctx.emit('agent:thought', {
      text: `Draft complete: ${pieces.length} piece${pieces.length === 1 ? '' : 's'}.`,
      at: now(),
    });

    // Persist to CalendarMonth + CalendarPost so the Calendar / Review /
    // Pieces pages see the work.  Default on — the user opens the app
    // looking for rows, not chat transcripts.  Uses the same find-or-create
    // pattern as calendar_plan.ts and a $transaction so a partial write
    // doesn't leave an empty month.
    const persist = args.persist !== false;
    if (!persist) {
      return { pieces };
    }

    assertNotAborted(ctx.signal);
    const { calendarMonthId, postIds } = await ctx.prisma.$transaction(async (tx: any) => {
      const existing = await tx.calendarMonth.findFirst({
        where: { orgId: ctx.orgId, clientId: args.clientId, month: args.month, isTest: false },
        select: { id: true },
      });
      const month = existing ?? await tx.calendarMonth.create({
        data: {
          orgId: ctx.orgId,
          clientId: args.clientId,
          month: args.month,
          status: 'draft',
          isTest: false,
        },
        select: { id: true },
      });

      const ids: string[] = [];
      for (const [i, p] of pieces.entries()) {
        const title = (p.hook?.trim() || p.keyMessage?.trim() || `Post ${i + 1}`).slice(0, 120);
        const post = await tx.calendarPost.create({
          data: {
            orgId: ctx.orgId,
            calendarMonthId: month.id,
            date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : `${args.month}-01`,
            title,
            pillar: p.pillar || 'general',
            platform: p.platform,
            format: p.format || 'post',
            hook: p.hook || null,
            keyMessage: p.keyMessage || null,
            caption: p.caption || '',
            cta: p.cta || null,
            hashtags: p.hashtags ?? [],
            visualDirection: p.visualDirection || null,
            status: 'draft',
            version: 1,
          },
          select: { id: true },
        });
        ids.push(post.id);
      }
      return { calendarMonthId: month.id, postIds: ids };
    });

    await ctx.emit('agent:artifact', {
      path: `calendar/${args.month}`,
      mimeType: 'application/x-radix-calendar-month',
      preview: `${pieces.length} posts drafted for ${args.month}`,
      at: now(),
    });
    await ctx.emit('agent:thought', {
      text: `Persisted ${postIds.length} posts to CalendarMonth ${calendarMonthId}. Visible at /calendar now.`,
      at: now(),
    });

    return { pieces, calendarMonthId, postIds };
  },
});

export type { Piece };
