// caption_write — stream a platform-compliant caption via Grok (xAI).
//
// Reads the piece (CalendarPost) for existing metadata, pulls the client brief
// for tone/brand hints, respects platform char-limits from
// apps/desktop/src/lib/platform-limits.ts, and streams tokens to the agent
// socket room as `agent:message` events.

import OpenAI from 'openai';
import { defineTool } from '../tool-types.js';
import { PLATFORM_LIMITS } from '../../shared/platform-limits.js';

type Platform = 'instagram' | 'linkedin' | 'tiktok' | 'twitter';

interface Args {
  pieceId: string;
  platform: Platform;
  hook: string;
  keyMessage: string;
  tone?: string;
  maxLength?: number;
}

interface Result {
  caption: string;
  charCount: number;
  platform: string;
  /** postId when the caption was persisted back to a CalendarPost; absent if
   *  pieceId didn't resolve to a real row. */
  persistedPostId?: string;
  /** Post version bumped on update (1-indexed). */
  version?: number;
}

const MODEL = process.env.AGENT_MODEL || 'grok-4-fast-reasoning';
const XAI_BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';

// Map tool arg → platform-limits.ts key. Tool accepts "twitter" while the
// limits map keys it as "x".
function limitKey(platform: Platform): string {
  if (platform === 'twitter') return 'x';
  return platform;
}

function resolveMaxLength(platform: Platform, override?: number): number {
  const key = limitKey(platform);
  const entry = PLATFORM_LIMITS[key];
  const primary = entry?.formats?.[0]?.caption;
  const platformMax = primary?.max ?? 2200;
  if (typeof override === 'number' && override > 0) {
    return Math.min(override, platformMax);
  }
  return platformMax;
}

function buildSystemPrompt(platform: Platform, maxLength: number, tone?: string): string {
  const toneClause = tone ? `Tone: ${tone}.` : 'Tone: match the brand voice in the provided brief.';
  return [
    'You are a social media copywriter working inside Radix Media, a Dubai agency.',
    `Write ONE caption for ${platform}. Hard cap: ${maxLength} characters.`,
    toneClause,
    'Rules:',
    '- Output ONLY the caption body. No preamble. No "Here is your caption" wrapper.',
    '- Do NOT include hashtags inline. Hashtags are generated separately.',
    '- Do NOT include trailing links unless the key message supplies one.',
    '- No emoji spam. Max two emoji, only if they add meaning.',
    '- Respect brand do/don\'t and compliance constraints from the brief.',
    '- Open with the hook. Land the key message. End with a single clear CTA or reflection.',
  ].join('\n');
}

function buildUserPrompt(
  hook: string,
  keyMessage: string,
  brief: { tone: string; brandDo: string; brandDont: string; compliance: string | null } | null,
): string {
  const lines: string[] = [];
  lines.push(`HOOK: ${hook}`);
  lines.push(`KEY MESSAGE: ${keyMessage}`);
  if (brief) {
    lines.push('');
    lines.push('CLIENT BRIEF:');
    lines.push(`- tone: ${brief.tone}`);
    lines.push(`- brand do: ${brief.brandDo}`);
    lines.push(`- brand don't: ${brief.brandDont}`);
    if (brief.compliance) lines.push(`- compliance: ${brief.compliance}`);
  }
  lines.push('');
  lines.push('Write the caption now.');
  return lines.join('\n');
}

export const tool = defineTool<Args, Result>({
  name: 'caption_write',
  description:
    'Generate a platform-compliant caption for a calendar piece. Streams tokens as agent:message events. Respects char limits and client brief tone/compliance.',
  input_schema: {
    type: 'object',
    properties: {
      pieceId: { type: 'string', description: 'CalendarPost id.' },
      platform: { type: 'string', enum: ['instagram', 'linkedin', 'tiktok', 'twitter'] },
      hook: { type: 'string', description: 'Opening hook line.' },
      keyMessage: { type: 'string', description: 'Core message to land.' },
      tone: { type: 'string', description: 'Optional tone override.' },
      maxLength: { type: 'number', description: 'Optional char cap (<= platform max).' },
    },
    required: ['pieceId', 'platform', 'hook', 'keyMessage'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('aborted');

    const maxLength = resolveMaxLength(args.platform, args.maxLength);

    // Pull piece + brief. Piece read is best-effort — caption_write still
    // works for drafts that are not persisted yet.
    let clientId: string | null = ctx.clientId ?? null;
    const piece = await ctx.prisma.calendarPost.findUnique({
      where: { id: args.pieceId },
      include: { calendarMonth: { select: { clientId: true } } },
    }).catch(() => null);
    if (piece?.calendarMonth?.clientId) clientId = piece.calendarMonth.clientId;

    let brief: { tone: string; brandDo: string; brandDont: string; compliance: string | null } | null = null;
    if (clientId) {
      const b = await ctx.prisma.clientBrief.findUnique({ where: { clientId } }).catch(() => null);
      if (b) {
        brief = {
          tone: b.tone,
          brandDo: b.brandDo,
          brandDont: b.brandDont,
          compliance: b.complianceNotes ?? null,
        };
      }
    }

    const toneFinal = args.tone ?? brief?.tone;
    const system = buildSystemPrompt(args.platform, maxLength, toneFinal);
    const userPrompt = buildUserPrompt(args.hook, args.keyMessage, brief);

    await ctx.emit('agent:thought', {
      text: `Drafting ${args.platform} caption (<=${maxLength} chars)`,
      at: new Date().toISOString(),
    });

    const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: XAI_BASE_URL });
    const stream = await client.chat.completions.create(
      {
        model: MODEL,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
      },
      { signal: ctx.signal },
    );

    let caption = '';
    for await (const chunk of stream) {
      if (ctx.signal.aborted) throw new Error('aborted');
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        caption += delta;
        await ctx.emit('agent:message', {
          text: delta,
          streaming: true,
          at: new Date().toISOString(),
        });
      }
    }

    caption = caption.trim();
    if (caption.length > maxLength) caption = caption.slice(0, maxLength).trimEnd();

    // Persist back to the CalendarPost if pieceId resolved to a real row AND
    // belongs to this session's client (defense in depth).  Bump version +
    // snapshot the previous state into PostVersion so reviewers can diff.
    let persistedPostId: string | undefined;
    let nextVersion: number | undefined;
    if (piece && (!ctx.clientId || piece.calendarMonth?.clientId === ctx.clientId)) {
      try {
        const updated = await ctx.prisma.$transaction(async (tx) => {
          await tx.postVersion.create({
            data: {
              postId: piece.id,
              snapshot: JSON.parse(JSON.stringify(piece)),
              createdBy: 'agent:caption_write',
            },
          });
          const p = await tx.calendarPost.update({
            where: { id: piece.id },
            data: { caption, version: { increment: 1 } },
            select: { id: true, version: true },
          });
          return p;
        });
        persistedPostId = updated.id;
        nextVersion = updated.version;
        await ctx.emit('agent:artifact', {
          path: `post/${updated.id}`,
          mimeType: 'application/x-radix-post',
          preview: caption.slice(0, 140),
          at: new Date().toISOString(),
        });
        await ctx.emit('agent:thought', {
          text: `Caption written back to post ${updated.id} (v${updated.version}).`,
          at: new Date().toISOString(),
        });
      } catch (err) {
        await ctx.emit('agent:thought', {
          text: `Caption generated but DB update failed: ${err instanceof Error ? err.message : String(err)}`,
          at: new Date().toISOString(),
        });
      }
    }

    await ctx.emit('agent:thought', {
      text: `Caption ready (${caption.length}/${maxLength} chars)`,
      at: new Date().toISOString(),
    });

    return {
      caption,
      charCount: caption.length,
      platform: args.platform,
      persistedPostId,
      version: nextVersion,
    };
  },
});
