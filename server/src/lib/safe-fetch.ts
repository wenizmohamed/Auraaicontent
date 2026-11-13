// Server-side GET for URLs that come from a user or a model.
//
// Agent tools (image_edit, brand_memory_save) and the upscaler fetch URLs the
// caller supplies. Without a guard that is a server-side request forgery
// hole: the URL can point at the API's own routes (it listens on 0.0.0.0:8080),
// Redis, Postgres, or the cloud metadata service, and the response comes back
// into the model's context.
//
// A hostname check alone is not enough, and the first version of these tools
// shipped with only that (2026-11-13). Each of these got through it:
//   - a public URL that 302s to http://127.0.0.1:8080/   (redirects followed)
//   - a DNS name that resolves to 127.0.0.1               (nip.io, rebinding)
//   - [::1], [::ffff:127.0.0.1], fd00::/8                 (IPv6 forms)
//   - an unbounded body                                    (memory DoS)
//
// So this module:
//   - allows http(s) on ports 80 and 443 only,
//   - checks the ADDRESS, not the name, at connect time (the `lookup` hook
//     runs inside the socket connect, so there is no gap between check and use),
//   - follows at most 3 redirects and re-checks every hop,
//   - caps the body size and the total time.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export class UnsafeUrlError extends Error {
  statusCode = 400;
}

const BLOCKED = new net.BlockList();
// IPv4: this-network, private, CGNAT, loopback, link-local (cloud metadata),
// IETF protocol + documentation ranges, benchmarking, multicast, reserved.
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net4, prefix, 'ipv4');
// IPv6: unspecified, loopback, NAT64 (reaches IPv4 space), unique-local,
// link-local, multicast, documentation.
// NOT ::ffff:0:0/96: BlockList checks IPv4 addresses against IPv6 rules as
// IPv4-mapped addresses, so that rule blocks EVERY IPv4 address. It already
// maps ::ffff:a.b.c.d onto the IPv4 rules above, so mapped loopback and
// private addresses stay blocked without it (pinned in safe-fetch.spec.ts).
for (const [net6, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) BLOCKED.addSubnet(net6, prefix, 'ipv6');

/** True when this IP literal is one the server must never connect to. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED.check(ip, 'ipv4');
  if (family === 6) return BLOCKED.check(ip, 'ipv6');
  return true; // not an IP at all
}

// Resolve, then refuse if ANY answer is blocked: a name that resolves to one
// public and one private address is still a way in.
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return (callback as any)(new UnsafeUrlError(`Refusing to connect to a private address for ${hostname}`));
    }
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

/** Validate the shape of a URL before any network work. */
export function assertFetchableUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only http(s) URLs are allowed');
  if (u.username || u.password) throw new UnsafeUrlError('URLs with credentials are not allowed');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new UnsafeUrlError('Only ports 80 and 443 are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // An IP literal skips DNS, so the connect-time lookup never sees it. Check here.
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError('URL host is not permitted');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new UnsafeUrlError('URL host is not permitted');
  return u;
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  /** Hard cap on the response body. Default 20 MB. */
  maxBytes?: number;
  /** Whole-request budget including redirects. Default 20 s. */
  timeoutMs?: number;
  accept?: string;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  url: string;
}

const MAX_REDIRECTS = 3;

function getOnce(u: URL, opts: Required<Pick<SafeFetchOptions, 'maxBytes' | 'accept'>>, signal: AbortSignal): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'GET',
      lookup: guardedLookup,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuraContentBot/1.0)', Accept: opts.accept },
      signal,
    }, (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: String(res.headers.location), contentType, body: Buffer.alloc(0) });
      }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > opts.maxBytes) {
        res.destroy();
        return reject(new UnsafeUrlError(`Response too large (${declared} bytes)`));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > opts.maxBytes) {
          res.destroy();
          reject(new UnsafeUrlError(`Response exceeded ${opts.maxBytes} bytes`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET a caller-supplied URL safely. Throws UnsafeUrlError when the URL, any
 * redirect hop, or any resolved address is not a public http(s) endpoint.
 * Non-2xx final responses are returned (status set), not thrown.
 */
export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const accept = options.accept ?? '*/*';
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  let u = assertFetchableUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await getOnce(u, { maxBytes, accept }, signal);
    if (!r.location) return { status: r.status, contentType: r.contentType, body: r.body, url: u.toString() };
    u = assertFetchableUrl(new URL(r.location, u).toString());
  }
  throw new UnsafeUrlError('Too many redirects');
}
