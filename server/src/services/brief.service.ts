import { db } from '../db/prisma.js';

// Brief months are SAVED in canonical ISO "YYYY-MM" (from BriefInput's month
// picker `value`), but calendar generation historically passes the human LABEL
// ("July 2026") — the two never string-matched, so per-month briefs silently
// never applied and month-only clients hard-failed with "brief missing".
// normalizeMonth() collapses either form to the canonical "YYYY-MM" key (or ''
// for the legacy/default brief) so lookups match regardless of caller format.
const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
export function normalizeMonth(month?: string | null): string {
  if (!month) return '';
  const s = String(month).trim();
  if (!s) return '';
  // Already canonical "YYYY-MM" (allow "YYYY-MM-DD" too)
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  // Human label like "July 2026" / "Jul 2026"
  const m = s.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  if (m) {
    const key = Object.keys(MONTH_NAMES).find(name => name.startsWith(m[1].slice(0, 3)));
    if (key) return `${m[2]}-${MONTH_NAMES[key]}`;
  }
  return s; // unknown format — compare as-is
}

// Fields that contribute to completeness score
const REQUIRED_FIELDS = [
  'objective', 'audience', 'tone', 'brandDo', 'brandDont',
] as const;

const REQUIRED_ARRAYS = [
  'products', 'pillars', 'channels',
] as const;

export const briefService = {
  // Brief-per-month (2026-07-14). A client can have many briefs keyed by month;
  // month='' is the legacy/default brief. getByClientId(orgId, clientId, month?)
  //  - with month: that month's brief, falling back to the '' default so
  //    generation for a month with no dedicated brief still works.
  //  - without month: the default ('') brief if present, else the most recent —
  //    so every context consumer (assistant/design/research/etc.) keeps getting
  //    "the client's brief" exactly as before.
  async getByClientId(orgId: string, clientId: string, month?: string) {
    // Load every brief once and match in-memory on the NORMALIZED month key so
    // "July 2026" (calendar label) resolves to the "2026-07" saved brief.
    const all = await db.clientBrief.findMany({ where: { clientId, orgId } });
    if (all.length === 0) return null;

    const wanted = normalizeMonth(month);
    if (wanted) {
      const exact = all.find(b => normalizeMonth(b.month) === wanted);
      if (exact) return exact;
    }
    // Prefer the legacy/default ('') brief, then most-recently updated — so a
    // month without a dedicated brief (or a month-only client) still generates
    // instead of hard-failing with "brief missing".
    const def = all.find(b => normalizeMonth(b.month) === '');
    if (def) return def;
    return all.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  },

  // All briefs for a client, newest first (for "copy last month" + history UI).
  async list(orgId: string, clientId: string) {
    return db.clientBrief.findMany({ where: { clientId, orgId }, orderBy: [{ month: 'desc' }, { updatedAt: 'desc' }] });
  },

  // Upsert keyed on (clientId, month). Create if that month's brief is missing,
  // update it if it exists. month defaults to '' (the legacy default brief).
  async upsert(orgId: string, clientId: string, data: any, month = '') {
    const key = normalizeMonth(month); // store canonical "YYYY-MM" (or '')
    const { id, clientId: _, orgId: __, month: ___, createdAt, updatedAt, client, ...briefData } = data;
    return db.clientBrief.upsert({
      where: { clientId_month: { clientId, month: key } },
      create: { clientId, orgId, month: key, ...briefData },
      update: briefData,
    });
  },

  // Completeness score: 0–100 based on required fields
  completeness(brief: any): { score: number; filled: string[]; missing: string[] } {
    if (!brief) return { score: 0, filled: [], missing: [...REQUIRED_FIELDS, ...REQUIRED_ARRAYS] };

    const filled: string[] = [];
    const missing: string[] = [];

    for (const field of REQUIRED_FIELDS) {
      if (brief[field] && String(brief[field]).trim().length > 0) filled.push(field);
      else missing.push(field);
    }

    for (const field of REQUIRED_ARRAYS) {
      const arr = brief[field];
      if (Array.isArray(arr) && arr.length > 0) filled.push(field);
      else if (typeof arr === 'string' && arr.trim().length > 0) filled.push(field); // JSON string
      else missing.push(field);
    }

    const total = REQUIRED_FIELDS.length + REQUIRED_ARRAYS.length;
    const score = Math.round((filled.length / total) * 100);
    return { score, filled, missing };
  },

  // Compile brief into a generation-ready text block for Gemini
  promptPack(client: any, brief: any): string {
    if (!brief) return 'No brief available.';

    const sections: string[] = [];

    sections.push(`CLIENT: ${client.name}`);
    if (client.industry) sections.push(`INDUSTRY: ${client.industry}`);
    if (client.website) sections.push(`WEBSITE: ${client.website}`);
    if (client.instagramHandle) sections.push(`INSTAGRAM: ${client.instagramHandle}`);
    if (client.locale) sections.push(`LOCALE: ${client.locale}`);
    if (client.dialect) sections.push(`DIALECT: ${client.dialect}`);

    sections.push('');
    sections.push('=== BRIEF ===');
    if (brief.objective) sections.push(`OBJECTIVE: ${brief.objective}`);
    if (brief.audience) sections.push(`AUDIENCE: ${brief.audience}`);
    if (brief.tone) sections.push(`TONE: ${brief.tone}`);
    if (brief.brandDo) sections.push(`BRAND DO: ${brief.brandDo}`);
    if (brief.brandDont) sections.push(`BRAND DON'T: ${brief.brandDont}`);

    if (brief.complianceNotes) sections.push(`COMPLIANCE: ${brief.complianceNotes}`);
    if (brief.mandatoryInclusions) sections.push(`MANDATORY INCLUSIONS: ${brief.mandatoryInclusions}`);
    if (brief.cadence) sections.push(`CADENCE: ${brief.cadence}`);
    if (brief.seasonalNotes) sections.push(`SEASONAL: ${brief.seasonalNotes}`);
    if (brief.competitors) sections.push(`COMPETITORS: ${brief.competitors}`);
    if (brief.successDefinition) sections.push(`SUCCESS DEFINITION: ${brief.successDefinition}`);
    if (brief.pastLearnings) sections.push(`PAST LEARNINGS: ${brief.pastLearnings}`);

    const formatJson = (label: string, val: any) => {
      if (!val) return;
      const arr = typeof val === 'string' ? JSON.parse(val) : val;
      if (Array.isArray(arr) && arr.length > 0) {
        sections.push(`${label}:\n${arr.map((item: any) => typeof item === 'string' ? `- ${item}` : `- ${JSON.stringify(item)}`).join('\n')}`);
      }
    };

    formatJson('PRODUCTS', brief.products);
    formatJson('PILLARS', brief.pillars);
    formatJson('CAMPAIGN MOMENTS', brief.campaignMoments);
    formatJson('CHANNELS', brief.channels);
    formatJson('APPROVERS', brief.approvers);

    return sections.join('\n');
  },
};
