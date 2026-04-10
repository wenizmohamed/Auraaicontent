// Single source of truth for prompt templates — server-side only
// packages/prompts/ is the canonical reference but tsc can't cross-workspace import
// This file IS the working implementation. packages/prompts/ is documentation/reference only.

// Platform character/hashtag limits — keyed by canonical platform name
const PLATFORM_LIMITS: Record<string, string> = {
  Instagram: 'Instagram: max 2200 chars, 5 hashtags',
  TikTok: 'TikTok: max 4000 chars, 5 hashtags',
  LinkedIn: 'LinkedIn: max 3000 chars, 5 hashtags',
  X: 'X: max 280 chars, 2 hashtags',
  Facebook: 'Facebook: max 63206 chars, 3 hashtags',
};

// Parse a brief.channels field (array or JSON string) into a normalized platform list.
// Returns canonical platform names that match PLATFORM_LIMITS keys.
export function parseBriefChannels(raw: any): string[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  // Canonicalize: case-insensitive match, trim, map "twitter" -> "X"
  const canonical: string[] = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'instagram') canonical.push('Instagram');
    else if (lower === 'tiktok') canonical.push('TikTok');
    else if (lower === 'linkedin') canonical.push('LinkedIn');
    else if (lower === 'x' || lower === 'twitter' || lower === 'x (twitter)') canonical.push('X');
    else if (lower === 'facebook') canonical.push('Facebook');
    // Unknown platform names are dropped — the brief UI only emits the 5 known ones
  }
  // Dedupe while preserving order
  return [...new Set(canonical)];
}

export function buildPlanningPrompt(p: { client: any; brief: any; assets: any[]; month: string; pieceCount: number }): string {
  const s: string[] = [];
  s.push(`You are an expert social media content strategist for ${p.client.name}, a ${p.client.industry || 'general'} company.`);
  s.push('\n=== CLIENT ===');
  s.push(`Name: ${p.client.name}`);
  if (p.client.industry) s.push(`Industry: ${p.client.industry}`);
  if (p.client.website) s.push(`Website: ${p.client.website}`);

  // Selected platforms — the ONLY platforms the AI is allowed to use
  const channels = parseBriefChannels(p.brief?.channels);

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
    fmtArr('Campaign Moments', p.brief.campaignMoments);
  }

  // Platforms block — HARD RESTRICTION on what the AI can output
  s.push('\n=== ALLOWED PLATFORMS (HARD RESTRICTION) ===');
  if (channels.length > 0) {
    s.push(`You may ONLY generate posts for these exact platforms: ${channels.join(', ')}.`);
    s.push('Do NOT generate posts for any other platform. Every post.platform value MUST be one of the above.');
    if (channels.length === 1) {
      s.push(`All ${p.pieceCount} posts must use platform "${channels[0]}".`);
    } else {
      s.push(`Distribute the ${p.pieceCount} posts across ONLY these ${channels.length} platforms. Do not introduce others.`);
    }
    s.push('\nPlatform limits for allowed platforms:');
    for (const ch of channels) {
      if (PLATFORM_LIMITS[ch]) s.push(`- ${PLATFORM_LIMITS[ch]}`);
    }
  } else {
    // Fallback: if no channels configured (shouldn't happen — brief completeness gate requires it)
    s.push('No channels specified in brief. Default to Instagram only.');
    s.push('- ' + PLATFORM_LIMITS.Instagram);
  }

  s.push(`\n=== TASK ===\nGenerate exactly ${p.pieceCount} content pieces for ${p.month} as JSON.`);
  s.push('Return: {"strategySummary":{"overview":"...","themes":[...],"channelFocus":{...}},"posts":[{"date":"...","title":"...","pillar":"...","platform":"...","format":"...","hook":"...","keyMessage":"...","caption":"...","cta":"...","hashtags":[...],"visualDirection":"...","referenceSearchQuery":"...","ideaRationale":"...","timing":"..."}]}');
  const allowedList = channels.length > 0 ? channels.join('|') : 'Instagram';
  s.push(`\nRULES:
1. Every post.platform MUST be one of: ${allowedList}. No other platforms allowed.
2. Captions must stay within the character limits for the allowed platforms listed above.
3. Vary formats (Static/Carousel/Reel/Video) and pillars across posts.
4. Distribute posts evenly across the calendar month.
5. Return ONLY valid JSON. No markdown, no commentary.`);
  return s.join('\n');
}
