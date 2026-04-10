// Pinterest scraper — uses Pinterest's public JSON endpoint (no API key required)
//
// Pinterest's own frontend hits /resource/BaseSearchResource/get/ with unauthenticated requests.
// This service replicates those calls to fetch image URLs from public search results.
//
// Mirrors the local Claude's commit bb6ae31 (Windows v2-migration). Same shape, same routes.
// Verified working from VPS network with the request shape below.
//
// Legal note: scrapes only public search data (the same data anyone can see in a browser).
// No login, no paywall, no private data. For production use, consider rate limiting + caching.

export interface PinterestImage {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  pinUrl: string;
  dominantColor?: string;
  tags?: string[];
}

interface RawPinResult {
  id: string;
  title?: string;
  description?: string;
  grid_title?: string;
  images?: {
    orig?: { url: string; width: number; height: number };
    '474x'?: { url: string; width: number; height: number };
    '236x'?: { url: string; width: number; height: number };
    '170x'?: { url: string; width: number; height: number };
  };
  dominant_color?: string;
  pin_join?: { visual_descriptions?: string[] };
}

const PINTEREST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  'X-APP-VERSION': '4c8c873',
  'X-Pinterest-AppState': 'active',
  'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
  'Origin': 'https://www.pinterest.com',
};

function buildSearchUrl(query: string, bookmark?: string): string {
  const options: Record<string, any> = {
    query,
    scope: 'pins',
    page_size: 25,
    field_set_key: 'unauth_react_main_pin',
    no_fetch_context_on_resource: false,
  };
  if (bookmark) options.bookmarks = [bookmark];
  const data = JSON.stringify({ options, context: {} });
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
  const params = new URLSearchParams({
    source_url: sourceUrl,
    data,
    _: String(Date.now()),
  });
  return `https://www.pinterest.com/resource/BaseSearchResource/get/?${params.toString()}`;
}

function normalize(raw: RawPinResult): PinterestImage | null {
  if (!raw || !raw.id) return null;
  const orig = raw.images?.orig;
  if (!orig?.url) return null;
  const thumb = raw.images?.['474x']?.url || raw.images?.['236x']?.url || orig.url;
  return {
    id: String(raw.id),
    title: raw.title || raw.grid_title || '',
    description: raw.description || raw.pin_join?.visual_descriptions?.[0] || undefined,
    imageUrl: orig.url,
    thumbUrl: thumb,
    width: orig.width,
    height: orig.height,
    pinUrl: `https://www.pinterest.com/pin/${raw.id}/`,
    dominantColor: raw.dominant_color,
    tags: [],
  };
}

export async function searchPinterest(
  query: string,
  limit: number = 12,
  bookmark?: string,
): Promise<{ results: PinterestImage[]; nextBookmark: string | null }> {
  const url = buildSearchUrl(query, bookmark);
  const headers = {
    ...PINTEREST_HEADERS,
    'Referer': `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
    'X-Pinterest-Source-Url': `/search/pins/?q=${encodeURIComponent(query)}`,
  };

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`Pinterest returned ${res.status}: ${res.statusText}`);
  }
  const json: any = await res.json();
  const rawResults: RawPinResult[] = json?.resource_response?.data?.results || [];
  const results = rawResults
    .map(normalize)
    .filter((r): r is PinterestImage => r !== null)
    .slice(0, Math.max(1, Math.min(25, limit)));
  const nextBookmark = json?.resource_response?.bookmark || null;
  return { results, nextBookmark };
}

export async function searchPinterestMulti(
  queries: string[],
  perQuery: number = 6,
): Promise<PinterestImage[]> {
  const settled = await Promise.allSettled(
    queries.map(q => searchPinterest(q, perQuery)),
  );
  // Dedupe by id (queries may overlap)
  const seen = new Set<string>();
  const merged: PinterestImage[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
  }
  return merged;
}

export async function fetchPinterestImageBase64(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': PINTEREST_HEADERS['User-Agent'] },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Failed to fetch Pinterest image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}
