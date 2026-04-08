const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export async function reviewApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as any || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const review = {
  getPayload: (token: string) => reviewApi<any>(`/api/review/${token}`),
  addComment: (token: string, postId: string, data: { authorName: string; comment: string }) =>
    reviewApi<any>(`/api/review/${token}/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  approvePost: (token: string, postId: string) =>
    reviewApi<any>(`/api/review/${token}/posts/${postId}/approve`, { method: 'POST' }),
  approveMonth: (token: string) =>
    reviewApi<any>(`/api/review/${token}/month/approve`, { method: 'POST' }),
};
