/**
 * Token health worker — runs hourly via setInterval (started in app.ts).
 *
 * For every PlatformConnection with status='connected' and expiresAt within
 * 7 days, attempt a proactive refresh. On success, store new tokens. On
 * failure, mark 'needs_reauth' so the UI shows a Reconnect button before
 * the user hits a publish failure.
 */
// systemDb (unguarded) — this worker is a cross-org background sweep, same
// pattern as scheduler.worker.ts. Per-request code must use guarded `db`.
import { systemDb } from '../db/prisma.js';
import { decrypt, decryptOpt, encrypt, encryptOpt } from '../lib/secrets.js';
import { getPlatformModule } from '../integrations/registry.js';
import { withRefreshLock } from '../lib/refresh-lock.js';

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000; // hourly
const REFRESH_CONCURRENCY = Number(process.env.TOKEN_HEALTH_CONCURRENCY ?? 8);
const REFRESH_TIMEOUT_MS = Number(process.env.TOKEN_HEALTH_TIMEOUT_MS ?? 15_000);

let started = false;

export function startTokenHealthWorker(): void {
  if (started) return;
  started = true;
  console.log(`[tokenHealth] started — horizon: 7d, tick: 1h, concurrency: ${REFRESH_CONCURRENCY}, timeout: ${REFRESH_TIMEOUT_MS}ms`);
  // Run once shortly after boot, then on the interval
  setTimeout(() => { void runOnce(); }, 60_000);
  setInterval(() => { void runOnce(); }, TICK_MS);
}

/** Run a worker function with bounded concurrency over an array. */
async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push((async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item);
      }
    })());
  }
  await Promise.all(workers);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function runOnce(): Promise<void> {
  const horizon = new Date(Date.now() + HORIZON_MS);
  let conns;
  try {
    conns = await systemDb.platformConnection.findMany({
      where: { status: 'connected', expiresAt: { lte: horizon } },
    });
  } catch (err: any) {
    console.warn('[tokenHealth] DB query failed (table may not exist yet):', err?.message?.slice(0, 200));
    return;
  }
  if (conns.length === 0) return;
  console.log(`[tokenHealth] refreshing ${conns.length} connection(s)…`);

  let ok = 0, fail = 0, skipped = 0;
  await inParallel(conns, REFRESH_CONCURRENCY, async (conn) => {
    // withRefreshLock(connectionId, fn) — returns null if a sibling holds
    // the lock (HARD-2: prevents the slow-writer-overwrites-rotated-token
    // race that flips healthy accounts to needs_reauth).
    const acquired = await withRefreshLock(conn.id, async () => {
      try {
        const mod = getPlatformModule(conn.platform);
        const fresh = await withTimeout(
          mod.oauth.refresh({
            refreshToken: decryptOpt(conn.refreshTokenEnc),
            accessToken: decrypt(conn.accessTokenEnc),
          }),
          REFRESH_TIMEOUT_MS,
          `${conn.platform} refresh`,
        );
        const expiresAt = fresh.expiresInSec ? new Date(Date.now() + fresh.expiresInSec * 1000) : null;
        await systemDb.platformConnection.update({
          where: { id: conn.id },
          data: {
            accessTokenEnc: encrypt(fresh.accessToken),
            refreshTokenEnc: encryptOpt(fresh.refreshToken ?? decryptOpt(conn.refreshTokenEnc)),
            expiresAt,
            status: 'connected',
            lastError: null,
          },
        });
        return 'ok' as const;
      } catch (err: any) {
        await systemDb.platformConnection.update({
          where: { id: conn.id },
          data: { status: 'needs_reauth', lastError: err.message?.slice(0, 500) },
        });
        return 'fail' as const;
      }
    });
    if (acquired === null) skipped++;
    else if (acquired === 'ok') ok++;
    else fail++;
  });
  console.log(`[tokenHealth] tick complete: ${ok} refreshed, ${fail} needs_reauth, ${skipped} skipped (sibling lock)`);
}
