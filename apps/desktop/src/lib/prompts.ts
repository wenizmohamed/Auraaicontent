// Centralized AI Prompt Templates for Content Generation
import type { ClientKB } from './clients';
import { PLATFORM_LIMITS } from './platform-limits';

// Build platform limits string for AI context
export function getPlatformLimitsContext(platforms: string[]): string {
  return platforms.map(p => {
    const key = p.toLowerCase().replace(/[\s()\/]/g, '');
    const limits = PLATFORM_LIMITS[key];
    if (!limits) return `${p}: max 2200 chars, 5 hashtags`;
    return limits.formats.map(f =>
      `${p} ${f.name}: max ${f.caption.max} chars (optimal: ${f.caption.optimal}), first ${f.caption.truncateAt} visible, max ${f.hashtags.max} hashtags (optimal: ${f.hashtags.optimal})`
    ).join('\n');
  }).join('\n');
}

// The mega-prompt that generates ALL content pieces from a brief
export function buildBriefToContentPrompt(params: {
  client: ClientKB;
  month: string;
  campaigns: { name: string; targetAudience: string; productFocus: string; objective: string; keyMessage: string }[];
  occasions: { name: string; date: string }[];
  platforms: string[];
  pieceCount: number;
  toneNotes: string;
}): string {
  const { client, month, campaigns, occasions, platforms, pieceCount, toneNotes } = params;

  return `You are an expert social media content strategist for ${client.name}, a ${client.industry} company in the UAE.

CLIENT KNOWLEDGE BASE:
- Company: ${client.name}
- Industry: ${client.industry}
- Brand Tone: ${client.tone}
- Key Messages: ${client.keyMessages.join(' | ')}
- Products/Services: ${client.products.map(p => `${p.name}: ${p.description}`).join('\n')}
- Compliance: ${client.complianceNotes}
- Social Handles: ${Object.entries(client.socialHandles).map(([k,v]) => `${k}: ${v}`).join(', ')}
${toneNotes ? `- Additional Tone Notes: ${toneNotes}` : ''}

MONTH: ${month}

CAMPAIGNS FOR THIS MONTH:
${campaigns.map((c, i) => `${i+1}. "${c.name}"Audience: ${c.targetAudience} | Product: ${c.productFocus} | Objective: ${c.objective} | Key Message: ${c.keyMessage}`).join('\n')}

SPECIAL OCCASIONS:
${occasions.map(o => `- ${o.name} (${o.date})`).join('\n')}

PLATFORMS: ${platforms.join(', ')}

PLATFORM CHARACTER LIMITS (MUST FOLLOW):
${getPlatformLimitsContext(platforms)}

TASK: Generate exactly ${pieceCount} content pieces as a JSON array. Distribute pieces across campaigns and occasions. Each piece MUST be a JSON object with these exact keys:

{
  "platform": "Instagram" (one of: ${platforms.join(', ')}),
  "format": "Static" (one of: Static, Reel, Carousel, Story, Video, Article),
  "creativeCopy": "The art direction for the designer. Describe the visual composition, colors, mood, layout, elements (2-3 sentences)",
  "keyMessage": "The key message / copy overlay that goes ON the visual itself (e.g. 'Send money to Syria. USD or Syrian Pound. You choose.')",
  "caption": "The social media caption that goes BELOW the post. Platform-optimized, within character limits.",
  "cta": "The call to action (e.g. 'Download AlfaPay today', 'Visit your nearest branch', 'Link in bio')",
  "hashtags": ["hashtag1", "hashtag2"] (array, within platform's hashtag limit),
  "visualReference": "A specific, searchable description for finding reference images (e.g. 'young professional using banking app Dubai skyline golden hour')",
  "targetAudience": "Who this post targets",
  "campaignTheme": "Which campaign this belongs to",
  "suggestedDate": "${month} DD" (realistic date within the month)
}

CRITICAL RULES:
1. EVERY caption MUST be within the platform's max character limit
2. EVERY post MUST have hashtags within the platform's hashtag limit
3. The caption should aim for the OPTIMAL length, not just under max
4. Visual references must be SPECIFIC and SEARCHABLE (not generic)
5. Creative copy is for the DESIGNER. Describe the visual composition, colors, mood, elements
6. Distribute posts evenly across the month
7. Include at least one post for each special occasion
8. Include posts for each campaign
9. Mix formats (Static, Reel, Carousel, Story) across the month
10. All content must be CBUAE compliant. No misleading claims, include disclaimers for offers
11. Hashtags should be in the caption AND in the hashtags array

Return ONLY the JSON array. No markdown, no code fences, no explanation. Use \\n for newlines in strings.`;
}

// Prompt to rewrite a caption for a different platform
export function buildCaptionOptimizerPrompt(
  caption: string,
  fromPlatform: string,
  toPlatform: string
): string {
  const toKey = toPlatform.toLowerCase().replace(/[\s()\/]/g, '');
  const limits = PLATFORM_LIMITS[toKey];
  const maxChars = limits?.formats[0]?.caption.max || 2200;
  const optimalChars = limits?.formats[0]?.caption.optimal || 150;
  const maxHashtags = limits?.formats[0]?.hashtags.max || 5;

  return `Rewrite this ${fromPlatform} caption for ${toPlatform}.

Original caption: "${caption}"

${toPlatform} limits: max ${maxChars} chars (optimal: ${optimalChars}), max ${maxHashtags} hashtags.

Rules:
- Keep the core message but optimize for ${toPlatform}'s audience and format
- Stay within the character limit
- Adjust hashtag count to platform limit
- Match ${toPlatform}'s typical posting style

Return ONLY the rewritten caption, nothing else.`;
}

// Prompt to expand a single content piece with more detail
export function buildContentExpanderPrompt(
  piece: { platform: string; caption: string; creativeCopy: string; campaignTheme: string },
  clientName: string
): string {
  return `Expand this content piece for ${clientName} with more creative detail.

Platform: ${piece.platform}
Campaign: ${piece.campaignTheme}
Current Creative Copy: ${piece.creativeCopy}
Current Caption: ${piece.caption}

Generate:
1. Three alternative caption versions (A/B/C testing)
2. Detailed art direction for the designer (colors, composition, typography, mood)
3. A storyboard outline if this is a video/reel (3-5 frames)

Return as JSON:
{
  "alternativeCaptions": ["version A", "version B", "version C"],
  "artDirection": "detailed description...",
  "storyboard": ["Frame 1: ...", "Frame 2: ..."] (only for video/reel, empty array for static)
}`;
}
