// Backend API client — connects desktop frontend to Fastify server
// Falls back to localStorage when server is unavailable

// Resolution order:
//   1. explicit VITE_API_URL build env (highest priority)
//   2. desktop runtime → window.electron.apiBaseUrl || http://127.0.0.1:8080
//   3. dev mode → http://127.0.0.1:8080 (vite dev server proxy target)
//   4. prod web mode → '' (relative URL — nginx serves /api/* on the same host)
const desktopApiBaseUrl =
  typeof window !== 'undefined' && window.electron?.isDesktop
    ? (window.electron.apiBaseUrl || 'http://127.0.0.1:8080')
    : null;
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (desktopApiBaseUrl || (import.meta.env.DEV ? 'http://127.0.0.1:8080' : ''));

let authToken: string | null = localStorage.getItem('radix_auth_token');

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem('radix_auth_token', token);
}

export function clearAuthToken() {
  authToken = null;
  localStorage.removeItem('radix_auth_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  config?: { timeoutMs?: number; json?: boolean },
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

export const authApi = {
  login: (email: string, password: string, rememberMe = false) =>
    request<{ token: string; rememberMe: boolean; user: any }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password, rememberMe }) },
    ),
  register: (email: string, password: string, name: string, rememberMe = false) =>
    request<{ token: string; rememberMe: boolean; user: any }>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, name, rememberMe }) },
    ),
  me: () => request<any>('/api/auth/me'),
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

export const calendarApi = {
  generate: (clientId: string, month: string, pieceCount = 18) =>
    request<{ jobId: string }>(`/api/clients/${clientId}/calendar/generate`, { method: 'POST', body: JSON.stringify({ month, pieceCount }) }),
  listMonths: (clientId: string) =>
    request<{ id: string; month: string; status: string; createdAt: string; postCount: number }[]>(
      `/api/clients/${clientId}/calendar/months`
    ),
  getMonth: (clientId: string, month: string) =>
    request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}`),
  updatePost: (postId: string, data: any) =>
    request<any>(`/api/calendar-posts/${postId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePost: (postId: string) =>
    request<{ success: boolean; deletedId: string }>(`/api/calendar-posts/${postId}`, { method: 'DELETE' }),
  deleteMonth: (clientId: string, month: string) =>
    request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}`, { method: 'DELETE' }),
  backfillVisualRefs: (clientId: string, month: string, count = 6) =>
    request<{ month: string; postsScanned: number; postsEligible: number; postsBackfilled: number; totalRefsAdded: number; failures: any[] }>(
      `/api/clients/${clientId}/calendar/${encodeURIComponent(month)}/visual-refs/backfill`,
      { method: 'POST', body: JSON.stringify({ count }) },
      { timeoutMs: 240000 },
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

export async function isServerAvailable(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
