import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

// Reuse the resolved API URL from backend-api.ts. The user's stored override
// (radix_api_url) is the authoritative target after the boot health-cascade,
// so socket connects there too.
function resolveSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('radix_api_url') || window.location.origin;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('radix_auth_token');
}

export interface JobUpdate {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  updatedAt: string;
}

interface UseJobSocketOptions {
  onProgress?: (job: JobUpdate) => void;
  onComplete?: (job: JobUpdate) => void;
  onError?: (job: JobUpdate) => void;
  pollFallbackMs?: number;  // default 2000
  pollFetcher?: (jobId: string) => Promise<JobUpdate | null>;
}

// Singleton socket — one connection shared across all hooks. Each subscriber
// joins the job:{id} room independently. Disconnect on idle is handled by
// socket.io's auto-reconnect + server-side timeout.
let _socket: Socket | null = null;
function getSocket(): Socket | null {
  const token = getAuthToken();
  if (!token) return null;
  if (_socket?.connected) return _socket;
  if (_socket) return _socket; // still connecting. Let it finish

  const url = resolveSocketUrl();
  _socket = io(url, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 3,
    reconnectionDelay: 1000,
    timeout: 4000,
  });

  _socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err.message);
  });

  return _socket;
}

export function disconnectJobSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

/**
 * useJobSocket — live progress for a BullMQ job.
 *
 * Connects to /socket.io, subscribes to job:{id}, fires the supplied
 * callbacks on each update. If WS connect fails or drops, falls back to
 * polling via pollFetcher (default: jobsApi.get).
 *
 * Pass null/undefined as jobId to no-op (useful when job hasn't been
 * created yet but the hook needs to mount).
 */
export function useJobSocket(jobId: string | null | undefined, opts: UseJobSocketOptions = {}) {
  const { onProgress, onComplete, onError, pollFallbackMs = 2000, pollFetcher } = opts;
  const [job, setJob] = useState<JobUpdate | null>(null);
  const [transport, setTransport] = useState<'socket' | 'poll' | 'idle'>('idle');
  const callbacksRef = useRef({ onProgress, onComplete, onError });
  callbacksRef.current = { onProgress, onComplete, onError };

  useEffect(() => {
    if (!jobId) {
      setTransport('idle');
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const handle = (next: JobUpdate) => {
      if (cancelled) return;
      setJob(next);
      const cb = callbacksRef.current;
      if (next.status === 'completed') {
        cb.onComplete?.(next);
      } else if (next.status === 'failed') {
        cb.onError?.(next);
      } else {
        cb.onProgress?.(next);
      }
    };

    const startPolling = () => {
      if (!pollFetcher || pollTimer) return;
      setTransport('poll');
      const tick = async () => {
        if (cancelled) return;
        try {
          const next = await pollFetcher(jobId);
          if (next) handle(next);
          if (next?.status === 'completed' || next?.status === 'failed') {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          }
        } catch {
          /* swallow — keep polling */
        }
      };
      tick();
      pollTimer = setInterval(tick, pollFallbackMs);
    };

    const socket = getSocket();
    if (!socket) {
      // No auth token / no socket available — polling only.
      startPolling();
      return () => {
        cancelled = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    let socketHealthy = false;

    const onUpdate = (next: JobUpdate) => {
      if (next.id !== jobId) return;
      handle(next);
    };

    const subscribe = () => {
      socket.emit('subscribe-job', jobId, (res: { ok: boolean; job?: JobUpdate; error?: string }) => {
        if (cancelled) return;
        if (res?.ok && res.job) {
          socketHealthy = true;
          setTransport('socket');
          handle(res.job);
        } else {
          // Server says no — fall back to polling so the user still sees state.
          startPolling();
        }
      });
    };

    socket.on('job:update', onUpdate);

    if (socket.connected) {
      subscribe();
    } else {
      socket.once('connect', subscribe);
    }

    // Connect timeout — if the socket never gets healthy in 3s, kick polling.
    const connectTimeout = setTimeout(() => {
      if (!cancelled && !socketHealthy) startPolling();
    }, 3000);

    socket.on('disconnect', () => {
      if (!cancelled) startPolling();
    });

    return () => {
      cancelled = true;
      clearTimeout(connectTimeout);
      socket.off('job:update', onUpdate);
      socket.emit('unsubscribe-job', jobId);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [jobId, pollFallbackMs, pollFetcher]);

  return { job, transport };
}
