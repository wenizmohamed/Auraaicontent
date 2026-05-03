/**
 * OAuth state-param store — CSRF protection for the authorization-code flow.
 *
 * In-memory Map with 5-min TTL. Sufficient for a single-process deployment;
 * if/when the server runs as multiple replicas, swap this for Redis (the
 * existing REDIS_URL env is already wired).
 *
 * Each entry is keyed by an unguessable random token and stores the
 * destination context (orgId, clientId, platform, returnUrl). The platform
 * callback validates the state matches before exchanging the code.
 */
import { randomBytes } from 'node:crypto';

interface StateEntry {
  orgId: string;
  userId: string;
  clientId: string;
  platform: string;
  returnUrl: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const store = new Map<string, StateEntry>();

/** Lazy GC — runs on every put. Cheap because most entries expire fast. */
function gc(): void {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}

export function issueState(payload: Omit<StateEntry, 'expiresAt'>): string {
  gc();
  const token = randomBytes(24).toString('base64url');
  store.set(token, { ...payload, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumeState(token: string): StateEntry | null {
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token); // single-use
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
