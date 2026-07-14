// Backend API client — connects desktop frontend to Fastify server
// Falls back to localStorage when server is unavailable
//
// Resolution order:
//   1. explicit VITE_API_URL build env (highest priority)
//   2. localStorage override (radix_api_url) — picked at runtime by the
//      cascade below when a candidate comes back healthy
//   3. desktop runtime → cascade [local, VPS] with 2s probe
//   4. dev mode → http://127.0.0.1:8080 (vite dev server proxy target)
//   5. prod web mode → '' (relative URL — nginx serves /api/* on the same host)
const PRODUCTION_VPS_URL = 'https://srv1494206.hstgr.cloud';

function computeCandidates(): string[] {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return [explicit];
  const stored = typeof window !== 'undefined' ? localStorage.getItem('radix_api_url') : null;
  const runtimeHint = typeof window !== 'undefined' && window.electron?.isDesktop
    ? window.electron.apiBaseUrl || null
    : null;
  const isDev = import.meta.env.DEV;
  const isElectron = typeof window !== 'undefined' && window.electron?.isDesktop;

  const list: string[] = [];
  if (stored) list.push(stored);
  if (runtimeHint) list.push(runtimeHint);
  if (isElectron || isDev) list.push('http://127.0.0.1:8080');
  if (isElectron) list.push(PRODUCTION_VPS_URL);
  if (!list.length) list.push(''); // prod web: same-origin
  return [...new Set(list)];
}

let API_URL: string = computeCandidates()[0] ?? '';

async function probeHealthy(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const base = url || window.location.origin;
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Cascade the candidate list: return the first URL whose /api/health responds
 * inside `timeoutMs`. Persist the winner to localStorage so subsequent launches
 * skip the probe. Called from isServerAvailable() at bootstrap.
 */
async function pickHealthyBackend(timeoutMs = 2000): Promise<string | null> {
  for (const candidate of computeCandidates()) {
    if (await probeHealthy(candidate, timeoutMs)) {
      API_URL = candidate;
      try { localStorage.setItem('radix_api_url', candidate); } catch {}
      return candidate;
    }
  }
  return null;
}

let authToken: string | null = localStorage.getItem('radix_auth_token');
let refreshToken: string | null = localStorage.getItem('radix_refresh_token');

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem('radix_auth_token', token);
  // New session → drop the previous user's verified-email cache until the
  // next /auth/me confirms who this token belongs to.
  localStorage.removeItem('radix_verified_email');
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (token) localStorage.setItem('radix_refresh_token', token);
  else localStorage.removeItem('radix_refresh_token');
}

export function clearAuthToken() {
  authToken = null;
  refreshToken = null;
  localStorage.removeItem('radix_auth_token');
  localStorage.removeItem('radix_refresh_token');
  // Verified-email cache (admin/team gates) must not outlive the session —
  // a stale value would grant the NEXT login's UI gates the OLD user's email.
  localStorage.removeItem('radix_verified_email');
}

// Signal back to the app that the session is done (refresh expired / reuse
// triggered global revocation).  ClientContext hooks listen for this and
// push the user to the login page.
type LogoutReason = 'refresh-expired' | 'refresh-reuse' | 'logout';
const logoutListeners = new Set<(reason: LogoutReason) => void>();
export function onForcedLogout(fn: (reason: LogoutReason) => void) {
  logoutListeners.add(fn);
  return () => logoutListeners.delete(fn);
}
function emitForcedLogout(reason: LogoutReason) {
  clearAuthToken();
  for (const fn of logoutListeners) {
    try { fn(reason); } catch { /* listener isolation */ }
  }
}

// Refresh rotation — in-flight de-dup so a burst of parallel 401s only
// triggers ONE /auth/refresh round-trip.  Subsequent requests await the
// same promise and then retry with the fresh access token.
let refreshInFlight: Promise<boolean> | null = null;
async function rotateRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.requireLogin) {
          emitForcedLogout(body.error?.includes('reuse') ? 'refresh-reuse' : 'refresh-expired');
        }
        return false;
      }
      const data = await res.json();
      if (data?.token) setAuthToken(data.token);
      if (data?.refreshToken) setRefreshToken(data.refreshToken);
      return !!data?.token;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  config?: { timeoutMs?: number; json?: boolean; _retry?: boolean },
): Promise<T> {
  const timeoutMs = config?.timeoutMs ?? 30000;
  const headers: Record<string, string> = {
    ...(options.headers as any || {}),
  };
  // Only set Content-Type when there's a body — Fastify 5 rejects bodyless requests with JSON content-type
  if (options.body && config?.json !== false) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    // 401 on a non-auth endpoint → try one silent refresh + retry.  We skip
    // retry on /api/auth/* so a bad login doesn't fire a refresh storm.
    if (
      res.status === 401 &&
      !config?._retry &&
      !path.startsWith('/api/auth/') &&
      refreshToken
    ) {
      const rotated = await rotateRefresh();
      if (rotated) {
        return request<T>(path, options, { ...config, _retry: true });
      }
    }
    const err = await res.json().catch(() => ({}));
    // Fastify default error shape: { statusCode, error, message }
    //   - `error` is the generic HTTP status name ("Internal Server Error")
    //   - `message` is the actionable text
    // Our routes return { error: "..." } as the actionable text.
    // Prefer whichever looks more specific.
    const fastifyMessage = (err as any).message;
    const ourError = (err as any).error;
    const isGeneric = (s: any) => typeof s === 'string' && /^(Internal Server Error|Bad Request|Not Found|Unauthorized|Forbidden)$/i.test(s);
    let detail: string;
    if (typeof fastifyMessage === 'string' && fastifyMessage.length > 0) {
      detail = fastifyMessage;
    } else if (typeof ourError === 'string' && ourError.length > 0 && !isGeneric(ourError)) {
      detail = ourError;
    } else if (typeof ourError === 'string' && ourError.length > 0) {
      detail = ourError;
    } else {
      detail = res.statusText || `Request failed: ${res.status}`;
    }
    const e = new Error(detail) as Error & { statusCode?: number; providers?: any[]; geminiOnly?: boolean };
    e.statusCode = res.status;
    // Forward provider failure summaries + geminiOnly flag from structured error responses
    if (Array.isArray((err as any).providers)) e.providers = (err as any).providers;
    if ((err as any).geminiOnly) e.geminiOnly = true;
    throw e;
  }
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  rememberMe: boolean;
  user: any;
}

export const authApi = {
  login: (email: string, password: string, rememberMe = false) =>
    request<AuthResponse>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password, rememberMe }) },
    ),
  register: (email: string, password: string, name: string, rememberMe = false) =>
    request<AuthResponse>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, name, rememberMe }) },
    ),
  me: () => request<MeRecord>('/api/auth/me'),
  updateMe: (data: { name: string }) =>
    request<MeRecord>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  // Public — never throws on unknown email (backend returns generic success).
  forgotPassword: (email: string) =>
    request<{ success: boolean; message?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  // Public — consume a reset token + set a new password.
  resetPassword: (token: string, password: string) =>
    request<{ success: boolean; message?: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  // Logout revokes the refresh token server-side so replay can't extend
  // the session.  Access token stays valid until its short TTL expires.
  logout: () =>
    request<{ success: boolean }>(
      '/api/auth/logout',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
    ).catch(() => ({ success: false })),  // best-effort
};

export interface MeRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

// ─── Clients ─────────────────────────────────────────────────────

export interface BackendClient {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  website: string | null;
  instagramHandle: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  status: string;
  brief?: any;
}

export const clientsApi = {
  list: () => request<BackendClient[]>('/api/clients'),
  get: (id: string) => request<BackendClient>(`/api/clients/${id}`),
  create: (data: { name: string; industry?: string; website?: string; instagramHandle?: string }) =>
    request<BackendClient>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<BackendClient>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<any>(`/api/clients/${id}`, { method: 'DELETE' }),
};

// ─── Briefs ──────────────────────────────────────────────────────

export const briefsApi = {
  get: (clientId: string) => request<any>(`/api/clients/${clientId}/brief`),
  save: (clientId: string, data: any) =>
    request<any>(`/api/clients/${clientId}/brief`, { method: 'PUT', body: JSON.stringify(data) }),
  completeness: (clientId: string) => request<any>(`/api/clients/${clientId}/brief/completeness`),
  promptPack: (clientId: string) => request<any>(`/api/clients/${clientId}/brief/prompt-pack`),
};

// ─── Calendar ────────────────────────────────────────────────────

export interface CalendarMonthSummary {
  id: string;
  month: string;
  status: string;
  isTest?: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  createdAt: string;
  postCount: number;
}

export const calendarApi = {
  generate: (clientId: string, month: string, pieceCount = 18) =>
    request<{ jobId: string }>(`/api/clients/${clientId}/calendar/generate`, { method: 'POST', body: JSON.stringify({ month, pieceCount }) }),
  listMonths: (clientId: string) =>
    request<CalendarMonthSummary[]>(`/api/clients/${clientId}/calendar/months`),
  listArchived: (clientId: string) =>
    request<CalendarMonthSummary[]>(`/api/clients/${clientId}/calendar/archived`),
  getMonth: (clientId: string, month: string, opts?: { includeArchived?: boolean }) => {
    const qs = opts?.includeArchived ? '?includeArchived=true' : '';
    return request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}${qs}`);
  },
  updatePost: (postId: string, data: any) =>
    request<any>(`/api/calendar-posts/${postId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // F2 scheduler — set scheduledAt + platformConnectionId on a post. Backend
  // (server/src/routes/calendar.ts) auto-stamps status='scheduled' + clears
  // any stale scheduleError when scheduledAt transitions from null → ISO.
  // Worker (server/src/workers/scheduler.worker.ts) picks the row up on its
  // next tick (60s lookahead, SETNX-locked per (postId, scheduledAt)).
  // Pass scheduledAt=null to UNSCHEDULE — caller passes status separately
  // (e.g. 'draft') if they want to revert from 'scheduled'.
  schedulePost: (postId: string, scheduledAt: string | null, platformConnectionId: string | null) =>
    request<any>(`/api/calendar-posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduledAt, platformConnectionId }),
    }),
  deletePost: (postId: string) =>
    request<{ success: boolean; deletedId: string }>(`/api/calendar-posts/${postId}`, { method: 'DELETE' }),
  // Manual add-post outside the generated plan (Habiba 2026-07-14) + backs
  // Asya's "duplicate to another platform" (FE passes an existing post's fields
  // with a different platform).
  addPost: (clientId: string, month: string, data: Record<string, unknown>) =>
    request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/posts`, { method: 'POST', body: JSON.stringify(data) }),
  // Per-post compliance audit + content score (Tamer 2026-07-14). Both persist
  // to the post's metadata and return the structured result.
  complianceCheck: (postId: string) =>
    request<{ passed: boolean; issues: { severity: string; quote: string; rule_violated: string; suggestion: string }[]; checkedAt: string }>(`/api/calendar-posts/${postId}/compliance-check`, { method: 'POST' }, { timeoutMs: 90000 }),
  scorePost: (postId: string) =>
    request<{ overall: number; dimensions: Record<string, { score: number; note: string }>; topRecommendation: string; scoredAt: string }>(`/api/calendar-posts/${postId}/score`, { method: 'POST' }, { timeoutMs: 90000 }),
  // Per-post team notes (Asya 2026-07-14) via PostComment.
  listComments: (postId: string) =>
    request<{ comments: { id: string; authorName: string; source: string; comment: string; status: string | null; createdAt: string }[] }>(`/api/calendar-posts/${postId}/comments`),
  addComment: (postId: string, comment: string) =>
    request<any>(`/api/calendar-posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ comment }) }),
  // Soft archive (reversible) — Manus-style history preservation.
  archiveMonth: (clientId: string, month: string) =>
    request<{ success: boolean; mode: 'archive'; archived: number; month: string; archivedAt: string }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}`,
      { method: 'DELETE' },
    ),
  // Permanent delete — requires explicit ?hard=true. Two-step confirm on the UI side.
  hardDeleteMonth: (clientId: string, month: string) =>
    request<{ success: boolean; mode: 'hard'; deleted: number; month: string }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}?hard=true`,
      { method: 'DELETE' },
    ),
  restoreMonth: (clientId: string, month: string) =>
    request<{ success: boolean; restored: number; month: string }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/restore`,
      { method: 'POST' },
    ),
  // Back-compat alias — some older callers still import deleteMonth.  Maps to archive.
  deleteMonth: (clientId: string, month: string) =>
    request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}`, { method: 'DELETE' }),
  // PERF-8: route now returns { jobId } (202). Poll /api/jobs/:id for the result
  // which mirrors the synchronous shape under `result`.
  backfillVisualRefs: (clientId: string, month: string, count = 6) =>
    request<{ jobId: string }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/visual-refs/backfill`,
      { method: 'POST', body: JSON.stringify({ count }) },
    ),
};

// ─── Content Pieces (production-tracking queue) ──────────────────
// Separate from CalendarPost — this is the studio-pipeline page at /pieces.
// Persisted to backend as of 2026-04-24 (was pure localStorage).

export interface ContentPieceRecord {
  id: string;
  clientId: string;
  title: string;
  type: string;
  station: string;
  topicId: string;
  status: string;
  assignee: string;
  deadline: string;
  visualRefUrl: string;
  visualRefImage: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const contentPiecesApi = {
  list: (clientId: string) =>
    request<ContentPieceRecord[]>(`/api/clients/${clientId}/content-pieces`),
  create: (clientId: string, piece: Partial<ContentPieceRecord>) =>
    request<ContentPieceRecord>(`/api/clients/${clientId}/content-pieces`, {
      method: 'POST',
      body: JSON.stringify(piece),
    }),
  update: (id: string, patch: Partial<ContentPieceRecord>) =>
    request<ContentPieceRecord>(`/api/content-pieces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  delete: (id: string) =>
    request<{ success: boolean; deletedId: string }>(`/api/content-pieces/${id}`, {
      method: 'DELETE',
    }),
  bulkImport: (clientId: string, pieces: Array<Partial<ContentPieceRecord>>) =>
    request<{ success: boolean; imported: number; skipped?: number }>(
      `/api/clients/${clientId}/content-pieces/bulk-import`,
      { method: 'POST', body: JSON.stringify({ pieces }) },
    ),
};

// ─── Jobs ────────────────────────────────────────────────────────

export interface JobRecord {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string | null;
  createdAt?: string;
  updatedAt: string;
}
export const jobsApi = {
  get: (jobId: string) => request<JobRecord>(`/api/jobs/${jobId}`),
};

// ─── Review Links ────────────────────────────────────────────────

export const reviewApi = {
  createLink: (clientId: string, month: string) =>
    request<{ token: string; url: string; expiresAt: string | null }>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/review-links`, { method: 'POST', body: JSON.stringify({ expiresInDays: 30 }) }),
};

// ─── Exports ─────────────────────────────────────────────────────

export const exportsApi = {
  trigger: (clientId: string, month: string, type: 'pptx' = 'pptx') =>
    request<{ jobId: string }>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/export`, { method: 'POST', body: JSON.stringify({ type }) }),
  list: (clientId: string) =>
    request<any[]>(`/api/exports/${clientId}`),
  downloadUrl: (fileUrl: string) => `${API_URL}${fileUrl}`,
};

// Monthly client-deliverable report. Different from exportsApi (internal
// dump): this is the agency-grade themed deck meant to be sent TO the client.
export type ReportTheme = 'aura' | 'dark' | 'pitch';
export const reportsApi = {
  triggerMonthly: (clientId: string, month: string, theme: ReportTheme = 'aura') =>
    request<{ jobId: string; month: string; theme: ReportTheme; postCount: number }>(
      `/api/clients/${clientId}/reports/monthly?month=${encodeURIComponent(month)}`,
      { method: 'POST', body: JSON.stringify({ theme }) },
    ),
  list: (clientId: string) =>
    request<{ id: string; type: string; status: string; fileUrl: string | null; calendarMonthId: string; createdAt: string }[]>(
      `/api/clients/${clientId}/reports`,
    ),
  downloadUrl: (fileUrl: string) => `${API_URL}${fileUrl}`,
};

// API keys (JWT-authed CRUD for users to manage their workspace's external keys)
export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export const apiKeysApi = {
  list: (clientId: string) =>
    request<ApiKeyRecord[]>(`/api/api-keys?clientId=${encodeURIComponent(clientId)}`),
  create: (clientId: string, name: string, expiresInDays?: number) =>
    request<ApiKeyRecord & { key: string; warning: string }>(`/api/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ clientId, name, expiresInDays }),
    }),
  revoke: (id: string) =>
    request<{ id: string; revokedAt: string }>(`/api/api-keys/${id}/revoke`, { method: 'POST' }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/api/api-keys/${id}`, { method: 'DELETE' }),
};

// ─── Creative ────────────────────────────────────────────────────

export const creativeApi = {
  generateImage: (data: { prompt: string; aspectRatio?: string; clientId?: string; model?: string; provider?: 'gemini' | 'xai' | 'dashscope'; safeZone?: boolean; imageSize?: '1K' | '2K' | '4K'; enhance?: boolean; depth?: 'raw' | 'low' | 'medium' | 'high'; stylePackId?: string }) =>
    request<any>('/api/creative/images/generate', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 180000 }),
  editImage: (data: { prompt: string; imageBase64: string; mimeType?: string; aspectRatio?: string; clientId?: string; model?: string; provider?: 'gemini' | 'xai' | 'dashscope'; referenceImages?: { base64: string; mimeType: string; role?: 'content' | 'style' | 'character' }[]; safeZone?: boolean; imageSize?: '1K' | '2K' | '4K'; enhance?: boolean; depth?: 'raw' | 'low' | 'medium' | 'high' }) =>
    request<any>('/api/creative/images/edit', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 180000 }),
  // Teach-the-AI thumbs (2026-07-14): records a win/miss memory for the client
  // so future enhancements/generations lean toward or away from this style.
  feedback: (generationId: string, liked: boolean) =>
    request<{ ok: boolean; memoryId: string | null }>('/api/creative/feedback', { method: 'POST', body: JSON.stringify({ generationId, liked }) }),
  generateVideo: (data: {
    prompt: string;
    aspectRatio?: string;
    durationSeconds?: number;
    resolution?: string;
    // Video cost tiering (design 2026-06-03): draft → Grok ($0.03/s),
    // hd → veo-3.1-fast ($0.20/s). Default 'draft' on the server.
    tier?: 'draft' | 'hd';
    clientId?: string;
    imageBase64?: string;
    mimeType?: string;
    // Workshop 2026-05-06 #3 (Haneen): explicit start + end frame controls
    startImageBase64?: string;
    startMimeType?: string;
    endImageBase64?: string;
    endMimeType?: string;
    safeZone?: boolean;
    // Merged with Veo's default stability negatives server-side.
    negativePrompt?: string;
    // Veo asset refs ("ingredients to video") — product/subject stays
    // consistent. Max 3; forces an 8s clip.
    referenceImages?: { base64: string; mimeType: string }[];
    // Video engine override (e.g. 'gemini-omni-flash-preview').
    model?: string;
    // Auto pro-prompt (server-side enhancer). Default true; false opts out.
    enhance?: boolean;
    // Enhancer depth dial: raw = translate-only (never reinterprets wording).
    depth?: 'raw' | 'low' | 'medium' | 'high';
    // Curated Style Pack id (server-side design contracts).
    stylePackId?: string;
  }) =>
    request<{ jobId: string }>('/api/creative/videos/generate', { method: 'POST', body: JSON.stringify(data) }),
  stylePacks: () =>
    request<{ packs: { id: string; name: string; tagline: string; category: string; palette: string[] }[] }>('/api/creative/style-packs'),
  getJob: (jobId: string) =>
    request<{ id: string; status: string; progress: number; result?: any; error?: string }>(`/api/creative/jobs/${jobId}`),
  improvePrompt: (prompt: string, mode?: string, opts?: { clientId?: string; safeZone?: boolean; hasRefs?: boolean; stylePackId?: string }) =>
    request<{ original: string; improved: string; negativePrompt: string | null; mode: string | null; provider: string; latencyMs: number }>(
      '/api/creative/prompt/improve',
      { method: 'POST', body: JSON.stringify({ prompt, mode, ...(opts || {}) }) },
      { timeoutMs: 60000 },
    ),
};

// ─── Changelog (What's new on Radix AI) ─────────────────────────

export interface ChangelogEntry { date: string; tag: 'new' | 'improved' | 'fixed'; title: string; body: string }
export const changelogApi = {
  list: (limit = 5) => request<{ entries: ChangelogEntry[] }>(`/api/changelog?limit=${limit}`),
};

// ─── Federated content search (⌘K palette) ──────────────────────
export interface SearchResults {
  clients: { id: string; name: string; slug: string; industry?: string | null }[];
  posts: { id: string; title: string; platform: string; status: string; clientId: string | null; month: string | null }[];
  pieces: { id: string; title: string; clientId: string; status: string; type: string }[];
}
export const searchApi = {
  query: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
};

// ─── Client collaboration gallery (shareable) ───────────────────
export interface GalleryShareLinkRec { id: string; token: string; title: string | null; expiresAt: string | null; isActive: boolean; createdAt: string }
export interface ShareAsset { id: string; name: string; fileUrl: string; thumbUrl: string | null; mimeType: string; createdAt: string }
export interface AssetFeedbackRec { id: string; assetId: string; authorName: string; comment: string | null; decision: string | null; createdAt: string }
export const galleryShareApi = {
  create: (clientId: string, title?: string, expiresInDays?: number) =>
    request<{ token: string; url: string; expiresAt: string | null }>(`/api/clients/${clientId}/gallery-share`, { method: 'POST', body: JSON.stringify({ title, expiresInDays }) }),
  list: (clientId: string) =>
    request<{ links: GalleryShareLinkRec[]; feedback: AssetFeedbackRec[] }>(`/api/clients/${clientId}/gallery-share`),
  // public (no auth) — used by the /g/:token page
  publicGet: (token: string) =>
    request<{ title: string; clientName: string; assets: ShareAsset[]; feedback: AssetFeedbackRec[] }>(`/api/gallery/${token}`),
  publicFeedback: (token: string, assetId: string, body: { authorName: string; comment?: string; decision?: 'approved' | 'changes' }) =>
    request<{ ok: boolean; id: string }>(`/api/gallery/${token}/assets/${assetId}/feedback`, { method: 'POST', body: JSON.stringify(body) }),
  downloadUrl: (fileUrl: string) => (fileUrl.startsWith('http') ? fileUrl : `${API_URL}${fileUrl}`),
};

// ─── Competitor Intel ────────────────────────────────────────────
export interface CompetitorAnalysis {
  competitor: string; website: string | null; grounded: boolean; provider: string;
  analysis: { summary: string; themes: string[]; tone: string; cadenceSignals: string; strengths: string[]; opportunities: string[] };
}
export const competitorIntelApi = {
  analyze: (body: { competitor: string; website?: string; clientId?: string }) =>
    request<CompetitorAnalysis>('/api/competitor-intel/analyze', { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 90000 }),
};

// ─── AI Copywriting ──────────────────────────────────────────────

export const copywritingApi = {
  generate: (data: {
    brief: string;
    copyType?: 'headline' | 'description' | 'article' | 'cta';
    language?: 'en' | 'ar' | 'fr';
    tone?: string;
    clientId?: string;
    count?: number;
    length?: string;
    avoid?: string[];
  }) =>
    request<{
      variants: string[];
      language: 'en' | 'ar' | 'fr';
      copyType: 'headline' | 'description' | 'article' | 'cta';
      groundingChunks: number;
      provider: string;
      model: string;
      latencyMs: number;
    }>(
      '/api/copywriting/generate',
      { method: 'POST', body: JSON.stringify(data) },
      { timeoutMs: 90000 },
    ),
};

// ─── Research ────────────────────────────────────────────────────

export const researchApi = {
  query: (query: string, depth: 'quick' | 'deep' = 'quick') =>
    request<{ summary: string; keyPoints: string[]; sources: { title: string; url: string; snippet?: string }[]; provider: string; latencyMs: number }>(
      '/api/research', { method: 'POST', body: JSON.stringify({ query, depth }) }, { timeoutMs: 120000 }
    ),
};

// ─── Assistant ───────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const assistantApi = {
  // `signal` lets the caller abort an in-flight agent run (Stop button).
  // `attachments` = files on the latest user turn (images → vision model).
  chat: (messages: ChatMessage[], clientId?: string, signal?: AbortSignal, attachments?: { dataUrl: string; mimeType: string; name?: string; kind?: 'image' | 'video' | 'doc' }[]) =>
    request<{ message: ChatMessage; action?: { type: string; params: Record<string, any>; result: any }; provider: string; latencyMs: number }>(
      '/api/assistant/chat', { method: 'POST', body: JSON.stringify({ messages, clientId, attachments }), signal }, { timeoutMs: 120000 }
    ),
};

// ─── Generic AI text (Topic Desk / visual-ref keywords via the router) ──
export const aiApi = {
  text: (data: { prompt: string; system?: string; json?: boolean; temperature?: number; clientId?: string }) =>
    request<{ text: string; provider: string; model: string }>(
      '/api/ai/text', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 120000 },
    ),
};

// ─── Design Brief ────────────────────────────────────────────────

export const designApi = {
  brief: (data: { topic: string; audience?: string; objective?: string; brandColors?: string[]; mood?: string; clientId?: string; copy?: string; productFocus?: string; visualThoughts?: string }) =>
    request<any>('/api/design/brief', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 120000 }),
};

// ─── Video Analysis ──────────────────────────────────────────────

export const analyzeApi = {
  video: (data: { videoUrl: string; prompt?: string; clientId?: string }) =>
    request<any>('/api/analyze/video', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 180000 }),
};

// ─── Visual References ──────────────────────────────────────────

export interface VisualRef {
  id: string;
  postId: string;
  thumbnailUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: 'pinterest' | 'web' | 'manual' | 'placeholder';
  title?: string;
  description?: string;
  pinId?: string;
  position: number;
  createdAt: string;
}

export interface VisualSearchResult {
  thumbnailUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType?: 'pinterest' | 'web' | 'manual' | 'placeholder';
  title?: string;
  description?: string;
}

export const visualRefsApi = {
  list: (postId: string) => request<VisualRef[]>(`/api/calendar-posts/${postId}/visual-refs`),
  add: (postId: string, data: Partial<VisualRef>) =>
    request<VisualRef>(`/api/calendar-posts/${postId}/visual-refs`, { method: 'POST', body: JSON.stringify(data) }),
  update: (refId: string, data: Partial<VisualRef>) =>
    request<VisualRef>(`/api/visual-refs/${refId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (refId: string) => request<{ success: boolean }>(`/api/visual-refs/${refId}`, { method: 'DELETE' }),
  search: (query: string, count = 8) =>
    request<{ results: VisualSearchResult[]; provider: string }>(`/api/visual-refs/search`, { method: 'POST', body: JSON.stringify({ query, count }) }),
  autoPopulate: (postId: string, count = 6) =>
    request<{ added: number; refs: VisualRef[] }>(`/api/calendar-posts/${postId}/visual-refs/auto-populate`, { method: 'POST', body: JSON.stringify({ count }) }),
};

// ─── Assets (file upload) ────────────────────────────────────────

export const assetsApi = {
  upload: async (clientId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_URL}/api/clients/${clientId}/assets/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ id: string; fileUrl: string; thumbUrl?: string; mimeType: string; name: string }>;
  },
};

// ─── Knowledge (RAG corpus per client) ──────────────────────────

export interface KnowledgeItemRecord {
  id: string;
  clientId: string;
  title: string;
  type: string;
  fileUrl: string | null;
  textContent: string | null;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeApi = {
  list: (clientId: string) =>
    request<KnowledgeItemRecord[]>(`/api/clients/${clientId}/knowledge`),
  upload: async (clientId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_URL}/api/clients/${clientId}/knowledge/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<KnowledgeItemRecord>;
  },
  remove: (knowledgeItemId: string) =>
    request<{ success: boolean }>(`/api/knowledge/${knowledgeItemId}`, { method: 'DELETE' }),
  embed: (knowledgeItemId: string) =>
    request<{ chunks: number }>(`/api/knowledge/${knowledgeItemId}/embed`, { method: 'POST' }, { timeoutMs: 120000 }),
  retrieve: (clientId: string, q: string, k = 5) =>
    request<{ query: string; chunks: Array<{ text: string; score: number; itemTitle?: string }> }>(
      `/api/clients/${clientId}/knowledge/retrieve?q=${encodeURIComponent(q)}&k=${k}`,
    ),
};

// ─── Memory / Learnings (experiential self-learning layer) ───────
// What the AI has LEARNED from interaction — corrections, preferences,
// patterns, failures to avoid. Backed by the Memory table + memory.service;
// every text/analysis generation is enriched with the relevant learnings.
export type MemoryKind = 'correction' | 'preference' | 'pattern' | 'failure' | 'success';

export interface MemoryRecord {
  id: string;
  clientId: string | null; // null = org-wide learning (applies to every client)
  kind: MemoryKind;
  source: string;          // edit | rejection | regeneration | failed_call | explicit | consolidation
  content: string;
  context: string | null;
  weight: number;
  useCount: number;
  createdAt: string;
}

export const memoryApi = {
  // clientId given → that client's learnings + org-wide; omitted → all active.
  list: (clientId?: string, limit = 100) =>
    request<MemoryRecord[]>(
      `/api/memory?limit=${limit}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`,
    ),
  create: (data: { content: string; kind?: MemoryKind; clientId?: string | null; context?: string }) =>
    request<{ id: string }>('/api/memory', { method: 'POST', body: JSON.stringify(data) }),
  // Archive (never hard-deletes) — the lesson is retired, history preserved.
  archive: (id: string) =>
    request<{ success: boolean }>(`/api/memory/${id}`, { method: 'DELETE' }),
};

// ─── Dashboard ──────────────────────────────────────────────────

export interface DashboardStats {
  clients: {
    total: number;
    withBrief: number;
  };
  content: {
    totalMonths: number;
    totalPosts: number;
    byStatus: {
      draft: number;
      approved: number;
      changes_requested: number;
    };
    byPlatform: Record<string, number>;
  };
  generation: {
    recentJobs: {
      month: string;
      clientId: string;
      createdAt: string;
    }[];
  };
  knowledge: {
    totalItems: number;
    totalChunks: number;
  };
  activity: {
    recentMonths: {
      id: string;
      month: string;
      status: string;
      createdAt: string;
      postCount: number;
    }[];
  };
}

export interface AiProviderStat {
  provider: string;
  calls: number;
  errors: number;
  successRate: number;
  avgLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  fallbacks: number;
  tasks: Record<string, number>;
}

export interface EnrichmentHealthStat {
  type: 'memory' | 'knowledge';
  gated: number;       // skipped retrieval (no orgId / skip flag / zero-count gate)
  ran: number;         // performed a real embedding + retrieval round-trip
  injected: number;    // ran AND prepended ≥1 item to the prompt
  empty: number;       // ran but found nothing above threshold
  failed: number;      // retrieval threw (the silent-breakage case)
  hits: number;        // total items prepended
  lastInjectedAt: string | null;
  injectionRate: number; // injected / ran, %
}

export interface AiStats {
  totalCalls: number;
  totalTokens: number;
  totalErrors: number;
  totalFallbacks: number;
  providers: AiProviderStat[];
  tasks: { task: string; calls: number; avgLatencyMs: number; totalTokens: number }[];
  /** RAG/memory retrieval health (added with the self-learning observability). */
  enrichment?: EnrichmentHealthStat[];
}

export interface DashboardInsights {
  actionCenter: { pendingReview: number; draftsStuck: number; totalActions: number };
  trends: {
    sparkline: { date: string; posts: number; approved: number }[];
    postsTrend: number;
    last7Days: number;
  };
  visualShowcase: {
    id: string;
    fileUrl: string;
    thumbUrl: string | null;
    mimeType: string;
    name: string;
    createdAt: string;
    clientName: string | null;
  }[];
  insights: { type: 'positive' | 'warning' | 'info'; text: string }[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  clientId: string | null;
  clientName: string | null;
  payload: any;
  createdAt: string;
}

export const dashboardApi = {
  stats: () => request<DashboardStats>('/api/dashboard/stats'),
  aiStats: () => request<AiStats>('/api/dashboard/ai-stats'),
  insights: () => request<DashboardInsights>('/api/dashboard/insights'),
  activity: () => request<ActivityEntry[]>('/api/dashboard/activity'),
};

// ─── Org-scoped usage (live meter + per-model view) ──────────────
// Org-wide month-to-date AI spend from UsageEvent. Powers the always-on
// sidebar UsageMeter and the per-model admin breakdown. Org-scoped (every
// owner sees their own org), not staff-only.
export interface OrgUsage {
  monthToDate: { calls: number; costUsd: number; units: number };
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
  byUser: Array<{ userId: string | null; userEmail: string | null; calls: number; costUsd: number }>;
}
export const usageApi = {
  currentOrg: () => request<OrgUsage>('/api/dashboard/usage'),
};

export interface GalleryAsset {
  id: string;
  name: string;
  fileUrl: string;
  thumbUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  tags: any;
  createdAt: string;
  client: { id: string; name: string } | null;
}

// ─── Multi-tenancy: orgs + memberships ──────────────────────────
export interface OrgMembership {
  orgId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  org: { id: string; name: string; slug: string; plan: string; status?: string };
}

export const orgsApi = {
  list: () => request<OrgMembership[]>('/api/auth/orgs'),
  switch: (orgId: string) =>
    request<{ token: string; activeOrgId: string; orgRole: string }>(
      '/api/auth/switch-org',
      { method: 'POST', body: JSON.stringify({ orgId }) },
    ),
  members: (orgId: string) =>
    request<{ id: string; role: string; createdAt: string; user: { id: string; email: string; name: string } }[]>(
      `/api/orgs/${orgId}/members`,
    ),
  removeMember: (orgId: string, userId: string) =>
    request<{ success: boolean }>(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
  setMemberRole: (orgId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER') =>
    request<{ success: boolean; role: string }>(
      `/api/orgs/${orgId}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),
};

// ─── Invitations (org membership) ──────────────────────────────
export interface PendingInvite {
  id: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  token: string;
  expiresAt: string;
  createdAt?: string;
}
export interface InvitePreview {
  email: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  org: { name: string; slug: string; plan: string };
  expiresAt: string;
}
export const invitationsApi = {
  list: (orgId: string) => request<PendingInvite[]>(`/api/orgs/${orgId}/invitations`),
  create: (orgId: string, email: string, role: 'ADMIN' | 'EDITOR' | 'VIEWER' = 'EDITOR') =>
    request<PendingInvite>(`/api/orgs/${orgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  revoke: (orgId: string, id: string) =>
    request<{ success: boolean }>(`/api/orgs/${orgId}/invitations/${id}`, { method: 'DELETE' }),
  // Public — no auth header required.  Backend ignores Authorization on this route.
  preview: (token: string) => request<InvitePreview>(`/api/invitations/${token}`),
  accept: (token: string) =>
    request<{ success: boolean; orgId: string; role: string }>(
      `/api/invitations/${token}/accept`,
      { method: 'POST' },
    ),
};

// ─── Billing ────────────────────────────────────────────────────
export const billingApi = {
  checkout: (plan: 'starter' | 'studio' | 'agency') =>
    request<{ url: string }>(
      '/api/billing/checkout',
      { method: 'POST', body: JSON.stringify({ plan }) },
    ),
  portal: () =>
    request<{ url: string }>('/api/billing/portal', { method: 'POST' }),
};

// ─── Admin ──────────────────────────────────────────────────────
export interface AdminMetrics {
  mrr: number;
  arr: number;
  byPlan: Record<string, number>;
  paidOrgs: number;
  trialOrgs: number;
  totalSeats: number;
  monthAiCostUsd: number;
  monthAiTokens: number;
  monthAiCalls: number;
  monthGrossMarginUsd: number;
}
export interface AdminOrg {
  id: string; name: string; slug: string; plan: string; status: string;
  stripeCustomerId: string | null; createdAt: string;
  seats: number; clients: number; calendars: number; mrr: number;
}
// ─── Admin: usage reporting (finance) ────────────────────────────
// Per-user totals + per-kind breakdown for an org over a date range.
export interface AdminUsageByUser {
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  calls: number;
  units: number;
  costUsd: number;
  breakdown: Record<string, { calls: number; units: number; costUsd: number }>;
}
// Per-day totals (one row per day) with per-kind cost breakdown.
export interface AdminUsageByDay {
  date: string;            // YYYY-MM-DD
  calls: number;
  units: number;
  costUsd: number;
  breakdown: Record<string, number>;  // kind -> costUsd
}
// Global rollup with kind / provider / top-model splits.
export interface AdminUsageTotals {
  calls: number;
  units: number;
  costUsd: number;
  byKind: Record<string, { calls: number; units: number; costUsd: number }>;
  byProvider: Record<string, { calls: number; costUsd: number }>;
  topModels: Array<{ model: string; calls: number; costUsd: number }>;
}
export interface AdminAuditLogEntry {
  id: string;
  orgId: string;
  userId: string | null;
  userEmail: string | null;
  clientId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: any;
  createdAt: string;
}

function buildUsageQs(params: { orgId?: string; from?: string; to?: string; userId?: string; action?: string; limit?: number }): string {
  const sp = new URLSearchParams();
  if (params.orgId) sp.set('orgId', params.orgId);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.userId) sp.set('userId', params.userId);
  if (params.action) sp.set('action', params.action);
  if (params.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const adminApi = {
  metrics: () => request<AdminMetrics>('/api/admin/metrics'),
  orgs: () => request<AdminOrg[]>('/api/admin/orgs'),
  deleteOrg: (orgId: string) =>
    request<{ ok: boolean; deleted: { id: string; name: string } }>(`/api/admin/orgs/${orgId}`, { method: 'DELETE' }),
  orgUsage: (orgId: string) =>
    request<{ kind: string; calls: number; units: number; costUsd: number }[]>(
      `/api/admin/orgs/${orgId}/usage`,
    ),
  // Usage reporting (finance dashboard)
  usageByUser: (params: { orgId: string; from?: string; to?: string }) =>
    request<AdminUsageByUser[]>(`/api/admin/usage/by-user${buildUsageQs(params)}`),
  usageByDay: (params: { orgId: string; from?: string; to?: string }) =>
    request<AdminUsageByDay[]>(`/api/admin/usage/by-day${buildUsageQs(params)}`),
  usageTotals: (params: { orgId?: string; from?: string; to?: string }) =>
    request<AdminUsageTotals>(`/api/admin/usage/totals${buildUsageQs(params)}`),
  auditLog: (params: { orgId: string; userId?: string; action?: string; from?: string; to?: string; limit?: number }) =>
    request<AdminAuditLogEntry[]>(`/api/admin/audit-log${buildUsageQs(params)}`),
  // CSV export — fetch with auth header → blob → anchor click. Top-level
  // navigation (window.open) would strip the Authorization header, so the
  // bearer-only endpoint would 401. Same pattern used by integrationsApi.initiate.
  usageExportCsv: async (params: { orgId: string; from?: string; to?: string }): Promise<void> => {
    const qs = buildUsageQs(params);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_URL}/api/admin/usage/export.csv${qs}`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as any).error || `Export failed: ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `usage-${params.orgId}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const galleryApi = {
  list: (filters: { type?: 'image' | 'video'; clientId?: string; q?: string; take?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.clientId) params.set('clientId', filters.clientId);
    if (filters.q) params.set('q', filters.q);
    if (filters.take) params.set('take', String(filters.take));
    const qs = params.toString();
    return request<GalleryAsset[]>(`/api/assets${qs ? `?${qs}` : ''}`);
  },
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/assets/${id}`, { method: 'DELETE' }),
};

// ─── Platform integrations (OAuth-based connectors) ──────────────

export interface SupportedPlatform {
  id: string; // 'meta_ig' | 'tiktok' | 'linkedin'
  label: string;
}

export interface IntegrationSummary {
  id: string;
  platform: string;
  externalAccountId: string;
  externalAccountName?: string | null;
  scopes: string[];
  expiresAt: string | null;
  status: 'connected' | 'needs_reauth' | 'revoked' | 'error';
  lastError?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export const integrationsApi = {
  list: (clientId: string) =>
    request<{ supported: SupportedPlatform[]; connections: IntegrationSummary[] }>(`/api/integrations?clientId=${encodeURIComponent(clientId)}`),
  /**
   * Two-step OAuth kick-off:
   *   1. Authenticated JSON fetch returns the platform consent URL (with a
   *      single-use state token bound to org+client+user).
   *   2. Caller navigates the browser to that URL.
   *
   * Doing it as a 302 from the server doesn't work because top-level
   * browser navigation strips the Authorization header, so the auth-gated
   * /initiate endpoint would 401 every time.
   */
  initiate: async (platform: string, clientId: string): Promise<void> => {
    const r = await request<{ url: string }>(`/api/integrations/oauth/${encodeURIComponent(platform)}/initiate?clientId=${encodeURIComponent(clientId)}`);
    if (!r?.url) throw new Error('Initiate response missing url');
    window.location.href = r.url;
  },
  revoke: (connectionId: string) =>
    request<{ success: boolean }>(`/api/integrations/${connectionId}`, { method: 'DELETE' }),
};

// ─── History (universal AI generation log) ───────────────────────

export type GenerationType = 'image' | 'video' | 'text' | 'research' | 'brand_synthesis' | 'analyze' | 'design';

export interface GenerationSummary {
  id: string;
  type: GenerationType;
  surface: string | null;
  prompt: string;
  outputUrl: string | null;
  outputText: string | null;       // truncated to 1000 chars in list mode
  thumbnailUrl: string | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  status: 'succeeded' | 'failed';
  error: string | null;
  client: { id: string; name: string; logoUrl: string | null } | null;
  user: { id: string; name: string } | null;
  createdAt: string;
}

export interface GenerationDetail extends GenerationSummary {
  metadata: Record<string, unknown> | null;
  costUsd: string | null;
  orgId: string;
}

export interface HistoryListResponse {
  items: GenerationSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const historyApi = {
  list: (params: { type?: GenerationType; clientId?: string; surface?: string; limit?: number; cursor?: string; q?: string; status?: 'succeeded' | 'failed' } = {}) => {
    const sp = new URLSearchParams();
    if (params.type) sp.set('type', params.type);
    if (params.clientId) sp.set('clientId', params.clientId);
    if (params.surface) sp.set('surface', params.surface);
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.q) sp.set('q', params.q);
    if (params.status) sp.set('status', params.status);
    const qs = sp.toString();
    return request<HistoryListResponse>(`/api/history${qs ? '?' + qs : ''}`);
  },
  get: (id: string) => request<GenerationDetail>(`/api/history/${id}`),
  delete: (id: string) => request<{ ok: true }>(`/api/history/${id}`, { method: 'DELETE' }),
  stats: () => request<{ total: number; byType: Record<string, number> }>(`/api/history/stats`),
};

// ─── Publish ─────────────────────────────────────────────────────

export const publishApi = {
  publish: (postId: string, platform: 'meta_ig' | 'tiktok' | 'linkedin') =>
    request<{ jobId: string }>(`/api/calendar-posts/${postId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ platform }),
    }),
};

// ─── Agent sessions / replay ─────────────────────────────────────

export interface AgentSessionSummary {
  uid: string;
  title: string;
  status: string;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRecord {
  id: string;
  role: string;
  content: string;
  toolCallId: string | null;
  createdAt: string;
}

export interface AgentEventRecord {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface AgentSessionDetail extends AgentSessionSummary {
  messages: AgentMessageRecord[];
  events: AgentEventRecord[];
}

// ─── Agent template registry ─────────────────────────────────────
export interface AgentTemplateSummary {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  starterPrompt: string;
  tags: string[];
  preferredModel?: 'gemini' | 'grok' | 'kimi';
}

export const agentApi = {
  listSessions: (opts: { limit?: number; clientId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.clientId) p.set('clientId', opts.clientId);
    const qs = p.toString();
    return request<{ sessions: AgentSessionSummary[] }>(`/api/agent/sessions${qs ? `?${qs}` : ''}`);
  },
  getSession: (uid: string) =>
    request<{ session: AgentSessionDetail }>(`/api/agent/sessions/${encodeURIComponent(uid)}`),
  listTemplates: () =>
    request<{ templates: AgentTemplateSummary[] }>(`/api/agent/templates`),
  getTemplate: (id: string) =>
    request<{ template: AgentTemplateSummary & { systemPrompt: string } }>(
      `/api/agent/templates/${encodeURIComponent(id)}`,
    ),
};

// ─── BrandKit (F3, Wave 2.A) ─────────────────────────────────────

export interface BrandKitVoiceSample { context?: string; sample?: string; }
export interface BrandKitSampleImage {
  url: string;
  label?: string;
  primary?: boolean;
  mimeType?: string;
}

export interface BrandKitRecord {
  id: string;
  clientId: string;
  orgId: string;
  version: number;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontPrimary: string | null;
  fontSecondary: string | null;
  voiceSamples: BrandKitVoiceSample[];
  voiceDoNot: { rules?: string[] } | Record<string, any> | null;
  voicePerPlatform: Record<string, string> | null;
  sampleImages: BrandKitSampleImage[];
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitVersionRecord {
  id: string;
  brandKitId: string;
  version: number;
  changedBy: string | null;
  changedAt: string;
  snapshot: Record<string, any>;
}

export interface BrandKitGetResponse {
  brandKit: BrandKitRecord | null;
  clientPrimaryColor: string | null;
}

export interface BrandKitUpsertPayload {
  secondaryColor?: string | null;
  accentColor?: string | null;
  fontPrimary?: string | null;
  fontSecondary?: string | null;
  voiceSamples?: BrandKitVoiceSample[];
  voiceDoNot?: { rules?: string[] } | Record<string, any> | null;
  voicePerPlatform?: Record<string, string> | null;
  sampleImages?: BrandKitSampleImage[];
}

export const brandKitApi = {
  get: (clientId: string) =>
    request<BrandKitGetResponse>(`/api/clients/${clientId}/brand-kit`),
  upsert: (clientId: string, data: BrandKitUpsertPayload) =>
    request<BrandKitRecord>(`/api/clients/${clientId}/brand-kit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listVersions: (clientId: string) =>
    request<BrandKitVersionRecord[]>(`/api/clients/${clientId}/brand-kit/versions`),
  delete: (clientId: string) =>
    request<{ success: boolean; deletedId: string }>(
      `/api/clients/${clientId}/brand-kit`,
      { method: 'DELETE' },
    ),
};

// ─── Server health check ─────────────────────────────────────────

/** Try the current API_URL, and if it fails, cascade through the candidate
 * list (local -> VPS) and pick the first healthy one.  The winner is
 * persisted to localStorage so next launch starts there.  This is why the
 * portable exe works out-of-the-box against the VPS for team members who
 * don't run the Fastify server locally. */
export async function isServerAvailable(): Promise<boolean> {
  if (API_URL && await probeHealthy(API_URL, 2000)) return true;
  const winner = await pickHealthyBackend(2500);
  return winner !== null;
}

/** Return the currently-bound backend URL (after cascade).  Useful for
 * status UIs that want to display "Connected to: https://srv..." */
export function getApiUrl(): string {
  return API_URL;
}

/** Override the backend URL manually (e.g. a "Settings → Backend URL"
 * dropdown).  Clears any cached probe winner so next probe re-runs. */
export function setApiUrl(url: string) {
  API_URL = url;
  try { localStorage.setItem('radix_api_url', url); } catch {}
}
