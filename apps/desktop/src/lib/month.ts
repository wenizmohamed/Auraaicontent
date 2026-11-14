// Calendar months arrive in two formats: ISO "2026-06" (agent tools and newer
// rows) and the label "June 2026" (older rows and the calendar editor). Every
// screen that turns a month into a date goes through this one parser, so a
// label never falls through to "January" again.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** First day of the month a calendar string names. Falls back to this month. */
export function parseCalendarMonth(month: string | null | undefined): Date {
  const s = String(month || '').trim();
  const iso = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (iso) return new Date(Number(iso[1]), Math.min(Math.max(Number(iso[2]), 1), 12) - 1, 1);
  const label = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(s);
  if (label) {
    const idx = MONTHS.indexOf(label[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return new Date(Number(label[2]), idx, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** "June 2026" in the reader's locale, for either input format. */
export function calendarMonthLabel(month: string | null | undefined): string {
  return parseCalendarMonth(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
