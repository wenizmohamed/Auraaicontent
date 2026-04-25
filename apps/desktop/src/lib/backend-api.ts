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
  me: () => request<any>('/api/auth/me'),
  // Logout revokes the refresh token server-side so replay can't extend
  // the session.  Access token stays valid until its short TTL expires.
  logout: () =>
    request<{ success: boolean }>(
      '/api/auth/logout',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
    ).catch(() => ({ success: false })),  // best-effort
};

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
  deletePost: (postId: string) =>
    request<{ success: boolean; deletedId: string }>(`/api/calendar-posts/${postId}`, { method: 'DELETE' }),
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
  backfillVisualRefs: (clientId: string, month: string, count = 6) =>
    request<{ month: string; postsScanned: number; postsEligible: number; postsBackfilled: number; totalRefsAdded: number; failures: any[] }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/visual-refs/backfill`,
      { method: 'POST', body: JSON.stringify({ count }) },
      { timeoutMs: 240000 },
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

export const jobsApi = {
  get: (jobId: string) => request<{ id: string; status: string; progress: number; result?: any; error?: string }>(`/api/jobs/${jobId}`),
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

// ─── Creative ────────────────────────────────────────────────────

export const creativeApi = {
  generateImage: (data: { prompt: string; aspectRatio?: string; clientId?: string }) =>
    request<any>('/api/creative/images/generate', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 180000 }),
  editImage: (data: { prompt: string; imageBase64: string; mimeType?: string; aspectRatio?: string; clientId?: string }) =>
    request<any>('/api/creative/images/edit', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 180000 }),
  generateVideo: (data: { prompt: string; aspectRatio?: string; durationSeconds?: number; resolution?: string; clientId?: string; imageBase64?: string; mimeType?: string }) =>
    request<{ jobId: string }>('/api/creative/videos/generate', { method: 'POST', body: JSON.stringify(data) }),
  getJob: (jobId: string) =>
    request<{ id: string; status: string; progress: number; result?: any; error?: string }>(`/api/creative/jobs/${jobId}`),
  improvePrompt: (prompt: string, mode?: string) =>
    request<{ original: string; improved: string; mode: string | null; provider: string; latencyMs: number }>(
      '/api/creative/prompt/improve',
      { method: 'POST', body: JSON.stringify({ prompt, mode }) },
      { timeoutMs: 60000 },
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
  chat: (messages: ChatMessage[], clientId?: string) =>
    request<{ message: ChatMessage; action?: { type: string; params: Record<string, any>; result: any }; provider: string; latencyMs: number }>(
      '/api/assistant/chat', { method: 'POST', body: JSON.stringify({ messages, clientId }) }, { timeoutMs: 120000 }
    ),
};

// ─── Design Brief ────────────────────────────────────────────────

export const designApi = {
  brief: (data: { topic: string; audience?: string; objective?: string; brandColors?: string[]; mood?: string; clientId?: string }) =>
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

export const dashboardApi = {
  stats: () => request<DashboardStats>('/api/dashboard/stats'),
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
