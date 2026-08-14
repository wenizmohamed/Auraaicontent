// Source verification (Habiba feedback 2026-07-14): "some research source
// links are incorrect or not relevant". Research sources were model-emitted
// (and the prompt even invited inventing them), so many 404'd or didn't exist.
//
// This checks each URL is (a) a well-formed http(s) URL and (b) actually
// reachable, then marks it verified/unverified. Dead links are dropped by
// default so the user never sees a broken citation. Best-effort + bounded:
// short timeout, capped concurrency, never throws.

export interface RawSource { title: string; url: string; snippet?: string }
export interface VerifiedSource extends RawSource { verified: boolean }

async function checkOne(url: string, timeoutMs: number): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch { return false; }

  // HEAD first (cheap); some servers reject HEAD → fall back to a ranged GET.
  const attempt = async (method: 'HEAD' | 'GET'): Promise<number | null> => {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AURAAIBot/1.0)', ...(method === 'GET' ? { Range: 'bytes=0-1024' } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.status;
    } catch { return null; }
  };

  let status = await attempt('HEAD');
  if (status === null || status === 405 || status === 501 || status === 403) status = await attempt('GET');
  if (status === null) return false;
  // Treat 2xx/3xx as live. 401/403 = exists-but-gated (keep — real URL). 404/410/5xx = drop.
  return (status >= 200 && status < 400) || status === 401 || status === 403;
}

/** Verify sources concurrently. dropDead (default true) removes unreachable
 *  URLs entirely; otherwise they're returned with verified=false so the UI can
 *  mark them. */
export async function verifySources(
  sources: RawSource[],
  opts: { timeoutMs?: number; concurrency?: number; dropDead?: boolean } = {},
): Promise<VerifiedSource[]> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const concurrency = opts.concurrency ?? 5;
  const dropDead = opts.dropDead !== false;
  if (!Array.isArray(sources) || sources.length === 0) return [];

  const out: VerifiedSource[] = [];
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const checks = await Promise.all(batch.map(async (s) => ({ ...s, verified: await checkOne(s.url, timeoutMs) })));
    out.push(...checks);
  }
  return dropDead ? out.filter((s) => s.verified) : out;
}
