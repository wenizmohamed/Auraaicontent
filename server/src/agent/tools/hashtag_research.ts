// hashtag_research — research relevant hashtags for a topic+platform.
//
// Strategy:
//   1. Live discovery via Pinterest scraper (public JSON endpoint, already used
//      by visual-search.service.ts). Pin titles/descriptions routinely contain
//      hashtag tokens we can harvest.
//   2. Fallback / enrichment: ask Anthropic (claude-sonnet-4-6) to propose
//      hashtags with rationale + rough reach estimate.
//
// Emits agent:thought progress updates. Returns shape:
//   { hashtags: { tag, reach_estimate?, rationale }[] }

import { chatText } from '../../services/llm/chat.js';
import { defineTool } from '../tool-types.js';
import { searchPinterest } from '../../services/pinterest.service.js';

interface Args {
  topic: string;
  platform: string;
  count?: number;
  clientId?: string;
  /** When provided, the returned hashtag set gets merge-written into
   *  CalendarPost.hashtags so the Calendar / Review pages show them. */
  postId?: string;
}

interface HashtagRec {
  tag: string;
  reach_estimate?: string;
  rationale: string;
}

interface Result {
  hashtags: HashtagRec[];
  /** Populated when postId was supplied AND the merge write succeeded. */
  persistedPostId?: string;
  mergedTagCount?: number;
}

// Tool LLM rides the Gemini → Grok → Kimi fallback chain.
const DEFAULT_COUNT = 12;
const HASHTAG_RX = /#([A-Za-z][A-Za-z0-9_]{1,49})/g;

function normalizeTag(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return '';
  return '#' + cleaned;
}

// Harvest hashtag tokens from Pinterest pin titles/descriptions.
async function harvestFromPinterest(topic: string, want: number): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const { results } = await searchPinterest(topic, Math.max(want, 20));
    for (const pin of results) {
      const blob = `${pin.title} ${pin.description ?? ''}`;
      let m: RegExpExecArray | null;
      while ((m = HASHTAG_RX.exec(blob)) !== null) {
        const tag = normalizeTag(m[0]);
        if (!tag || tag.length < 3) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  } catch {
    // Pinterest failed — silent. Anthropic fallback picks up the slack.
  }
  return counts;
}

interface AnthropicHashtag {
  tag: string;
  reach_estimate?: string;
  rationale: string;
}

async function askLlm(
  topic: string,
  platform: string,
  count: number,
  seedTags: string[],
  signal: AbortSignal,
): Promise<AnthropicHashtag[]> {
  const seedHint = seedTags.length
    ? `Scraped hashtag seeds (may be noisy, filter and dedupe): ${seedTags.join(', ')}`
    : 'No scraped seeds available — propose from scratch.';

  const system = [
    'You are a social strategist for Radix Media (Dubai).',
    'Return ONLY a JSON array. No prose, no markdown fence.',
    'Each item: { "tag": "#exact", "reach_estimate": "high|medium|low|niche", "rationale": "one sentence" }.',
    'Mix broad, medium, and niche tags. Avoid banned/shadowbanned generics.',
    'Every tag starts with #, letters/digits/underscore only, no spaces.',
  ].join('\n');

  const user = [
    `Topic: ${topic}`,
    `Platform: ${platform}`,
    `Exactly ${count} hashtags.`,
    seedHint,
  ].join('\n');

  void signal; // chatText doesn't currently expose signal — fallback chain
  const resp = await chatText({
    max_tokens: 1500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const text = resp.text.trim();

  // Strip any accidental fence.
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    const out: AnthropicHashtag[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const tag = typeof rec.tag === 'string' ? normalizeTag(rec.tag) : '';
      const rationale = typeof rec.rationale === 'string' ? rec.rationale : '';
      const reach = typeof rec.reach_estimate === 'string' ? rec.reach_estimate : undefined;
      if (!tag || !rationale) continue;
      out.push({ tag, reach_estimate: reach, rationale });
    }
    return out;
  } catch {
    return [];
  }
}

export const tool = defineTool<Args, Result>({
  name: 'hashtag_research',
  description:
    'Research relevant hashtags for a topic+platform. Harvests Pinterest public search, then asks Anthropic to propose the final set with rationales.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      platform: { type: 'string' },
      count: { type: 'number', description: 'How many hashtags to return (default 12).' },
      clientId: { type: 'string', description: 'Optional — for future brand-aware filtering.' },
      postId: { type: 'string', description: 'Optional — when provided, merge tags into CalendarPost.hashtags.' },
    },
    required: ['topic', 'platform'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('aborted');
    const count = Math.min(Math.max(args.count ?? DEFAULT_COUNT, 1), 30);

    await ctx.emit('agent:thought', {
      text: `Researching hashtags for ${args.topic}…`,
      at: new Date().toISOString(),
    });

    // Phase 1 — live scrape.
    const harvested = await harvestFromPinterest(args.topic, count * 2);
    if (ctx.signal.aborted) throw new Error('aborted');

    const seedTags = [...harvested.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count * 2)
      .map(([t]) => t);

    await ctx.emit('agent:thought', {
      text: `Found ${seedTags.length} candidates.`,
      at: new Date().toISOString(),
    });

    // Phase 2 — Anthropic enrich/propose.
    const enriched = await askLlm(args.topic, args.platform, count, seedTags, ctx.signal);

    // Dedupe by lowercased tag, keep first occurrence.
    const seen = new Set<string>();
    const final: HashtagRec[] = [];
    for (const rec of enriched) {
      const key = rec.tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(rec);
      if (final.length >= count) break;
    }

    // If Anthropic returned nothing (rare), fall back to the raw harvest.
    if (final.length === 0 && seedTags.length > 0) {
      for (const tag of seedTags.slice(0, count)) {
        final.push({ tag, reach_estimate: 'unknown', rationale: 'Trending on Pinterest search for this topic.' });
      }
    }

    await ctx.emit('agent:thought', {
      text: `Returning ${final.length} hashtags.`,
      at: new Date().toISOString(),
    });

    // Persist back to the CalendarPost if postId is supplied AND the post
    // belongs to this session's client (defense in depth).  Merges with
    // whatever hashtags already live on the row, de-duped case-insensitively.
    let persistedPostId: string | undefined;
    let mergedTagCount: number | undefined;
    if (args.postId) {
      try {
        const row = await ctx.prisma.calendarPost.findUnique({
          where: { id: args.postId, orgId: ctx.orgId },
          select: { id: true, hashtags: true, calendarMonth: { select: { clientId: true } } },
        });
        if (row && (!ctx.clientId || row.calendarMonth?.clientId === ctx.clientId)) {
          const existing: string[] = Array.isArray(row.hashtags)
            ? (row.hashtags as unknown[]).filter((x): x is string => typeof x === 'string')
            : [];
          const seenLower = new Set(existing.map((t) => t.toLowerCase()));
          const merged: string[] = [...existing];
          for (const rec of final) {
            const key = rec.tag.toLowerCase();
            if (seenLower.has(key)) continue;
            seenLower.add(key);
            merged.push(rec.tag);
          }
          await ctx.prisma.calendarPost.update({
            where: { id: row.id, orgId: ctx.orgId },
            data: { hashtags: merged },
          });
          persistedPostId = row.id;
          mergedTagCount = merged.length;
          await ctx.emit('agent:artifact', {
            path: `post/${row.id}`,
            mimeType: 'application/x-radix-post',
            preview: merged.join(' '),
            at: new Date().toISOString(),
          });
          await ctx.emit('agent:thought', {
            text: `Merged ${final.length} hashtags into post ${row.id} (now ${merged.length} total).`,
            at: new Date().toISOString(),
          });
        }
      } catch (err) {
        await ctx.emit('agent:thought', {
          text: `Hashtag merge failed: ${err instanceof Error ? err.message : String(err)}`,
          at: new Date().toISOString(),
        });
      }
    }

    return { hashtags: final, persistedPostId, mergedTagCount };
  },
});
