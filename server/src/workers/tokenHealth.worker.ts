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

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000; // hourly

let started = false;

export function startTokenHealthWorker(): void {
  if (started) return;
  started = true;
  console.log('[tokenHealth] started — refresh horizon: 7d, tick: 1h');
  // Run once shortly after boot, then on the interval
  setTimeout(() => { void runOnce(); }, 60_000);
  setInterval(() => { void runOnce(); }, TICK_MS);
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

  let ok = 0, fail = 0;
  for (const conn of conns) {
    try {
      const mod = getPlatformModule(conn.platform);
      const fresh = await mod.oauth.refresh({
        refreshToken: decryptOpt(conn.refreshTokenEnc),
        accessToken: decrypt(conn.accessTokenEnc),
      });
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
      ok++;
    } catch (err: any) {
      await systemDb.platformConnection.update({
        where: { id: conn.id },
        data: { status: 'needs_reauth', lastError: err.message?.slice(0, 500) },
      });
      fail++;
    }
  }
  console.log(`[tokenHealth] tick complete: ${ok} refreshed, ${fail} marked needs_reauth`);
}
