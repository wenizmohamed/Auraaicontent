// Arabic-first variant of the calendar planning prompt. Selected when
// client.locale === 'ar'. Dialect is one of MSA / KHALEEJI / EGYPTIAN /
// LEVANTINE — the prompt instructs the model to draft captions, hooks,
// hashtags, and CTAs in the chosen dialect while keeping the JSON keys
// in English (so the persistence layer doesn't change shape).

export type ArabicDialect = 'MSA' | 'KHALEEJI' | 'EGYPTIAN' | 'LEVANTINE';

const DIALECT_GUIDANCE: Record<ArabicDialect, string> = {
  MSA:       'الفصحى الحديثة (MSA). Use neutral pan-Arab tone, no regional slang. Suitable for formal brands and pan-Gulf audiences.',
  KHALEEJI:  'لهجة خليجية. Use Gulf vocabulary (شلونك، إن شاء الله، بإذن الله). Suitable for UAE/KSA/Qatar/Bahrain/Kuwait/Oman audiences. Reference local references (souks, majlis, abaya/kandura) where natural.',
  EGYPTIAN:  'لهجة مصرية. Use Cairene vocabulary (إزيك، يعني، أصلًا). Suitable for Egyptian and broader Arabic-pop audiences.',
  LEVANTINE: 'لهجة شامية. Use Beirut/Damascus/Amman vocabulary. Suitable for Lebanon/Syria/Jordan/Palestine audiences.',
};

export function buildPlanningPromptArabic(params: {
  client: { name: string; industry?: string; website?: string; instagramHandle?: string };
  brief: any;
  assets: any[];
  retrieved: any[];
  month: string;
  pieceCount: number;
  dialect: ArabicDialect;
  upcomingHolidays?: { name: string; date: string }[];
}): string {
  const { client, brief, assets, retrieved, month, pieceCount, dialect, upcomingHolidays } = params;
  const sections: string[] = [];

  sections.push(`أنت استراتيجي محتوى عربي محترف لشركة ${client.name}. You are a senior Arabic-language social content strategist for ${client.name}, a ${client.industry || 'general'} company.`);
  sections.push('');
  sections.push(`DIALECT: ${dialect} — ${DIALECT_GUIDANCE[dialect]}`);
  sections.push('');

  sections.push('=== CLIENT ===');
  sections.push(`Name: ${client.name}`);
  if (client.industry) sections.push(`Industry: ${client.industry}`);
  if (client.website) sections.push(`Website: ${client.website}`);
  if (client.instagramHandle) sections.push(`Instagram: ${client.instagramHandle}`);

  if (brief) {
    sections.push('');
    sections.push('=== BRIEF ===');
    if (brief.objective) sections.push(`Objective: ${brief.objective}`);
    if (brief.audience) sections.push(`Audience: ${brief.audience}`);
    if (brief.tone) sections.push(`Tone: ${brief.tone}`);
    if (brief.brandDo) sections.push(`Brand Do: ${brief.brandDo}`);
    if (brief.brandDont) sections.push(`Brand Don't: ${brief.brandDont}`);
    if (brief.complianceNotes) sections.push(`Compliance: ${brief.complianceNotes}`);
    if (brief.cadence) sections.push(`Cadence: ${brief.cadence}`);

    const fmtArr = (label: string, val: any) => {
      if (!val) return;
      const arr = typeof val === 'string' ? JSON.parse(val) : val;
      if (Array.isArray(arr) && arr.length > 0) {
        sections.push(`${label}: ${arr.map((v: any) => typeof v === 'string' ? v : JSON.stringify(v)).join(', ')}`);
      }
    };
    fmtArr('Products', brief.products);
    fmtArr('Pillars', brief.pillars);
    fmtArr('Campaign Moments', brief.campaignMoments);
    fmtArr('Channels', brief.channels);
  }

  if (upcomingHolidays && upcomingHolidays.length > 0) {
    sections.push('');
    sections.push('=== UPCOMING HOLIDAYS / OCCASIONS (factor into the calendar) ===');
    for (const h of upcomingHolidays) {
      sections.push(`- ${h.date}: ${h.name}`);
    }
    sections.push('Tone guidance: For Ramadan posts, avoid food imagery before iftar. Emphasize community, family, charity, reflection. For Eid posts, celebratory tone. For National Days, patriotic but not jingoistic.');
  }

  if (retrieved.length > 0) {
    sections.push('');
    sections.push('=== KNOWLEDGE CONTEXT ===');
    for (const chunk of retrieved.slice(0, 10)) {
      sections.push(`- ${typeof chunk === 'string' ? chunk : chunk.text || JSON.stringify(chunk)}`);
    }
  }

  if (assets.length > 0) {
    sections.push('');
    sections.push('=== AVAILABLE ASSETS ===');
    for (const asset of assets.slice(0, 10)) {
      const analysis = asset.analysis ? (typeof asset.analysis === 'string' ? asset.analysis : JSON.stringify(asset.analysis)) : '';
      sections.push(`- ${asset.name} (${asset.mimeType}) ${analysis}`);
    }
  }

  sections.push('');
  sections.push('=== PLATFORM LIMITS (Arabic chars count the same as Latin chars) ===');
  sections.push('Instagram: max 2200 chars, optimal 180, max 5 hashtags');
  sections.push('TikTok: max 4000 chars, optimal 100, max 5 hashtags');
  sections.push('LinkedIn: max 3000 chars, optimal 1900, max 5 hashtags');
  sections.push('X: max 280 chars, optimal 85, max 2 hashtags');
  sections.push('Facebook: max 63206 chars, optimal 60, max 3 hashtags');

  sections.push('');
  sections.push('=== TASK ===');
  sections.push(`Generate exactly ${pieceCount} content pieces for ${month} as a JSON object.`);
  sections.push('');
  sections.push('CRITICAL — write all user-facing strings (title, hook, keyMessage, caption, cta, hashtags) in ARABIC using the dialect above.');
  sections.push('Keep JSON keys, platform names, and date strings in English/numeric form.');
  sections.push('Hashtags: prefer Arabic when audience-natural (#رمضان_كريم), mix with English for international reach where the brief allows.');
  sections.push('');
  sections.push('Return this exact JSON shape:');
  sections.push(`{
  "strategySummary": {
    "overview": "ملخص الاستراتيجية الشهرية في 2-3 جمل",
    "themes": ["موضوع١", "موضوع٢"],
    "channelFocus": {"Instagram": 40, "TikTok": 25, "LinkedIn": 20, "X": 15}
  },
  "posts": [
    {
      "date": "${month} DD",
      "title": "عنوان قصير",
      "pillar": "الركيزة المحتوائية",
      "platform": "Instagram",
      "format": "Static | Reel | Carousel | Story | Video | Article",
      "hook": "جملة افتتاحية تجذب الانتباه",
      "keyMessage": "الرسالة الرئيسية على البصري",
      "caption": "النص الكامل الجاهز للنشر بحدود المنصة",
      "cta": "دعوة لاتخاذ إجراء",
      "hashtags": ["#وسم", "#tag"],
      "visualDirection": "توجيه فني للمصمم — وصف التكوين والألوان والمزاج",
      "referenceSearchQuery": "Pinterest English search keywords for visual reference",
      "ideaRationale": "لماذا تنجح هذه التدوينة استراتيجياً",
      "timing": "أفضل وقت للنشر"
    }
  ]
}`);
  sections.push('');
  sections.push('RULES:');
  sections.push('1. كل caption يجب أن يحترم حدود المنصة من الأحرف');
  sections.push('2. كل post يجب أن يحترم حدود الوسوم');
  sections.push('3. توزيع التدوينات على مدار الشهر');
  sections.push('4. مزج المنصات والصيغ');
  sections.push('5. keyMessage هو النص الذي يظهر على البصري — مختصر');
  sections.push('6. الالتزام بإرشادات العلامة التجارية');
  sections.push('7. أعد JSON صحيحاً فقط');

  return sections.join('\n');
}
