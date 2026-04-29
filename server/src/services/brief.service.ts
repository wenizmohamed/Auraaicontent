import { db } from '../db/prisma.js';

// Fields that contribute to completeness score
const REQUIRED_FIELDS = [
  'objective', 'audience', 'tone', 'brandDo', 'brandDont',
] as const;

const REQUIRED_ARRAYS = [
  'products', 'pillars', 'channels',
] as const;

export const briefService = {
  async getByClientId(orgId: string, clientId: string) {
    // clientId is unique on ClientBrief (1-to-1), so we filter by it then
    // verify orgId.  findFirst lets us include orgId in the where without
    // needing a composite unique index.
    return db.clientBrief.findFirst({ where: { clientId, orgId } });
  },

  // Upsert — create if missing, update if exists. orgId required because
  // ClientBrief.orgId is NOT NULL post-migration.
  async upsert(orgId: string, clientId: string, data: any) {
    const { id, clientId: _, orgId: __, createdAt, updatedAt, client, ...briefData } = data;
    // ClientBrief has @@unique([clientId]) — we can upsert by clientId and
    // include orgId in create.  Existing rows already carry the right orgId
    // from the multi-tenancy migration backfill.
    return db.clientBrief.upsert({
      where: { clientId },
      create: { clientId, orgId, ...briefData },
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
