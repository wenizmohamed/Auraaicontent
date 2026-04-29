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

export interface VisualSearchResult {
  thumbnailUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: 'pinterest' | 'web' | 'manual' | 'placeholder';
  title?: string;
  description?: string;
  pinId?: string;
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
  ): Promise<{ results: VisualSearchResult[]; provider: string }> {
    const safeCount = Math.max(1, Math.min(20, count));
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      return { results: [], provider: 'noop' };
    }

    const merged: VisualSearchResult[] = [];
    let providerLabel = '';

    // 1. Wikimedia Commons — reliable, free, real thumbnails
    try {
      const wikiResults = await searchWikimedia(trimmedQuery, safeCount);
      for (const r of wikiResults) {
        if (merged.length >= safeCount) break;
        merged.push(r);
      }
      if (merged.length > 0) providerLabel = 'wikimedia';
    } catch (err: any) {
      console.warn('[visualSearch] Wikimedia failed:', err?.message || err);
    }

    // 2. Pinterest — supplement if Wikimedia came up short
    if (merged.length < safeCount) {
      try {
        const { results: pins } = await searchPinterest(trimmedQuery, safeCount - merged.length);
        for (const p of pins) {
          if (merged.length >= safeCount) break;
          merged.push(pinterestToVisualRef(p));
        }
        if (pins.length > 0) providerLabel = providerLabel ? `${providerLabel}+pinterest` : 'pinterest';
      } catch (err: any) {
        // Pinterest scraper may be blocked — this is expected
      }
    }

    // 3. AI router fallback if still short
    if (merged.length < safeCount) {
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
        const result = await aiRouter.text({ prompt, json: true });
        const aiResults = normalizeAiResult(result.output, trimmedQuery);
        for (const r of aiResults) {
          if (merged.length >= safeCount) break;
          // Skip if we already have a result with the same sourceUrl
          if (merged.some(m => m.sourceUrl === r.sourceUrl)) continue;
          merged.push(r);
        }
        if (aiResults.length > 0) {
          providerLabel = providerLabel ? `${providerLabel}+${result.provider}` : result.provider;
        }
      } catch (err: any) {
        console.warn('[visualSearch] AI fallback failed:', err?.message || err);
      }
    }

    // 3. Placeholder top-up — always reach safeCount
    let placeholderIndex = 0;
    const before = merged.length;
    while (merged.length < safeCount) {
      merged.push(placeholderResult(trimmedQuery, placeholderIndex++));
    }
    if (merged.length > before) {
      providerLabel = providerLabel ? `${providerLabel}+placeholder` : 'placeholder';
    }

    return { results: merged, provider: providerLabel || 'placeholder' };
  },
};
