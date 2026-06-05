import { aiApi } from './backend-api';

// All generation routes through the backend aiRouter (Gemini-primary + universal
// fallback + org budget + telemetry + enrichment). The browser no longer calls
// LLM providers directly — the old /gemini & /claude proxy paths 404'd in prod
// (nginx only proxies /api/), which silently broke Topic Desk AI + visual-ref
// keyword search. `provider` is kept for signature compatibility but is advisory;
// the router decides (Gemini first).

export type AIProvider = 'gemini' | 'claude';

export async function generateContent(prompt: string, _provider: AIProvider = 'gemini'): Promise<string> {
  const r = await aiApi.text({ prompt });
  return r.text || '';
}

// ─── JSON helper ─────────────────────────────────────────────────

async function generateJSON(prompt: string, _provider: AIProvider = 'gemini'): Promise<any> {
  const r = await aiApi.text({ prompt, json: true });
  try { return JSON.parse(r.text); } catch { /* fall through to lenient extraction */ }
  const match = r.text.match(/[\[{][\s\S]*[\]}]/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Could not parse JSON from AI response');
}

// ─── Topic-specific functions ────────────────────────────────────

export async function expandTopicBrief(
  topic: { title: string; station: string; targetAudience?: string; description?: string },
  provider: AIProvider = 'gemini'
): Promise<{
  description: string;
  targetAudience: string;
  keyMessages: string;
  hashtags: string[];
  tone: string;
}> {
  const prompt = `You are a content strategist for a media company. Expand this topic brief:

TOPIC: ${topic.title}
STATION: ${topic.station}
${topic.targetAudience ? `CURRENT AUDIENCE: ${topic.targetAudience}` : ''}
${topic.description ? `CURRENT DESCRIPTION: ${topic.description}` : ''}

Generate a JSON object with:
{
  "description": "2-3 sentence compelling description of the content topic",
  "targetAudience": "specific target audience description",
  "keyMessages": "3-4 key messages separated by newlines",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
  "tone": "one of: Authoritative, Empathetic, Urgent, Investigative, Inspirational, Conversational, Formal, Bold"
}`;

  return await generateJSON(prompt, provider);
}

export async function suggestTopics(
  station: string,
  context?: string,
  provider: AIProvider = 'gemini'
): Promise<{ title: string; description: string; audience: string }[]> {
  const prompt = `You are a content strategist for a media company. Suggest 5 fresh content topics for the ${station} station.
${context ? `Context: ${context}` : ''}

The station focuses on: ${
  station === 'Lebanon' ? 'Lebanese news, culture, politics, economy' :
  station === 'Abu Dhabi' ? 'UAE business, luxury, development, innovation' :
  station === 'Investigations' ? 'Investigative journalism, exposés, deep dives' :
  'Short-form clips, viral content, social media trends'
}

Return a JSON array:
[{"title": "...", "description": "one sentence", "audience": "target audience"}]`;

  return await generateJSON(prompt, provider);
}

export async function generateTopicOutline(
  title: string,
  description: string,
  station: string,
  provider: AIProvider = 'gemini'
): Promise<string> {
  const prompt = `Create a detailed content outline for this topic:

TOPIC: ${title}
DESCRIPTION: ${description}
STATION: ${station}

Write a structured outline with:
1. Hook / Opening angle
2. Key points to cover (3-5 bullet points)
3. Supporting data or research needed
4. Visual/creative direction
5. Call to action

Keep it concise and actionable. Return plain text, not JSON.`;

  return await generateContent(prompt, provider);
}

// ─── Visual Reference Search ─────────────────────────────────────

export interface VisualReference {
  id: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  pinterestUrl?: string;
  description: string;
  tags: string[];
}

export async function searchVisualReferences(
  visualIdea: string,
  provider: AIProvider = 'gemini'
): Promise<VisualReference[]> {
  // Step 1: AI generates diverse search keyword sets from the visual description
  const keywordsPrompt = `You are a creative director helping a graphic designer find reference images.

VISUAL IDEA: "${visualIdea}"

Generate 6 different search keyword sets that would find good reference images on stock photo sites.
Each set should capture a DIFFERENT aspect or angle of the visual idea.
Keep keywords short (2-4 words per set), optimized for image search.

Return JSON array of objects:
[
  {"keywords": "dubai app smile", "description": "Person using mobile app in Dubai", "tags": ["lifestyle", "mobile", "dubai"]},
  {"keywords": "family receiving money", "description": "Happy family receiving remittance", "tags": ["family", "joy", "finance"]},
  ...
]`;

  let keywordSets: { keywords: string; description: string; tags: string[] }[];
  try {
    keywordSets = await generateJSON(keywordsPrompt, provider);
  } catch {
    // Fallback: extract keywords manually
    const words = visualIdea.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    keywordSets = [
      { keywords: words.slice(0, 3).join(' '), description: visualIdea.slice(0, 80), tags: words.slice(0, 3) },
      { keywords: words.slice(1, 4).join(' '), description: visualIdea.slice(0, 80), tags: words.slice(1, 4) },
      { keywords: words.slice(2, 5).join(' '), description: visualIdea.slice(0, 80), tags: words.slice(2, 5) },
    ];
  }

  // Step 2: Fetch REAL photos from Wikimedia Commons API (free, no auth, real photos)
  // Each thumbnail links to Pinterest for the designer to browse more inspiration
  const refs: VisualReference[] = [];

  const imagePromises = keywordSets.slice(0, 6).map(async (set) => {
    const q = encodeURIComponent(set.keywords);
    const pinterestUrl = `https://www.pinterest.com/search/pins/?q=${q}`;

    try {
      const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&prop=imageinfo&iiprop=url%7Cextmetadata%7Ccanonicaltitle&iiurlwidth=600&format=json&origin=*`;
      console.log('[VisRef] Fetching:', set.keywords);
      const res = await fetch(apiUrl);
      const data = await res.json();
      const pages = Object.values(data?.query?.pages || {}) as any[];
      console.log('[VisRef] Got', pages.length, 'results for:', set.keywords);

      // Pick the best photo (skip SVGs, icons, logos — want real photos)
      const photo = pages.find((p: any) => {
        const url = p.imageinfo?.[0]?.url || '';
        return /\.(jpg|jpeg|png|webp)$/i.test(url) && !url.includes('Icon') && !url.includes('Logo');
      }) || pages[0];

      if (photo?.imageinfo?.[0]?.thumburl) {
        const wikiUrl = photo.imageinfo[0].descriptionurl || photo.imageinfo[0].url || pinterestUrl;
        console.log('[VisRef] Using image:', photo.imageinfo[0].thumburl.slice(0, 80));
        return {
          id: crypto.randomUUID(),
          imageUrl: photo.imageinfo[0].thumburl,
          sourceUrl: wikiUrl,
          sourceName: 'Wikimedia',
          pinterestUrl,
          description: photo.imageinfo[0].extmetadata?.ImageDescription?.value?.replace(/<[^>]*>/g, '').slice(0, 100) || set.description,
          tags: set.tags || [],
        };
      }
      console.warn('[VisRef] No thumburl found for:', set.keywords);
    } catch (err) {
      console.error('[VisRef] API failed for:', set.keywords, err);
    }

    // Fallback: labeled placeholder with Pinterest link
    return {
      id: crypto.randomUUID(),
      imageUrl: `https://placehold.co/600x400/1a1a2e/a78bfa?text=${encodeURIComponent(set.keywords.slice(0, 25))}`,
      sourceUrl: pinterestUrl,
      sourceName: 'Pinterest',
      description: set.description,
      tags: set.tags || [],
    };
  });

  const results = await Promise.allSettled(imagePromises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) refs.push(r.value);
  }

  return refs;
}
