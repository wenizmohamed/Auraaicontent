import { safeFetch } from '../lib/safe-fetch.js';

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

  // These URLs come from a model, so the request goes through safeFetch: it
  // refuses private, loopback and cloud-metadata addresses at connect time and
  // re-checks every redirect (2026-11-14 access audit: this used raw fetch).
  try {
    const r = await safeFetch(parsed.toString(), { timeoutMs, maxBytes: 2 * 1024 * 1024, accept: 'text/html,*/*' });
    // 2xx/3xx = live; 401/403 = exists but gated (keep, it is a real URL).
    return (r.status >= 200 && r.status < 400) || r.status === 401 || r.status === 403;
  } catch (e) {
    // A page too big to read in full still exists; anything else is dead or refused.
    return /Response (too large|exceeded)/.test(String((e as Error)?.message || ''));
  }
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
