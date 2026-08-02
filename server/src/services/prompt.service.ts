// Single source of truth for prompt templates — server-side only.
// packages/prompts/ is documentation; tsc can't cross-workspace import,
// so the actual builder is here. Arabic and English variants live side
// by side; client.locale picks which one runs.
import { HUMAN_VOICE_RULE } from '../lib/human-voice.js';


const PLATFORM_LIMITS: Record<string, string> = {
  Instagram: 'Instagram: max 2200 chars, 5 hashtags',
  TikTok: 'TikTok: max 4000 chars, 5 hashtags',
  LinkedIn: 'LinkedIn: max 3000 chars, 5 hashtags',
  X: 'X: max 280 chars, 2 hashtags',
  Facebook: 'Facebook: max 63206 chars, 3 hashtags',
};

export type ArabicDialect = 'MSA' | 'KHALEEJI' | 'EGYPTIAN' | 'LEVANTINE';

const DIALECT_GUIDANCE: Record<ArabicDialect, string> = {
  MSA:       'الفصحى الحديثة (MSA). Neutral pan-Arab tone, no slang.',
  KHALEEJI:  'لهجة خليجية. Gulf vocabulary (شلونك، إن شاء الله). UAE/KSA/Qatar/Bahrain/Kuwait/Oman audience.',
  EGYPTIAN:  'لهجة مصرية. Cairene vocabulary (إزيك، يعني). Egyptian/pop-Arab audience.',
  LEVANTINE: 'لهجة شامية. Beirut/Damascus/Amman vocabulary.',
};

// GCC + MENA holidays for 2026. Update annually.
interface HolidayRow { name: string; date: string; type: 'religious' | 'national' | 'cultural'; countries?: string[]; toneGuidance?: string }
const MENA_HOLIDAYS_2026: HolidayRow[] = [
  { name: 'Ramadan begins', date: '2026-02-17', type: 'religious', toneGuidance: 'Reflective, community. Avoid food/drink imagery before iftar.' },
  { name: 'Mid-Ramadan', date: '2026-03-04', type: 'religious', toneGuidance: 'Charity, reflection.' },
  { name: 'Laylat al-Qadr', date: '2026-03-13', type: 'religious', toneGuidance: 'Spiritual, no promotional pushes.' },
  { name: 'Eid al-Fitr', date: '2026-03-19', type: 'religious', toneGuidance: 'Celebratory, family, gifting.' },
  { name: 'Eid al-Adha', date: '2026-05-26', type: 'religious', toneGuidance: 'Celebratory, sacrifice.' },
  { name: 'Hijri New Year (1448)', date: '2026-06-15', type: 'religious' },
  { name: 'Mawlid al-Nabi', date: '2026-08-23', type: 'religious' },
  { name: 'Saudi National Day', date: '2026-09-23', type: 'national', countries: ['SA'], toneGuidance: 'Patriotic, Vision 2030.' },
  { name: 'Oman National Day', date: '2026-11-18', type: 'national', countries: ['OM'] },
  { name: 'UAE National Day', date: '2026-12-02', type: 'national', countries: ['AE'], toneGuidance: 'Patriotic, unity.' },
  { name: 'Bahrain National Day', date: '2026-12-16', type: 'national', countries: ['BH'] },
  { name: 'Qatar National Day', date: '2026-12-18', type: 'national', countries: ['QA'] },
  { name: 'Kuwait National Day', date: '2027-02-25', type: 'national', countries: ['KW'] },
  { name: 'Emirati Women\'s Day', date: '2026-08-28', type: 'cultural', countries: ['AE'] },
  { name: 'Saudi Founding Day', date: '2026-02-22', type: 'cultural', countries: ['SA'] },
  { name: 'International Women\'s Day', date: '2026-03-08', type: 'cultural' },
];

export function getUpcomingHolidays(monthLabel: string, country?: string): HolidayRow[] {
  // Best-effort parse of "May 2026" / "2026-05" formats. Falls back to
  // current date if parsing fails — better than throwing inside the worker.
  const fallback = new Date();
  let start = fallback;
  const m = monthLabel.match(/(\d{4})-(\d{2})/);
  const m2 = monthLabel.match(/(\w+)\s+(\d{4})/);
  if (m) start = new Date(`${m[1]}-${m[2]}-01`);
  else if (m2) start = new Date(`${m2[1]} 1, ${m2[2]}`);
  if (isNaN(start.getTime())) start = fallback;
  const end = new Date(start.getTime() + 45 * 86400000);
  return MENA_HOLIDAYS_2026.filter((h) => {
    const d = new Date(h.date);
    if (d < start || d >= end) return false;
    if (country && h.countries && !h.countries.includes(country)) return false;
    return true;
  });
}

export function parseBriefChannels(raw: any): string[] {
  if (!raw) return [];
  let arr: any = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
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
  }
  return [...new Set(canonical)];
}

interface BuildArgs {
  client: any;
  brief: any;
  assets: any[];
  month: string;
  pieceCount: number;
  knowledgeContext?: { text: string; score: number }[];
  /** Posts from prior months for this client. Injected so the AI doesn't
   *  re-pitch the same angles every month — the #1 user complaint about
   *  multi-month generation feeling repetitive. */
  priorPosts?: Array<{ title: string; pillar: string; keyMessage: string; month: string }>;
}

// Picks Arabic vs English based on client.locale. Dialect defaults to
// MSA if not set. Country derived from timezone for holiday filtering.
export function buildPlanningPrompt(p: BuildArgs): string {
  const locale = (p.client?.locale || 'en').toLowerCase();
  if (locale.startsWith('ar')) {
    return buildArabicPrompt(p);
  }
  return buildEnglishPrompt(p);
}

function clientCountry(client: any): string | undefined {
  // Timezone heuristic: 'Asia/Dubai' → AE, 'Asia/Riyadh' → SA, etc.
  const tz = (client?.timezone || '').toLowerCase();
  if (tz.includes('dubai')) return 'AE';
  if (tz.includes('riyadh')) return 'SA';
  if (tz.includes('doha') || tz.includes('qatar')) return 'QA';
  if (tz.includes('kuwait')) return 'KW';
  if (tz.includes('bahrain')) return 'BH';
  if (tz.includes('muscat')) return 'OM';
  return undefined;
}

// Per-campaign brief block (A1 fix). Returns prompt lines describing EACH
// campaign distinctly, or [] when there are 0–1 structured campaigns (caller
// then uses the legacy scalar objective/audience). Fixes the bug where every
// post inherited campaign #1's audience/objective/key-message.
function formatCampaigns(brief: any, pieceCount: number): string[] {
  let camps: any[] = [];
  try { const v = brief?.campaigns; camps = typeof v === 'string' ? JSON.parse(v) : (v || []); } catch { camps = []; }
  camps = (Array.isArray(camps) ? camps : []).filter((c) => c && (c.name || c.objective || c.keyMessage || c.targetAudience));
  if (camps.length <= 1) return [];
  const lines: string[] = [];
  lines.push(`\n=== CAMPAIGNS (${camps.length}). Distribute the ${pieceCount} posts across ALL of these ===`);
  lines.push("Each post belongs to exactly ONE campaign. Set post.pillar to that campaign's name and use THAT campaign's audience, objective, and key message. Do NOT blend campaigns or reuse the first campaign for every post. Spread the posts roughly evenly across the campaigns.");
  camps.forEach((c, i) => {
    const parts = [`Campaign: ${c.name || `#${i + 1}`}`];
    if (c.targetAudience) parts.push(`Audience: ${c.targetAudience}`);
    if (c.objective) parts.push(`Objective: ${c.objective}`);
    if (c.keyMessage) parts.push(`Key message: ${c.keyMessage}`);
    if (c.productFocus) parts.push(`Product: ${c.productFocus}`);
    lines.push(`${i + 1}. ${parts.join(' | ')}`);
  });
  return lines;
}

// Brief list entries may be plain strings OR objects — campaignMoments and
// occasions are saved as [{name, date}] by BriefInput, and a bare join()
// stringified them to "[object Object]", so Special Occasions never actually
// reached the model. Renders objects as "Name (date)". (fixed 2026-08-02)
function fmtBriefEntry(x: any): string {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'object') {
    const name = String(x.name ?? x.title ?? x.label ?? '').trim();
    const date = String(x.date ?? x.when ?? '').trim();
    if (name && date) return `${name} (${date})`;
    return name || date || '';
  }
  return String(x);
}

function buildEnglishPrompt(p: BuildArgs): string {
  const s: string[] = [];
  s.push(`You are an expert social media content strategist for ${p.client.name}, a ${p.client.industry || 'general'} company.`);
  s.push('\n=== CLIENT ===');
  s.push(`Name: ${p.client.name}`);
  if (p.client.industry) s.push(`Industry: ${p.client.industry}`);
  if (p.client.website) s.push(`Website: ${p.client.website}`);

  const channels = parseBriefChannels(p.brief?.channels);

  if (p.brief) {
    s.push('\n=== BRIEF ===');
    if (p.brief.tone) s.push(`Tone: ${p.brief.tone}`);
    if (p.brief.brandDo) s.push(`Brand Do: ${p.brief.brandDo}`);
    if (p.brief.brandDont) s.push(`Brand Don't: ${p.brief.brandDont}`);
    if (p.brief.complianceNotes) s.push(`Compliance: ${p.brief.complianceNotes}`);
    if (p.brief.visualLookFeel) s.push(`Visual look & feel: ${p.brief.visualLookFeel}`);
    const fmtArr = (l: string, v: any) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(a)) { const parts = a.map(fmtBriefEntry).filter(Boolean); if (parts.length) s.push(`${l}: ${parts.join(', ')}`); } } catch {} };
    fmtArr('Products', p.brief.products);
    fmtArr('Campaign Moments', p.brief.campaignMoments);
    // Per-campaign block (distinct audience/objective/message per campaign).
    // Falls back to the single objective/audience + pillars only for legacy
    // briefs with 0–1 campaigns.
    const campaignLines = formatCampaigns(p.brief, p.pieceCount);
    if (campaignLines.length) {
      campaignLines.forEach((l) => s.push(l));
    } else {
      if (p.brief.objective) s.push(`Objective: ${p.brief.objective}`);
      if (p.brief.audience) s.push(`Audience: ${p.brief.audience}`);
      fmtArr('Pillars', p.brief.pillars);
    }
  }

  // Inject holidays even on English prompts — helps US/EU brands targeting GCC.
  const holidays = getUpcomingHolidays(p.month, clientCountry(p.client));
  if (holidays.length > 0) {
    s.push('\n=== UPCOMING HOLIDAYS / OCCASIONS ===');
    for (const h of holidays) {
      s.push(`- ${h.date}: ${h.name}${h.toneGuidance ? `${h.toneGuidance}` : ''}`);
    }
  }

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
    s.push('No channels specified in brief. Default to Instagram only.');
    s.push('- ' + PLATFORM_LIMITS.Instagram);
  }

  if (p.knowledgeContext && p.knowledgeContext.length > 0) {
    s.push('\n=== BRAND KNOWLEDGE ===');
    s.push('The following knowledge was uploaded by the client. Use it to inform your content strategy:');
    p.knowledgeContext.forEach((chunk, i) => {
      s.push(`${i + 1}. ${chunk.text}`);
    });
  }

  // Prior-month diversity guard — the AI can repeat the same brief endlessly
  // unless it sees what was already published. Cap at 30 entries to keep the
  // prompt budget under control on long-running clients.
  if (p.priorPosts && p.priorPosts.length > 0) {
    s.push('\n=== ALREADY PUBLISHED (DO NOT REPEAT THESE ANGLES) ===');
    s.push(`The following ${Math.min(p.priorPosts.length, 30)} posts were already drafted for this client in prior months. Your output must cover DIFFERENT angles, hooks, and key messages. Same brand voice, fresh ideas.`);
    for (const pr of p.priorPosts.slice(0, 30)) {
      s.push(`- [${pr.month}] ${pr.title}${pr.pillar ? ` · pillar=${pr.pillar}` : ''}${pr.keyMessage ? `${pr.keyMessage.slice(0, 80)}` : ''}`);
    }
  }

  s.push(`\n=== TASK ===\nGenerate exactly ${p.pieceCount} content pieces for ${p.month} as JSON.`);
  s.push('Return: {"strategySummary":{"overview":"...","themes":[...],"channelFocus":{...}},"posts":[{"date":"...","title":"...","pillar":"...","platform":"...","format":"...","hook":"...","keyMessage":"...","caption":"...","cta":"...","hashtags":[...],"visualDirection":"...","referenceSearchQuery":"...","ideaRationale":"...","timing":"..."}]}');
  s.push('referenceSearchQuery: 3-6 English keywords describing the VISUAL aesthetic to find inspiration for (style, medium, mood, industry), not the caption. For Reel/Video/Story format posts, include motion words (e.g. "kinetic typography animation", "product reveal motion graphics", "cinemagraph transition"). Keep it English even on Arabic content so image search returns results.');
  const allowedList = channels.length > 0 ? channels.join('|') : 'Instagram';
  s.push(`\nRULES:
1. Every post.platform MUST be one of: ${allowedList}. No other platforms allowed.
2. Captions must stay within the character limits for the allowed platforms listed above.
3. Vary formats (Static/Carousel/Reel/Video) and pillars across posts.
4. Distribute posts evenly across the calendar month.
5. Return ONLY valid JSON. No markdown, no commentary.
6. ${p.priorPosts && p.priorPosts.length > 0 ? 'NEVER reuse a title, hook, or key message from the "ALREADY PUBLISHED" list above. Pick fresh angles.' : 'Bring fresh angles. Do not produce generic stock content.'}
7. ${HUMAN_VOICE_RULE}`);
  return s.join('\n');
}

function buildArabicPrompt(p: BuildArgs): string {
  const dialect = (p.client?.dialect as ArabicDialect) || 'MSA';
  const country = clientCountry(p.client);
  const holidays = getUpcomingHolidays(p.month, country);
  const channels = parseBriefChannels(p.brief?.channels);
  const s: string[] = [];

  s.push(`أنت استراتيجي محتوى عربي محترف لشركة ${p.client.name}. You are a senior Arabic-language social content strategist for ${p.client.name}, a ${p.client.industry || 'general'} company.`);
  s.push('');
  s.push(`DIALECT: ${dialect}. ${DIALECT_GUIDANCE[dialect]}`);

  s.push('\n=== CLIENT ===');
  s.push(`Name: ${p.client.name}`);
  if (p.client.industry) s.push(`Industry: ${p.client.industry}`);
  if (p.client.website) s.push(`Website: ${p.client.website}`);

  if (p.brief) {
    s.push('\n=== BRIEF ===');
    if (p.brief.tone) s.push(`Tone: ${p.brief.tone}`);
    if (p.brief.brandDo) s.push(`Brand Do: ${p.brief.brandDo}`);
    if (p.brief.brandDont) s.push(`Brand Don't: ${p.brief.brandDont}`);
    if (p.brief.complianceNotes) s.push(`Compliance: ${p.brief.complianceNotes}`);
    if (p.brief.visualLookFeel) s.push(`Visual look & feel: ${p.brief.visualLookFeel}`);
    const fmtArr = (l: string, v: any) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(a)) { const parts = a.map(fmtBriefEntry).filter(Boolean); if (parts.length) s.push(`${l}: ${parts.join(', ')}`); } } catch {} };
    fmtArr('Products', p.brief.products);
    fmtArr('Campaign Moments', p.brief.campaignMoments);
    // Per-campaign block (distinct audience/objective/message per campaign).
    // Falls back to the single objective/audience + pillars only for legacy
    // briefs with 0–1 campaigns.
    const campaignLines = formatCampaigns(p.brief, p.pieceCount);
    if (campaignLines.length) {
      campaignLines.forEach((l) => s.push(l));
    } else {
      if (p.brief.objective) s.push(`Objective: ${p.brief.objective}`);
      if (p.brief.audience) s.push(`Audience: ${p.brief.audience}`);
      fmtArr('Pillars', p.brief.pillars);
    }
  }

  if (holidays.length > 0) {
    s.push('\n=== UPCOMING HOLIDAYS / OCCASIONS ===');
    for (const h of holidays) {
      s.push(`- ${h.date}: ${h.name}${h.toneGuidance ? `${h.toneGuidance}` : ''}`);
    }
    s.push('Tone guidance: For Ramadan posts, avoid food/drink imagery before iftar. Emphasize community, family, charity, reflection. For Eid posts, celebratory tone (عيد مبارك). For National Days, patriotic but not jingoistic.');
  }

  s.push('\n=== ALLOWED PLATFORMS (HARD RESTRICTION) ===');
  if (channels.length > 0) {
    s.push(`You may ONLY generate posts for these exact platforms: ${channels.join(', ')}.`);
    s.push('\nPlatform limits (Arabic chars count the same as Latin):');
    for (const ch of channels) {
      if (PLATFORM_LIMITS[ch]) s.push(`- ${PLATFORM_LIMITS[ch]}`);
    }
  } else {
    s.push('No channels specified in brief. Default to Instagram only.');
    s.push('- ' + PLATFORM_LIMITS.Instagram);
  }

  if (p.knowledgeContext && p.knowledgeContext.length > 0) {
    s.push('\n=== BRAND KNOWLEDGE ===');
    p.knowledgeContext.forEach((chunk, i) => {
      s.push(`${i + 1}. ${chunk.text}`);
    });
  }

  // Prior-month diversity guard (Arabic prompt mirror — same logic as English).
  if (p.priorPosts && p.priorPosts.length > 0) {
    s.push('\n=== ALREADY PUBLISHED (DO NOT REPEAT THESE ANGLES) ===');
    s.push(`The following posts were drafted for this client in prior months. Cover DIFFERENT angles, hooks, and key messages. Same brand voice, fresh ideas:`);
    for (const pr of p.priorPosts.slice(0, 30)) {
      s.push(`- [${pr.month}] ${pr.title}${pr.pillar ? ` · ${pr.pillar}` : ''}${pr.keyMessage ? `${pr.keyMessage.slice(0, 80)}` : ''}`);
    }
  }

  s.push(`\n=== TASK ===\nGenerate exactly ${p.pieceCount} content pieces for ${p.month} as JSON.`);
  s.push('CRITICAL. Write all user-facing strings (title, hook, keyMessage, caption, cta, hashtags) in ARABIC using the dialect above.');
  s.push('Keep JSON keys, platform names, and date strings in English/numeric form. referenceSearchQuery stays in English so Pinterest/DDG returns visual references.');
  s.push('Hashtags: prefer Arabic when audience-natural (#رمضان_كريم), mix with English for international reach.');

  s.push('\nReturn: {"strategySummary":{"overview":"ملخص الاستراتيجية","themes":["موضوع١"],"channelFocus":{"Instagram":40}},"posts":[{"date":"...","title":"عنوان","pillar":"الركيزة","platform":"Instagram","format":"Static","hook":"جملة افتتاحية","keyMessage":"الرسالة","caption":"النص الكامل","cta":"دعوة","hashtags":["#وسم"],"visualDirection":"توجيه فني","referenceSearchQuery":"english search keywords","ideaRationale":"المنطق","timing":"توقيت"}]}');
  const allowedList = channels.length > 0 ? channels.join('|') : 'Instagram';
  s.push(`\nRULES:
1. كل post.platform يجب أن يكون من: ${allowedList}.
2. كل caption يجب أن يحترم حدود الأحرف.
3. توزيع التدوينات على مدار الشهر.
4. مزج الصيغ والركائز.
5. أعد JSON صحيحاً فقط. بدون Markdown أو تعليقات.
6. ${p.priorPosts && p.priorPosts.length > 0 ? 'لا تكرر أي عنوان أو افتتاحية أو رسالة أساسية من قائمة "ALREADY PUBLISHED" أعلاه. اختر زوايا جديدة.' : 'اختر زوايا جديدة وتجنب المحتوى العام.'}
7. ممنوع استخدام الشرطة الطويلة نهائياً في أي نص. استخدم نقطة أو فاصلة بدلاً منها. اكتب بأسلوب بشري طبيعي وتجنب العبارات التسويقية الجاهزة.`);
  return s.join('\n');
}
