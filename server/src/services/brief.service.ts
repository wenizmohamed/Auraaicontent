import { db } from '../db/prisma.js';

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
    if (month != null && month !== '') {
      const exact = await db.clientBrief.findFirst({ where: { clientId, orgId, month } });
      if (exact) return exact;
      // fall back to the default brief for months without a dedicated one
      return db.clientBrief.findFirst({ where: { clientId, orgId, month: '' } });
    }
    const def = await db.clientBrief.findFirst({ where: { clientId, orgId, month: '' } });
    if (def) return def;
    return db.clientBrief.findFirst({ where: { clientId, orgId }, orderBy: { updatedAt: 'desc' } });
  },

  // All briefs for a client, newest first (for "copy last month" + history UI).
  async list(orgId: string, clientId: string) {
    return db.clientBrief.findMany({ where: { clientId, orgId }, orderBy: [{ month: 'desc' }, { updatedAt: 'desc' }] });
  },

  // Upsert keyed on (clientId, month). Create if that month's brief is missing,
  // update it if it exists. month defaults to '' (the legacy default brief).
  async upsert(orgId: string, clientId: string, data: any, month = '') {
    const { id, clientId: _, orgId: __, month: ___, createdAt, updatedAt, client, ...briefData } = data;
    return db.clientBrief.upsert({
      where: { clientId_month: { clientId, month } },
      create: { clientId, orgId, month, ...briefData },
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
