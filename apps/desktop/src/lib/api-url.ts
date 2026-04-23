// Central API URL resolver.  Every file that builds a fetch() URL or a
// Socket.IO URL MUST import from here — no inline `??'http://127.0.0.1:8080'`
// fallbacks.  The previous ad-hoc pattern (see 7 files pre-2026-04-23) baked
// 127.0.0.1:8080 into production bundles, so the web build served from
// srv1494206.hstgr.cloud tried to open WebSockets to a loopback address on
// users' own machines → flood of ERR_CONNECTION_REFUSED.
//
// Resolution order:
//   1. VITE_API_URL at build time (if set, wins — Electron bundles override here)
//   2. window.electron.apiBaseUrl (Electron runtime hint)
//   3. localStorage 'radix_api_url' (cascade-fallback winner, persisted)
//   4. Same-origin when running in a browser served from a real host
//      (e.g. https://srv1494206.hstgr.cloud → '' → /api and /socket.io
//      resolve against the current origin, which nginx then proxies to :8080)
//   5. Dev / localhost / Electron-no-hint → http://127.0.0.1:8080

declare global {
  interface Window {
    electron?: { isDesktop?: boolean; apiBaseUrl?: string } | undefined;
  }
}

function detectBrowserOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  // localhost / 127.0.0.1 → fall through to the dev loopback (:8080)
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return null;
  // Real host (srv1494206.hstgr.cloud, custom domain, etc.) — use same-origin
  // so the nginx /api + /socket.io proxies handle everything.
  return window.location.origin;
}

export function resolveApiUrl(): string {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env && env.trim()) return env;

  if (typeof window !== 'undefined') {
    const electronUrl = window.electron?.apiBaseUrl;
    if (electronUrl) return electronUrl;

    try {
      const stored = window.localStorage.getItem('radix_api_url');
      if (stored) return stored;
    } catch { /* ignore */ }

    const origin = detectBrowserOrigin();
    if (origin) return origin;
  }

  return 'http://127.0.0.1:8080';
}

// One-shot resolution at module load — used by files that need a stable
// constant (Socket.IO singleton, API_URL const).  Runtime re-resolution via
// resolveApiUrl() is also safe.
export const API_URL: string = resolveApiUrl();
