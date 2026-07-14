// Visual reference search service
//
// Strategy (highest quality first):
//   1. Pinterest scraper — real thumbnails from Pinterest's public JSON endpoint
//   2. AI router (text + JSON mode) — model invents plausible refs (legacy fallback)
//   3. Deterministic placeholders from picsum.photos (always-works last resort)
//
// The function NEVER throws — provider failures fall back through the chain.

import crypto from 'crypto';
import { aiRouter } from './providers/ai-router.js';
import { searchPinterest, type PinterestImage } from './pinterest.service.js';
import { db } from '../db/prisma.js';

// ─── Wikimedia Commons search ────────────────────────────────────

interface WikiPage { title: string; imageinfo?: { url: string; thumburl: string; descriptionurl: string; extmetadata?: { ImageDescription?: { value: string }; Categories?: { value: string } } }[] }

async function searchWikimedia(query: string, limit: number): Promise<VisualSearchResult[]> {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query,
    gsrnamespace: '6', gsrlimit: String(Math.min(limit, 20)),
    prop: 'imageinfo', iiprop: 'url|extmetadata',
    iiurlwidth: '600', format: 'json', origin: '*',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  const pages: WikiPage[] = Object.values(data?.query?.pages || {});
  return pages
    .filter(p => p.imageinfo?.[0]?.thumburl)
    .map(p => {
      const ii = p.imageinfo![0];
      const desc = ii.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g, '').slice(0, 200) || p.title.replace('File:', '');
      return {
        thumbnailUrl: ii.thumburl,
        sourceUrl: ii.descriptionurl || ii.url,
        sourceDomain: 'commons.wikimedia.org',
        sourceType: 'web' as const,
        title: p.title.replace('File:', '').replace(/\.[^.]+$/, ''),
        description: desc,
      };
    });
}

// ─── Openverse (CC-licensed images, no API key) ──────────────────

async function searchOpenverse(query: string, limit: number): Promise<VisualSearchResult[]> {
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${Math.min(limit, 20)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.results || [])
      .filter((r: any) => r.thumbnail || r.url)
      .map((r: any) => ({
        thumbnailUrl: r.thumbnail || r.url,
        sourceUrl: r.foreign_landing_url || r.url,
        sourceDomain: (() => { try { return new URL(r.foreign_landing_url || r.url).hostname.replace(/^www\./, ''); } catch { return 'openverse.org'; } })(),
        sourceType: 'web' as const,
        title: r.title || undefined,
        description: r.creator ? `By ${r.creator}` : undefined,
      }));
  } catch { return []; }
}

// ─── DuckDuckGo Images (taps Bing index, no API key) ─────────────
// Used twice: once as generic image search, once filtered to pinterest.com
// since Pinterest's own scraper endpoint is CSRF-blocked.

async function searchDuckDuckGo(query: string, limit: number, sourceLabel?: string): Promise<VisualSearchResult[]> {
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000),
    });
    if (!tokenRes.ok) return [];
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=['"]?([\w-]+)/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    const imgRes = await fetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${vqd}&p=-1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Referer': 'https://duckduckgo.com/' },
      signal: AbortSignal.timeout(8000),
    });
    if (!imgRes.ok) return [];
    const data: any = await imgRes.json();
    return (data?.results || [])
      .slice(0, limit)
      .filter((r: any) => r.thumbnail && r.image)
      .map((r: any) => {
        const isPin = r.image?.includes('pinimg.com') || r.url?.includes('pinterest.com');
        const domain = isPin ? 'pinterest.com' : (r.source || (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } })());
        return {
          thumbnailUrl: r.thumbnail,
          sourceUrl: r.url,
          sourceDomain: domain,
          sourceType: (isPin ? 'pinterest' : 'web') as 'pinterest' | 'web',
          title: r.title || undefined,
          description: sourceLabel ? `From ${sourceLabel}` : (r.source ? `Found on ${r.source}` : undefined),
        };
      });
  } catch { return []; }
}

// Pinterest results — real pinimg.com images via DDG site:pinterest.com filter.
// Pinterest's native scraper is CSRF-blocked, this is the only working channel.
async function searchPinterestViaDDG(query: string, limit: number): Promise<VisualSearchResult[]> {
  return searchDuckDuckGo(`${query} site:pinterest.com`, limit, 'Pinterest');
}

// Pinterest via Firecrawl image search — real pin URLs + titles + dimensions.
// Costs 2 credits per call. Falls through silently when key not set or fails,
// letting DDG handle the slot for free.
async function searchPinterestViaFirecrawl(query: string, limit: number): Promise<VisualSearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        query: `${query} site:pinterest.com`,
        sources: ['images'],
        limit: Math.min(limit, 10),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const images = data?.data?.images || [];
    return images
      .filter((r: any) => r.imageUrl && r.imageUrl.includes('pinimg.com'))
      .map((r: any) => ({
        thumbnailUrl: r.imageUrl,
        sourceUrl: r.url,
        sourceDomain: 'pinterest.com',
        sourceType: 'pinterest' as const,
        title: r.title || undefined,
        description: r.imageWidth && r.imageHeight ? `${r.imageWidth}×${r.imageHeight}` : undefined,
      }));
  } catch { return []; }
}

export interface VisualSearchResult {
  thumbnailUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: 'pinterest' | 'web' | 'manual' | 'placeholder' | 'internal';
  title?: string;
  description?: string;
  pinId?: string;
}

// ─── Internal lane (Tamer, 2026-07-14): previously-approved client assets +
// past successful generations as reference material. "Brand libraries /
// previous approved assets" — grounds refs in the client's OWN work, which
// no external source can. Best-effort; never throws.
async function searchInternalAssets(orgId: string, clientId: string, query: string, limit: number): Promise<VisualSearchResult[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6);
  try {
    const [assets, gens] = await Promise.all([
      db.asset.findMany({
        where: {
          orgId, clientId, mimeType: { startsWith: 'image/' },
          // tags is Json (not a scalar array) so we match on name; no terms →
          // fall back to most-recent approved assets.
          ...(terms.length ? { OR: terms.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })) } : {}),
        },
        select: { fileUrl: true, thumbUrl: true, name: true },
        orderBy: { createdAt: 'desc' }, take: limit,
      }).catch(() => []),
      db.generation.findMany({
        where: { orgId, clientId, type: 'image', status: 'succeeded', outputUrl: { not: null } },
        select: { outputUrl: true, thumbnailUrl: true, prompt: true },
        orderBy: { createdAt: 'desc' }, take: limit,
      }).catch(() => []),
    ]);
    const out: VisualSearchResult[] = [];
    for (const a of assets) {
      const url = a.thumbUrl || a.fileUrl;
      if (url) out.push({ thumbnailUrl: url, sourceUrl: a.fileUrl, sourceDomain: 'radix (approved asset)', sourceType: 'internal', title: a.name || undefined, description: 'Your approved brand asset' });
    }
    for (const g of gens) {
      const url = g.thumbnailUrl || g.outputUrl;
      if (url) out.push({ thumbnailUrl: url, sourceUrl: g.outputUrl!, sourceDomain: 'radix (past generation)', sourceType: 'internal', title: (g.prompt || '').slice(0, 60) || undefined, description: 'Previously generated for this client' });
    }
    return out.slice(0, limit);
  } catch { return []; }
}

function hashSeed(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function placeholderResult(query: string, index: number): VisualSearchResult {
  const seed = hashSeed(`${query}-${index}`);
  const url = `https://picsum.photos/seed/${seed}/600/400`;
  return {
    thumbnailUrl: url,
    sourceUrl: url,
    sourceDomain: 'picsum.photos',
    sourceType: 'placeholder',
    title: `Inspiration #${index + 1}`,
    description: query,
  };
}

function safeDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function classifyDomain(domain: string): VisualSearchResult['sourceType'] {
  if (domain.includes('pinterest')) return 'pinterest';
  return 'web';
}

function isHttpUrl(value: any): boolean {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value);
}

function pinterestToVisualRef(p: PinterestImage): VisualSearchResult {
  return {
    thumbnailUrl: p.thumbUrl || p.imageUrl,
    sourceUrl: p.pinUrl,
    sourceDomain: 'pinterest.com',
    sourceType: 'pinterest',
    title: p.title || undefined,
    description: p.description,
    pinId: p.id,
  };
}

function normalizeAiResult(raw: any, query: string): VisualSearchResult[] {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (Array.isArray(raw?.results)) arr = raw.results;
  else if (Array.isArray(raw?.items)) arr = raw.items;
  else if (Array.isArray(raw?.references)) arr = raw.references;

  const out: VisualSearchResult[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const thumb = r.thumbnailUrl || r.thumbnail || r.imageUrl || r.image;
    const src = r.sourceUrl || r.source || r.url || r.pageUrl;
    if (!isHttpUrl(thumb) || !isHttpUrl(src)) continue;
    const domain = r.sourceDomain || safeDomain(src);
    out.push({
      thumbnailUrl: thumb,
      sourceUrl: src,
      sourceDomain: domain,
      sourceType: classifyDomain(domain),
      title: typeof r.title === 'string' ? r.title.slice(0, 200) : undefined,
      description: typeof r.description === 'string' ? r.description.slice(0, 500) : query,
      pinId: typeof r.pinId === 'string' ? r.pinId : undefined,
    });
  }
  return out;
}

export const visualSearchService = {
  async search(
    query: string,
    count: number = 8,
    meta?: { orgId?: string; userId?: string; clientId?: string; jobId?: string; format?: string },
  ): Promise<{ results: VisualSearchResult[]; provider: string }> {
    const safeCount = Math.max(1, Math.min(20, count));
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      return { results: [], provider: 'noop' };
    }

    // Dri (2026-07-14): motion references for video/reel posts, not stills.
    const isMotion = /reel|video|animation|motion|gif/i.test(meta?.format || '');

    // Strategy: half from Pinterest (designer-aesthetic), half from
    // "various" (Bing/DDG, Openverse/Flickr, Wikimedia) for diversity.
    // Pinterest's native scraper is CSRF-blocked → use DDG site:pinterest.com
    // filter which returns real pinimg.com images via Bing's index.
    const half = Math.ceil(safeCount / 2);

    // D1: bias the broad web search toward marketing/social aesthetics so results
    // read as ad/campaign creative rather than encyclopedic stock photos. For
    // motion posts, bias toward animation/motion-design references instead.
    const adQuery = isMotion
      ? `${trimmedQuery} motion design animation reel transition kinetic`
      : `${trimmedQuery} advertising campaign social media creative design`;

    // Tamer (2026-07-14): wider engine — add Behance + Dribbble design lanes
    // (via the existing free DDG site-filter pattern, no new API) + an INTERNAL
    // lane (client's approved assets + past generations) when clientId is known.
    const behanceQuery = `${trimmedQuery} ${isMotion ? 'motion animation' : 'campaign'} site:behance.net`;
    const dribbbleQuery = `${trimmedQuery} ${isMotion ? 'animation' : 'design'} site:dribbble.com`;

    // All sources fire in parallel. Pinterest path: Firecrawl (best quality,
    // costs 2 credits) → DDG site:pinterest.com (free, 4 results) as fallback.
    const [pinFcResult, pinDdgResult, ddgResult, behanceResult, dribbbleResult, openverseResult, wikiResult, internalResult] = await Promise.allSettled([
      searchPinterestViaFirecrawl(trimmedQuery, half),
      searchPinterestViaDDG(trimmedQuery, half),
      searchDuckDuckGo(adQuery, safeCount),
      searchDuckDuckGo(behanceQuery, half, 'Behance'),
      searchDuckDuckGo(dribbbleQuery, half, 'Dribbble'),
      searchOpenverse(trimmedQuery, safeCount),
      searchWikimedia(trimmedQuery, safeCount),
      (meta?.orgId && meta?.clientId) ? searchInternalAssets(meta.orgId, meta.clientId, trimmedQuery, half) : Promise.resolve([]),
    ]);
    const pinFc = pinFcResult.status === 'fulfilled' ? pinFcResult.value : [];
    const pinDdg = pinDdgResult.status === 'fulfilled' ? pinDdgResult.value : [];
    // Prefer Firecrawl results, fill remaining Pinterest slots from DDG
    const pin = [...pinFc, ...pinDdg.filter(d => !pinFc.some(f => f.thumbnailUrl === d.thumbnailUrl))];
    const ddgWeb = ddgResult.status === 'fulfilled' ? ddgResult.value : [];
    const behance = behanceResult.status === 'fulfilled' ? behanceResult.value : [];
    const dribbble = dribbbleResult.status === 'fulfilled' ? dribbbleResult.value : [];
    // Behance + Dribbble ride alongside the generic ad-web lane, design sources first.
    const ddg = [...behance, ...dribbble, ...ddgWeb];
    const openverse = openverseResult.status === 'fulfilled' ? openverseResult.value : [];
    const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : [];
    const internal = internalResult.status === 'fulfilled' ? internalResult.value : [];

    const merged: VisualSearchResult[] = [];
    const seen = new Set<string>();
    const tryAdd = (r: VisualSearchResult): boolean => {
      if (merged.length >= safeCount) return false;
      const key = r.thumbnailUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      merged.push(r);
      return true;
    };

    // First: the client's OWN approved assets / past generations (Tamer) — cap
    // at ~a third so external inspiration still dominates, but on-brand refs
    // lead. Nothing external can match the client's real brand material.
    const internalCap = Math.max(1, Math.floor(safeCount / 3));
    let internalTaken = 0;
    for (const r of internal) {
      if (internalTaken >= internalCap) break;
      if (tryAdd(r)) internalTaken++;
    }

    // Then: take up to `half` from Pinterest (highest aesthetic priority)
    let pinTaken = 0;
    for (const r of pin) {
      if (pinTaken >= half) break;
      if (tryAdd(r)) pinTaken++;
    }

    // Then: round-robin DDG (ad-biased web) → Openverse for the primary fill.
    // Wikimedia is demoted to backfill-only (D1) — its encyclopedic stock photos
    // were the main source of "random, non-marketing" references.
    const variousQueues = [ddg, openverse];
    let exhausted = 0;
    while (merged.length < safeCount && exhausted < variousQueues.length) {
      exhausted = 0;
      for (const q of variousQueues) {
        const next = q.shift();
        if (!next) { exhausted++; continue; }
        tryAdd(next);
        if (merged.length >= safeCount) break;
      }
    }

    // If Pinterest gave fewer than `half`, backfill from any leftover various
    while (merged.length < safeCount) {
      const next = ddg.shift() || openverse.shift() || wiki.shift();
      if (!next) break;
      tryAdd(next);
    }

    const usedSources = new Set(merged.map(r => r.sourceType === 'pinterest' ? 'pinterest' : r.sourceDomain));
    const providerLabel = Array.from(usedSources).join('+') || 'none';

    // 3. AI router fallback — DISABLED by default. The AI hallucinates URLs
    // (broken thumbnails, made-up sourceUrls) and adds 30-90s of latency per
    // search × parallel searches in the worker. Set VISUAL_SEARCH_AI_FALLBACK=1
    // to re-enable. Without this, generation is much faster and visuals are
    // real (Wikimedia) or honest placeholders.
    if (merged.length < safeCount && process.env.VISUAL_SEARCH_AI_FALLBACK === '1') {
      try {
        const need = safeCount - merged.length;
        const prompt = [
          `Find ${need} inspirational image references for this creative concept:`,
          `"${trimmedQuery}"`,
          ``,
          `Return a JSON object: { "results": [ { "thumbnailUrl", "sourceUrl", "sourceDomain", "title", "description" } ] }`,
          `Focus on Behance, Dribbble, Unsplash, and other design-inspiration sites.`,
          `thumbnailUrl must be a direct image URL, sourceUrl must be the page URL.`,
          `Return ONLY the JSON.`,
        ].join('\n');
        const result = await aiRouter.text({ prompt, json: true }, meta);
        const aiResults = normalizeAiResult(result.output, trimmedQuery);
        for (const r of aiResults) {
          if (merged.length >= safeCount) break;
          // Skip if we already have a result with the same sourceUrl
          if (merged.some(m => m.sourceUrl === r.sourceUrl)) continue;
          merged.push(r);
        }
      } catch (err: any) {
        console.warn('[visualSearch] AI fallback failed:', err?.message || err);
      }
    }

    // NO MORE placeholders. Picsum.photos random images were being saved as
    // "visual references" — completely unrelated to the query. The user
    // would rather have FEWER real refs than more fake ones. If all real
    // sources came up empty, return the empty array honestly.

    return { results: merged, provider: providerLabel || 'none' };
  },
};
