// Single source of truth for prompt templates — server-side only
// packages/prompts/ is the canonical reference but tsc can't cross-workspace import
// This file IS the working implementation. packages/prompts/ is documentation/reference only.

export function buildPlanningPrompt(p: { client: any; brief: any; assets: any[]; month: string; pieceCount: number }): string {
  const s: string[] = [];
  s.push(`You are an expert social media content strategist for ${p.client.name}, a ${p.client.industry || 'general'} company.`);
  s.push('\n=== CLIENT ===');
  s.push(`Name: ${p.client.name}`);
  if (p.client.industry) s.push(`Industry: ${p.client.industry}`);
  if (p.client.website) s.push(`Website: ${p.client.website}`);
  if (p.brief) {
    s.push('\n=== BRIEF ===');
    if (p.brief.objective) s.push(`Objective: ${p.brief.objective}`);
    if (p.brief.audience) s.push(`Audience: ${p.brief.audience}`);
    if (p.brief.tone) s.push(`Tone: ${p.brief.tone}`);
    if (p.brief.brandDo) s.push(`Brand Do: ${p.brief.brandDo}`);
    if (p.brief.brandDont) s.push(`Brand Don't: ${p.brief.brandDont}`);
    if (p.brief.complianceNotes) s.push(`Compliance: ${p.brief.complianceNotes}`);
    const fmtArr = (l: string, v: any) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(a) && a.length) s.push(`${l}: ${a.join(', ')}`); } catch {} };
    fmtArr('Products', p.brief.products);
    fmtArr('Pillars', p.brief.pillars);
    fmtArr('Channels', p.brief.channels);
    fmtArr('Campaign Moments', p.brief.campaignMoments);
  }
  s.push('\n=== PLATFORM LIMITS ===');
  s.push('Instagram: max 2200 chars, 5 hashtags. TikTok: max 4000, 5 hashtags. LinkedIn: max 3000, 5 hashtags. X: max 280, 2 hashtags. Facebook: max 63206, 3 hashtags.');
  s.push(`\n=== TASK ===\nGenerate exactly ${p.pieceCount} content pieces for ${p.month} as JSON.`);
  s.push('Return: {"strategySummary":{"overview":"...","themes":[...],"channelFocus":{...}},"posts":[{"date":"...","title":"...","pillar":"...","platform":"...","format":"...","hook":"...","keyMessage":"...","caption":"...","cta":"...","hashtags":[...],"visualDirection":"...","referenceSearchQuery":"...","ideaRationale":"...","timing":"..."}]}');
  s.push('\nRULES: Captions within platform limits. Mix platforms/formats. Distribute evenly. Return ONLY valid JSON.');
  return s.join('\n');
}
