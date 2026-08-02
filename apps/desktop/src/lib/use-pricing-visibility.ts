// Who may see money in the UI.
//
// Weni, 2026-08-02: prices, per-second rates and spend totals are for owners,
// admins and accounting only. Editors and viewers (the people making content)
// should never see a cost figure.
//
// The server is the authority: /api/auth/me returns canSeePricing, computed
// from org role plus the ACCOUNTING_EMAILS allowlist, and the spend endpoint
// refuses unauthorised callers regardless of what the UI does. This hook only
// decides what to render. It defaults to HIDDEN while loading and on any
// error, so a failed lookup can never flash a price.

import { useEffect, useState } from 'react';
import { authApi } from './backend-api';

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function fetchFlag(): Promise<boolean> {
  if (cached !== null) return cached;
  if (!inflight) {
    inflight = authApi
      .me()
      .then((u) => {
        cached = Boolean((u as { canSeePricing?: boolean }).canSeePricing);
        return cached;
      })
      .catch(() => false)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function usePricingVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let alive = true;
    fetchFlag().then((v) => { if (alive) setVisible(v); });
    return () => { alive = false; };
  }, []);
  return visible;
}

/** Clear on logout / org switch so the next user re-resolves their own access. */
export function resetPricingVisibility(): void {
  cached = null;
}
