// Calendar months exist in two formats: the label "October 2026" (written by
// the calendar screen and the month generator) and ISO "2026-10" (written by
// the agent tools before 2026-11-14). Lookups by raw string missed the other
// format, so a month the agent planned was invisible to the calendar screen and
// the duplicate check let one client hold October twice.
//
// Rules: try the exact string first (two rows for one month both stay
// reachable), then the other format; duplicate checks look at every format;
// new rows are written as the label.

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10" for either format, '' when the string is not a month. */
export function monthIso(month: string | null | undefined): string {
  const s = String(month || '').trim();
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (iso) {
    const n = Number(iso[2]);
    return n >= 1 && n <= 12 ? `${iso[1]}-${String(n).padStart(2, '0')}` : '';
  }
  const label = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(s);
  if (label) {
    const idx = NAMES.findIndex((n) => n.slice(0, 3).toLowerCase() === label[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${label[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  return '';
}

/** "October 2026" for either format; anything else comes back unchanged. */
export function monthLabel(month: string | null | undefined): string {
  const iso = monthIso(month);
  if (!iso) return String(month || '').trim();
  const [y, m] = iso.split('-');
  return `${NAMES[Number(m) - 1]} ${y}`;
}

/** Every stored form of the month: the string as given, then ISO and label. */
export function monthVariants(month: string | null | undefined): string[] {
  const s = String(month || '').trim();
  return [...new Set([s, monthIso(s), monthLabel(s)].filter(Boolean))];
}

/** Run a lookup on the exact string, then on the month's other formats. */
export async function exactThenVariants<T>(
  month: string,
  find: (m: string | { in: string[] }) => Promise<T>,
  isEmpty: (r: T) => boolean = (r) => r == null || (Array.isArray(r) && r.length === 0),
): Promise<T> {
  const exact = await find(month);
  if (!isEmpty(exact)) return exact;
  const others = monthVariants(month).filter((v) => v !== month);
  return others.length ? find({ in: others }) : exact;
}
