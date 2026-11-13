// The SSRF guard behind every server-side fetch of a caller-supplied URL
// (agent image_edit / brand_memory_save, the upscaler, competitor intel).
//
// The first version of the agent tools (2026-11-13) checked only the host
// NAME with a regex and followed redirects, so a public URL that 302s to
// 127.0.0.1:8080, a DNS name resolving to loopback, or an IPv6 literal all
// got through. These tests pin the ranges and the URL rules.

import { describe, it, expect, vi } from 'vitest';
import { isBlockedAddress, assertFetchableUrl, safeFetch, UnsafeUrlError } from '../src/lib/safe-fetch';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '0.1.2.3', '224.0.0.1', '255.255.255.255',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'fd00::1',
    'fc00::1', 'fe80::1', 'ff02::1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '142.250.74.110', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111'])(
    'allows public %s', (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it('treats a non-IP string as blocked', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
  });
});

describe('assertFetchableUrl', () => {
  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',          // 127.0.0.1 as a decimal integer
    'http://0x7f.0.0.1/',          // 127.0.0.1 in hex
    'http://localhost/',
    'http://api.localhost/',
    'https://example.com:8080/',   // only 80 / 443
    'http://example.com:6379/',
    'ftp://example.com/a.png',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(UnsafeUrlError);
  });

  it.each(['https://example.com/a.png', 'http://example.com/', 'https://example.com:443/x', 'http://8.8.8.8/'])(
    'accepts %s', (url) => {
      expect(assertFetchableUrl(url).toString()).toBeTruthy();
    },
  );
});

describe('safeFetch', () => {
  it('refuses a loopback IP literal before any network work', async () => {
    await expect(safeFetch('http://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a name that RESOLVES to a private address (checked at connect time)', async () => {
    const dns = await import('node:dns');
    const spy = vi.spyOn(dns.default, 'lookup').mockImplementation(((
      _host: string, _opts: unknown, cb: (err: Error | null, addrs: { address: string; family: number }[]) => void,
    ) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as any);
    try {
      await expect(safeFetch('http://rebind.example.com/', { timeoutMs: 5000 })).rejects.toBeInstanceOf(UnsafeUrlError);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses when ANY resolved address is private, even if one is public', async () => {
    const dns = await import('node:dns');
    const spy = vi.spyOn(dns.default, 'lookup').mockImplementation(((
      _host: string, _opts: unknown, cb: (err: Error | null, addrs: { address: string; family: number }[]) => void,
    ) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }])) as any);
    try {
      await expect(safeFetch('http://split.example.com/', { timeoutMs: 5000 })).rejects.toBeInstanceOf(UnsafeUrlError);
    } finally {
      spy.mockRestore();
    }
  });
});
