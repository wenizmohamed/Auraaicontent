// Backend API client — connects desktop frontend to Fastify server
// Falls back to localStorage when server is unavailable

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

let authToken: string | null = localStorage.getItem('radix_auth_token');

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem('radix_auth_token', token);
}

export function clearAuthToken() {
  authToken = null;
  localStorage.removeItem('radix_auth_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as any || {}),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(30000) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, name: string) =>
    request<{ token: string; user: any }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
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
  getMonth: (clientId: string, month: string) =>
    request<any>(`/api/clients/${clientId}/calendar/${encodeURIComponent(month)}`),
  updatePost: (postId: string, data: any) =>
    request<any>(`/api/calendar-posts/${postId}`, { method: 'PATCH', body: JSON.stringify(data) }),
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

// ─── Server health check ─────────────────────────────────────────

export async function isServerAvailable(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
