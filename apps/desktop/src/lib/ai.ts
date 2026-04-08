import { GoogleGenAI } from '@google/genai';

// ─── Providers ───────────────────────────────────────────────────

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || '';

// Detect if running on VPS (not localhost) — use server-side proxy to avoid CORS
const isDeployed = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
const CLAUDE_API_BASE = isDeployed ? '/claude' : 'https://api.anthropic.com';
const GEMINI_API_BASE = isDeployed ? '/gemini' : '';

async function generateWithGemini(prompt: string): Promise<string> {
  if (isDeployed) {
    // Use server-side proxy (no CORS issues, keys on server)
    const res = await fetch(`${GEMINI_API_BASE}/v1beta/models/gemini-3-flash-preview:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  const res = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
  return res.text || '';
}

async function generateWithClaude(prompt: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isDeployed) {
    headers['x-api-key'] = CLAUDE_KEY;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const res = await fetch(`${CLAUDE_API_BASE}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.content?.[0]?.text) return data.content[0].text;
  throw new Error(data.error?.message || 'Claude API error');
}

export type AIProvider = 'gemini' | 'claude';

export async function generateContent(prompt: string, provider: AIProvider = 'gemini'): Promise<string> {
  try {
    if (provider === 'claude') return await generateWithClaude(prompt);
    return await generateWithGemini(prompt);
  } catch (err) {
    // Fallback to the other provider
    console.warn(`${provider} failed, trying fallback...`, err);
    try {
      if (provider === 'claude') return await generateWithGemini(prompt);
      return await generateWithClaude(prompt);
    } catch (fallbackErr) {
      throw new Error(`Both AI providers failed. Last error: ${(fallbackErr as Error).message}`);
    }
  }
}

// ─── JSON helper ─────────────────────────────────────────────────

async function generateJSON(prompt: string, provider: AIProvider = 'gemini'): Promise<any> {
  const text = await generateContent(prompt + '\n\nReturn ONLY valid JSON, no markdown formatting or code fences.', provider);
  const match = text.match(/[\[{][\s\S]*[\]}]/);
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

export async function generateAdCopy(
  topicTitle: string,
  adNumber: number,
  station: string,
  provider: AIProvider = 'gemini'
): Promise<string> {
  const prompt = `Write a short ad copy (2-3 sentences) for Ad ${adNumber} about "${topicTitle}" for the ${station} station. Be compelling and platform-ready. Return just the copy text.`;
  return await generateContent(prompt, provider);
}

// ─── Brief-to-Content Generation (THE MEGA FUNCTION) ─────────────

import { buildBriefToContentPrompt } from './prompts';
import type { ClientKB } from './clients';

export interface GeneratedPiece {
  id: string;
  briefId: string;
  platform: string;
  format: string;
  creativeCopy: string;
  keyMessage: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualReference: string;
  visualRefImages: { imageUrl: string; sourceUrl: string; description: string }[];
  targetAudience: string;
  campaignTheme: string;
  suggestedDate: string;
  charCount: number;
  charLimit: number;
  charStatus: 'good' | 'warning' | 'over';
  status: 'generated' | 'approved' | 'edited' | 'rejected';
}

export async function generateContentFromBrief(params: {
  client: ClientKB;
  month: string;
  campaigns: { name: string; targetAudience: string; productFocus: string; objective: string; keyMessage: string }[];
  occasions: { name: string; date: string }[];
  platforms: string[];
  pieceCount: number;
  toneNotes: string;
  briefId: string;
  provider?: AIProvider;
}): Promise<GeneratedPiece[]> {
  const prompt = buildBriefToContentPrompt(params);
  const provider = params.provider || 'claude'; // Claude Opus for quality

  const raw = await generateJSON(prompt, provider);
  if (!Array.isArray(raw)) throw new Error('AI did not return an array');

  // Map raw AI output to GeneratedPiece with validation
  const { validateCaption } = await import(/* @vite-ignore */ './platform-limits');

  return raw.map((piece: any, i: number) => {
    const caption = piece.caption || '';
    const validation = validateCaption(caption, piece.platform || 'Instagram');

    return {
      id: crypto.randomUUID(),
      briefId: params.briefId,
      platform: piece.platform || 'Instagram',
      format: piece.format || 'Static',
      creativeCopy: piece.creativeCopy || '',
      keyMessage: piece.keyMessage || '',
      caption,
      cta: piece.cta || '',
      hashtags: piece.hashtags || [],
      visualReference: piece.visualReference || '',
      visualRefImages: [], // Will be populated by Wikimedia search after generation
      targetAudience: piece.targetAudience || '',
      campaignTheme: piece.campaignTheme || '',
      suggestedDate: piece.suggestedDate || '',
      charCount: validation.length,
      charLimit: validation.max,
      charStatus: validation.status,
      status: 'generated' as const,
    };
  });
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
