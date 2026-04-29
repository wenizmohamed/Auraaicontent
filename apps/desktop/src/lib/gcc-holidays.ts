// Frontend mirror of server/services/prompt.service.ts holidays. Used by
// ContentCalendar.tsx to badge Ramadan / Eid / National Day cells.
// Update annually alongside the server file.

export interface Holiday {
  name: string;
  date: string;        // YYYY-MM-DD
  type: 'religious' | 'national' | 'cultural';
  countries?: string[]; // ISO codes; omit = pan-MENA
  toneGuidance?: string;
}

export const MENA_HOLIDAYS_2026: Holiday[] = [
  { name: 'Ramadan begins', date: '2026-02-17', type: 'religious', toneGuidance: 'Avoid food/drink imagery before iftar.' },
  { name: 'Mid-Ramadan', date: '2026-03-04', type: 'religious' },
  { name: 'Laylat al-Qadr', date: '2026-03-13', type: 'religious' },
  { name: 'Eid al-Fitr', date: '2026-03-19', type: 'religious', toneGuidance: 'Celebratory, family.' },
  { name: 'Eid al-Adha', date: '2026-05-26', type: 'religious' },
  { name: 'Hijri New Year (1448)', date: '2026-06-15', type: 'religious' },
  { name: 'Mawlid al-Nabi', date: '2026-08-23', type: 'religious' },
  { name: 'Saudi National Day', date: '2026-09-23', type: 'national', countries: ['SA'] },
  { name: 'Oman National Day', date: '2026-11-18', type: 'national', countries: ['OM'] },
  { name: 'UAE National Day', date: '2026-12-02', type: 'national', countries: ['AE'] },
  { name: 'Bahrain National Day', date: '2026-12-16', type: 'national', countries: ['BH'] },
  { name: 'Qatar National Day', date: '2026-12-18', type: 'national', countries: ['QA'] },
  { name: 'Kuwait National Day', date: '2027-02-25', type: 'national', countries: ['KW'] },
  { name: 'Emirati Women\'s Day', date: '2026-08-28', type: 'cultural', countries: ['AE'] },
  { name: 'Saudi Founding Day', date: '2026-02-22', type: 'cultural', countries: ['SA'] },
  { name: 'International Women\'s Day', date: '2026-03-08', type: 'cultural' },
];

export function holidaysForDate(date: Date, country?: string): Holiday[] {
  const iso = date.toISOString().slice(0, 10);
  return MENA_HOLIDAYS_2026.filter((h) => {
    if (h.date !== iso) return false;
    if (country && h.countries && !h.countries.includes(country)) return false;
    return true;
  });
}

export function isInRamadan(date: Date): boolean {
  const start = new Date('2026-02-17');
  const end = new Date('2026-03-19');
  return date >= start && date < end;
}

// Hijri date display via Intl.DateTimeFormat — modern browsers + Electron
// ship with the Umm al-Qura calendar. Returns a string like "12 شوال 1447".
export function hijriDateLabel(date: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return '';
  }
}
