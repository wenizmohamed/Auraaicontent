// Who may see money in the product.
//
// Weni, 2026-08-02: prices, per-second rates and spend totals are for owners,
// admins and the accounting team only. Everyone else (editors, viewers, the
// people actually making content) should never see a cost figure.
//
// Additive by design, and matches the STAFF_EMAILS / TEAM_ADMIN_EMAILS pattern
// already used elsewhere: an OWNER/ADMIN always qualifies by role, and anyone
// listed in ACCOUNTING_EMAILS (or STAFF_EMAILS) qualifies by email regardless
// of their org role — so accounting can be a plain member. Matching is
// case-insensitive; a person with several logins should list every address.

function emailSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canSeePricing(email?: string | null, orgRole?: string | null): boolean {
  const role = (orgRole || '').toUpperCase();
  if (role === 'OWNER' || role === 'ADMIN') return true;
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  return emailSet(process.env.ACCOUNTING_EMAILS).has(e) || emailSet(process.env.STAFF_EMAILS).has(e);
}
