// Prompt template for generating a full month calendar from client brief
// Called by server worker only — never from frontend
export function buildPlanningPrompt(params) {
    const { client, brief, assets, retrieved, month, pieceCount } = params;
    const sections = [];
    sections.push(`You are an expert social media content strategist for ${client.name}, a ${client.industry || 'general'} company.`);
    sections.push('');
    // Client context
    sections.push('=== CLIENT ===');
    sections.push(`Name: ${client.name}`);
    if (client.industry)
        sections.push(`Industry: ${client.industry}`);
    if (client.website)
        sections.push(`Website: ${client.website}`);
    if (client.instagramHandle)
        sections.push(`Instagram: ${client.instagramHandle}`);
    // Brief context
    if (brief) {
        sections.push('');
        sections.push('=== BRIEF ===');
        if (brief.objective)
            sections.push(`Objective: ${brief.objective}`);
        if (brief.audience)
            sections.push(`Audience: ${brief.audience}`);
        if (brief.tone)
            sections.push(`Tone: ${brief.tone}`);
        if (brief.brandDo)
            sections.push(`Brand Do: ${brief.brandDo}`);
        if (brief.brandDont)
            sections.push(`Brand Don't: ${brief.brandDont}`);
        if (brief.complianceNotes)
            sections.push(`Compliance: ${brief.complianceNotes}`);
        if (brief.cadence)
            sections.push(`Cadence: ${brief.cadence}`);
        const fmtArr = (label, val) => {
            if (!val)
                return;
            const arr = typeof val === 'string' ? JSON.parse(val) : val;
            if (Array.isArray(arr) && arr.length > 0) {
                sections.push(`${label}: ${arr.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(', ')}`);
            }
        };
        fmtArr('Products', brief.products);
        fmtArr('Pillars', brief.pillars);
        fmtArr('Campaign Moments', brief.campaignMoments);
        fmtArr('Channels', brief.channels);
    }
    // Retrieved knowledge (RAG context — placeholder for now)
    if (retrieved.length > 0) {
        sections.push('');
        sections.push('=== KNOWLEDGE CONTEXT ===');
        for (const chunk of retrieved.slice(0, 10)) {
            sections.push(`- ${typeof chunk === 'string' ? chunk : chunk.text || JSON.stringify(chunk)}`);
        }
    }
    // Asset summaries
    if (assets.length > 0) {
        sections.push('');
        sections.push('=== AVAILABLE ASSETS ===');
        for (const asset of assets.slice(0, 10)) {
            const analysis = asset.analysis ? (typeof asset.analysis === 'string' ? asset.analysis : JSON.stringify(asset.analysis)) : '';
            sections.push(`- ${asset.name} (${asset.mimeType}) ${analysis}`);
        }
    }
    // Platform limits
    sections.push('');
    sections.push('=== PLATFORM LIMITS ===');
    sections.push('Instagram: max 2200 chars, optimal 180, max 5 hashtags');
    sections.push('TikTok: max 4000 chars, optimal 100, max 5 hashtags');
    sections.push('LinkedIn: max 3000 chars, optimal 1900, max 5 hashtags');
    sections.push('X: max 280 chars, optimal 85, max 2 hashtags');
    sections.push('Facebook: max 63206 chars, optimal 60, max 3 hashtags');
    // Task
    sections.push('');
    sections.push(`=== TASK ===`);
    sections.push(`Generate exactly ${pieceCount} content pieces for ${month} as a JSON object.`);
    sections.push('');
    sections.push('Return this exact JSON shape:');
    sections.push(`{
  "strategySummary": {
    "overview": "2-3 sentence month strategy overview",
    "themes": ["theme1", "theme2"],
    "channelFocus": {"Instagram": 40, "TikTok": 25, "LinkedIn": 20, "X": 15}
  },
  "posts": [
    {
      "date": "${month} DD",
      "title": "Short post title",
      "pillar": "Which pillar/theme",
      "platform": "Instagram",
      "format": "Static | Reel | Carousel | Story | Video | Article",
      "hook": "Opening hook to grab attention",
      "keyMessage": "Key message that goes ON the visual",
      "caption": "Full platform-ready caption within character limits",
      "cta": "Call to action",
      "hashtags": ["tag1", "tag2"],
      "visualDirection": "Art direction for designer — describe composition, colors, mood",
      "referenceSearchQuery": "Pinterest search keywords for visual reference",
      "ideaRationale": "Why this post works for the strategy",
      "timing": "Optimal posting time suggestion"
    }
  ]
}`);
    sections.push('');
    sections.push('RULES:');
    sections.push('1. Every caption MUST be within platform character limits');
    sections.push('2. Every post MUST have hashtags within platform limits');
    sections.push('3. Distribute posts evenly across the month');
    sections.push('4. Mix platforms and formats');
    sections.push('5. Include keyMessage (copy overlay for visual) + caption (social copy) + cta separately');
    sections.push('6. All content must comply with brand guidelines');
    sections.push('7. Return ONLY valid JSON');
    return sections.join('\n');
}
//# sourceMappingURL=briefToCalendar.js.map