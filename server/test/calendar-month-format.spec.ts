import { describe, it, expect, vi } from 'vitest';
import { monthIso, monthLabel, monthVariants, exactThenVariants } from '../src/lib/month';

// Calendar months are stored as "October 2026" (calendar screen) or "2026-10"
// (older agent rows). Prod held both, and one client had October twice.
describe('calendar month formats', () => {
  it('reads both formats', () => {
    expect(monthIso('October 2026')).toBe('2026-10');
    expect(monthIso('Oct 2026')).toBe('2026-10');
    expect(monthIso('2026-10')).toBe('2026-10');
    expect(monthIso('2026-1')).toBe('2026-01');
    expect(monthIso('Kimi Verify Run161834')).toBe('');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('october 2026')).toBe('October 2026');
    expect(monthLabel('not a month')).toBe('not a month');
  });

  it('lists every stored form so a duplicate check sees both', () => {
    expect(monthVariants('2026-10').sort()).toEqual(['2026-10', 'October 2026']);
    expect(monthVariants('October 2026').sort()).toEqual(['2026-10', 'October 2026']);
  });

  it('prefers the exact row, then falls back to the other format', async () => {
    const rows: Record<string, string> = { 'October 2026': 'label-row', '2026-10': 'iso-row' };
    const find = vi.fn(async (m: string | { in: string[] }) =>
      typeof m === 'string' ? rows[m] ?? null : m.in.map((x) => rows[x]).find(Boolean) ?? null);
    expect(await exactThenVariants('2026-10', find)).toBe('iso-row');
    expect(await exactThenVariants('October 2026', find)).toBe('label-row');
    delete rows['2026-10'];
    expect(await exactThenVariants('2026-10', find)).toBe('label-row');
  });
});
