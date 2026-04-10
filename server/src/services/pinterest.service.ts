// Pinterest scraper — uses Pinterest's public JSON endpoint (no API key required)
// Pinterest's own frontend hits /resource/BaseSearchResource/get/ with unauthenticated requests.
// This service replicates those calls to fetch image URLs from public search results.
//
// Legal note: This scrapes only public search data (same as what anyone can see in a browser).
// No login, no paywall, no private data. For production use, consider rate limiting.

export interface PinterestImage {
  id: string;
  title: string;
  description: string;
  imageUrl: string;       // Full-resolution orig URL
  thumbUrl: string;       // 474x thumbnail for fast loading
  width: number;
  height: number;
  pinUrl: string;         // Link back to pin on Pinterest
  dominantColor?: string;
  tags: string[];
}

interface PinterestRawResult {
  id: string;
  title?: string;
  description?: string;
  grid_title?: string;
  dominant_color?: string;
  rich_summary?: { display_name?: string };
  images?: {
    orig?: { url: string; width: number; height: number };
    '736x'?: { url: string; width: number; height: number };
    '474x'?: { url: string; width: number; height: number };
    '236x'?: { url: string; width: number; height: number };
  };
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Search Pinterest for public pins matching a query.
 * @param query Search term (e.g. "luxury villa dubai")
 * @param limit Max results to return (default 12, max ~25 per request)
 * @param bookmark Pagination token from previous response (optional)
 */
export async function searchPinterest(
  query: string,
  limit: number = 12,
  bookmark?: string,
): Promise<{ results: PinterestImage[]; nextBookmark?: string }> {
  const data = {
    options: {
      query,
      scope: 'pins',
      ...(bookmark ? { bookmarks: [bookmark] } : {}),
    },
    context: {},
  };

  const url = new URL('https://www.pinterest.com/resource/BaseSearchResource/get/');
  url.searchParams.set('source_url', `/search/pins/?q=${encodeURIComponent(query)}`);
  url.searchParams.set('data', JSON.stringify(data));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': pickUserAgent(),
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Pinterest-AppState': 'active',
        'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Pinterest returned ${res.status}`);
    }

    const json = await res.json() as any;
    const rawResults: PinterestRawResult[] = json?.resource_response?.data?.results || [];
    const nextBookmark = json?.resource_response?.bookmark;

    const results: PinterestImage[] = rawResults
      .filter(r => r.images?.orig?.url)
      .slice(0, limit)
      .map(r => {
        const orig = r.images!.orig!;
        const thumb = r.images?.['474x'] || r.images?.['236x'] || orig;
        return {
          id: r.id,
          title: r.title || r.grid_title || '',
          description: r.description || r.rich_summary?.display_name || '',
          imageUrl: orig.url,
          thumbUrl: thumb.url,
          width: orig.width,
          height: orig.height,
          pinUrl: `https://www.pinterest.com/pin/${r.id}/`,
          dominantColor: r.dominant_color,
          tags: [],
        };
      });

    return { results, nextBookmark };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search multiple queries in parallel and deduplicate by image URL.
 * Useful when AI generates several keyword sets for a single visual idea.
 */
export async function searchPinterestMulti(
  queries: string[],
  perQuery: number = 6,
): Promise<PinterestImage[]> {
  const batches = await Promise.allSettled(
    queries.map(q => searchPinterest(q, perQuery)),
  );

  const seen = new Set<string>();
  const results: PinterestImage[] = [];

  for (const batch of batches) {
    if (batch.status !== 'fulfilled') continue;
    for (const img of batch.value.results) {
      if (seen.has(img.imageUrl)) continue;
      seen.add(img.imageUrl);
      results.push(img);
    }
  }

  return results;
}

/**
 * Download a Pinterest image and return base64 data URL.
 * Useful for caching or embedding in exports.
 */
export async function fetchPinterestImageBase64(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': pickUserAgent(), 'Referer': 'https://www.pinterest.com/' },
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  const mime = res.headers.get('content-type') || 'image/jpeg';
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}
