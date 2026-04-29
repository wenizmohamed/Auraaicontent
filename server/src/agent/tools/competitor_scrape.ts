import { defineTool } from '../tool-types.js';
import { aiRouter } from '../../services/providers/ai-router.js';

type Platform = 'instagram' | 'tiktok' | 'linkedin';

interface Args {
  handles: string[];
  platform: Platform;
  limit?: number;
}

interface RecentPost {
  caption: string;
  date?: string;
  engagement?: string;
  url?: string;
  inferred?: boolean;
}

interface HandleResult {
  handle: string;
  platform: Platform;
  recentPosts: RecentPost[];
  source: 'scrape' | 'inferred' | 'mixed';
  note?: string;
}

interface Result {
  handles: HandleResult[];
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('AbortError: competitor_scrape cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

function cleanHandle(h: string): string {
  return h.trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '');
}

async function fetchText(url: string, signal: AbortSignal, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function extractInstagramPosts(html: string, limit: number, handle: string): RecentPost[] {
  const posts: RecentPost[] = [];
  const seen = new Set<string>();

  // Captions embedded in og:description-style meta tags + inline JSON.
  const captionRe = /"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"/g;
  const shortcodeRe = /"shortcode":"([A-Za-z0-9_-]{5,})"/g;
  const captions: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = captionRe.exec(html)) && captions.length < limit) {
    try {
      captions.push(JSON.parse(`"${m[1]}"`));
    } catch {
      captions.push(m[1].slice(0, 400));
    }
  }
  const shortcodes: string[] = [];
  while ((m = shortcodeRe.exec(html)) && shortcodes.length < limit * 2) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      shortcodes.push(m[1]);
    }
  }

  for (let i = 0; i < Math.max(captions.length, shortcodes.length) && posts.length < limit; i++) {
    const caption = captions[i] || '';
    const shortcode = shortcodes[i];
    if (!caption && !shortcode) continue;
    posts.push({
      caption: caption.slice(0, 400) || `(no caption) — post by @${handle}`,
      url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined,
    });
  }
  return posts;
}

async function scrapeInstagram(
  handle: string,
  limit: number,
  signal: AbortSignal,
): Promise<RecentPost[]> {
  const html = await fetchText(`https://www.instagram.com/${handle}/`, signal);
  if (!html) return [];
  return extractInstagramPosts(html, limit, handle);
}

async function scrapeTikTok(
  handle: string,
  limit: number,
  signal: AbortSignal,
): Promise<RecentPost[]> {
  const html = await fetchText(`https://www.tiktok.com/@${handle}`, signal);
  if (!html) return [];
  const posts: RecentPost[] = [];
  const descRe = /"desc":"((?:[^"\\]|\\.)*?)"/g;
  const idRe = /"video":\{"id":"(\d{15,})"/g;
  const descs: string[] = [];
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = descRe.exec(html)) && descs.length < limit) {
    try {
      descs.push(JSON.parse(`"${m[1]}"`));
    } catch {
      descs.push(m[1].slice(0, 400));
    }
  }
  while ((m = idRe.exec(html)) && ids.length < limit) ids.push(m[1]);
  for (let i = 0; i < Math.max(descs.length, ids.length) && posts.length < limit; i++) {
    posts.push({
      caption: (descs[i] || '').slice(0, 400),
      url: ids[i] ? `https://www.tiktok.com/@${handle}/video/${ids[i]}` : undefined,
    });
  }
  return posts;
}

async function scrapeLinkedIn(
  handle: string,
  _limit: number,
  _signal: AbortSignal,
): Promise<RecentPost[]> {
  // LinkedIn aggressively blocks unauthenticated scrapes — go straight to inferred.
  return [];
}

async function inferPosts(
  handle: string,
  platform: Platform,
  limit: number,
  signal: AbortSignal,
): Promise<RecentPost[]> {
  const prompt =
    `You are a social-media analyst. Describe the typical recent posting pattern for ` +
    `@${handle} on ${platform}. Return JSON {"posts":[{"caption":"...","engagement":"..."}]} ` +
    `with ${limit} entries reflecting their known content pillars, hook style, and hashtag ` +
    `conventions. If the account is unknown, return posts:[] — do not fabricate specifics.`;
  try {
    const res = await aiRouter.text({ prompt, json: true, temperature: 0.4 });
    if (signal.aborted) return [];
    const out = res.output as { posts?: { caption?: string; engagement?: string }[] };
    const arr = Array.isArray(out?.posts) ? out.posts : [];
    return arr.slice(0, limit).map((p) => ({
      caption: (p.caption || '').slice(0, 400),
      engagement: p.engagement,
      inferred: true,
    }));
  } catch {
    return [];
  }
}

export const tool = defineTool<Args, Result>({
  name: 'competitor_scrape',
  description:
    'Scrape recent posts for competitor handles on Instagram/TikTok/LinkedIn. ' +
    'Falls back to AI-inferred posting patterns (marked inferred:true) when scraping fails. ' +
    'Never fabricates specific post content silently — inferred results are clearly flagged.',
  input_schema: {
    type: 'object',
    properties: {
      handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Account handles (with or without @)',
      },
      platform: { type: 'string', enum: ['instagram', 'tiktok', 'linkedin'] },
      limit: { type: 'number', description: 'Posts per handle (default 10)' },
    },
    required: ['handles', 'platform'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    checkAbort(ctx.signal);
    const limit = Math.max(1, Math.min(args.limit ?? 10, 30));
    const out: HandleResult[] = [];

    for (const raw of args.handles) {
      checkAbort(ctx.signal);
      const handle = cleanHandle(raw);
      if (!handle) continue;

      await ctx.emit('agent:thought', {
        text: `Scraping @${handle} on ${args.platform}…`,
        at: new Date().toISOString(),
      });

      let scraped: RecentPost[] = [];
      try {
        if (args.platform === 'instagram') scraped = await scrapeInstagram(handle, limit, ctx.signal);
        else if (args.platform === 'tiktok') scraped = await scrapeTikTok(handle, limit, ctx.signal);
        else if (args.platform === 'linkedin') scraped = await scrapeLinkedIn(handle, limit, ctx.signal);
      } catch {
        scraped = [];
      }

      let posts = scraped;
      let source: HandleResult['source'] = 'scrape';
      let note: string | undefined;

      if (posts.length === 0) {
        const inferred = await inferPosts(handle, args.platform, limit, ctx.signal);
        posts = inferred;
        source = 'inferred';
        note =
          'Live scrape blocked or returned empty — these are AI-inferred posting patterns, ' +
          'not verified posts.';
      } else if (posts.length < limit) {
        const extra = await inferPosts(handle, args.platform, limit - posts.length, ctx.signal);
        if (extra.length > 0) {
          posts = posts.concat(extra);
          source = 'mixed';
          note = `${scraped.length} scraped + ${extra.length} AI-inferred.`;
        }
      }

      out.push({ handle, platform: args.platform, recentPosts: posts, source, note });
    }

    return { handles: out };
  },
});
