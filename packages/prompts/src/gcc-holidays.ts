// GCC + MENA calendar moments. Hijri dates are converted from
// Umm al-Qura table observations; values rounded to civil dates and
// updated annually. National Days are Gregorian and stable.
//
// `getUpcomingHolidays(month, range)` is consumed by the Arabic prompt
// builder so the model factors Ramadan/Eid timing into the calendar
// rather than scheduling tone-deaf posts on Eid morning.

export interface Holiday {
  name: string;
  date: string;        // YYYY-MM-DD (Gregorian)
  type: 'religious' | 'national' | 'cultural';
  countries?: string[]; // ISO codes; omit = pan-MENA
  toneGuidance?: string;
}

// Hijri 1447 → 2026 alignment (approximate civil dates — confirm via Umm
// al-Qura before sending production calendars). Update annually.
export const MENA_HOLIDAYS_2026: Holiday[] = [
  // Religious
  { name: 'Ramadan begins', date: '2026-02-17', type: 'religious', toneGuidance: 'Reflective, community-focused tone. Avoid food/drink imagery before iftar.' },
  { name: 'Mid-Ramadan', date: '2026-03-04', type: 'religious', toneGuidance: 'Charity (zakat, sadaqah), reflection.' },
  { name: 'Laylat al-Qadr', date: '2026-03-13', type: 'religious', toneGuidance: 'Spiritual, contemplative. No promotional pushes.' },
  { name: 'Eid al-Fitr', date: '2026-03-19', type: 'religious', toneGuidance: 'Celebratory, family, gifting. عيد مبارك. Soft commerce ok.' },
  { name: 'Eid al-Adha', date: '2026-05-26', type: 'religious', toneGuidance: 'Celebratory, sacrifice, family gatherings.' },
  { name: 'Hijri New Year (1448)', date: '2026-06-15', type: 'religious' },
  { name: 'Ashura', date: '2026-06-24', type: 'religious', toneGuidance: 'Quiet, no promos in Shia-majority audiences.' },
  { name: 'Mawlid al-Nabi', date: '2026-08-23', type: 'religious' },

  // National Days
  { name: 'Saudi National Day', date: '2026-09-23', type: 'national', countries: ['SA'], toneGuidance: 'Patriotic, Vision 2030, green/white palette.' },
  { name: 'Oman National Day', date: '2026-11-18', type: 'national', countries: ['OM'] },
  { name: 'UAE National Day', date: '2026-12-02', type: 'national', countries: ['AE'], toneGuidance: 'Patriotic, unity (UAE was founded by 7 emirates), red/white/black/green.' },
  { name: 'Bahrain National Day', date: '2026-12-16', type: 'national', countries: ['BH'] },
  { name: 'Qatar National Day', date: '2026-12-18', type: 'national', countries: ['QA'] },
  { name: 'Kuwait National Day', date: '2027-02-25', type: 'national', countries: ['KW'] },

  // Cultural
  { name: 'Emirati Women\'s Day', date: '2026-08-28', type: 'cultural', countries: ['AE'] },
  { name: 'Saudi Founding Day', date: '2026-02-22', type: 'cultural', countries: ['SA'] },
  { name: 'International Women\'s Day', date: '2026-03-08', type: 'cultural' },
  { name: 'Earth Hour', date: '2026-03-28', type: 'cultural' },
];

// Returns holidays falling within [start, start + days). Pass the first day
// of the calendar month and a range of ~45 days to also surface holidays
// that bleed into the following month — agencies plan one month ahead.
export function getUpcomingHolidays(start: Date, days = 45, country?: string): Holiday[] {
  const end = new Date(start.getTime() + days * 86400000);
  return MENA_HOLIDAYS_2026.filter((h) => {
    const d = new Date(h.date);
    if (d < start || d >= end) return false;
    if (country && h.countries && !h.countries.includes(country)) return false;
    return true;
  });
}

// Quick "is this date inside Ramadan?" check used by the prompt to inject
// Ramadan-tone guidance for posts scheduled during the month.
export function isInRamadan(date: Date): boolean {
  const start = new Date('2026-02-17');
  const end = new Date('2026-03-19');
  return date >= start && date < end;
}
