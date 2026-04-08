import { GoogleGenAI } from '@google/genai';

const isDeployed = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !isDeployed) {
    console.warn("GEMINI_API_KEY is not set in the environment.");
  }
  // When deployed, still pass the key — the SDK needs it even though
  // actual calls may go through proxy for some endpoints.
  // The SDK handles its own CORS for generateContent.
  return new GoogleGenAI({
    apiKey: apiKey || 'proxy-mode',
    ...(isDeployed ? { httpOptions: { baseUrl: window.location.origin + '/gemini' } } : {}),
  });
}

// Helper for deployed mode: direct REST call through proxy
export async function geminiProxyCall(path: string, body: any): Promise<any> {
  const base = isDeployed ? '/gemini' : 'https://generativelanguage.googleapis.com';
  const keyParam = isDeployed ? '' : `?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(`${base}${path}${keyParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function generateDesignBrief(
  topic: string,
  context: string,
  station: string,
  stationStyle: { colors: string[]; mood: string }
): Promise<any> {
  const ai = getGemini();
  const prompt = `You are a creative director at a media company. Generate a complete design brief as JSON for the following:

TOPIC: ${topic}
STATION: ${station}
STATION STYLE: ${stationStyle.mood}
STATION COLORS: ${stationStyle.colors.join(', ')}
${context ? `ADDITIONAL CONTEXT: ${context}` : ''}

Return ONLY valid JSON with this structure:
{
  "visualDirection": "2-3 sentence description of the visual approach",
  "colorPalette": [{"name": "Primary", "hex": "#hexcode"}, ...] (3-5 colors),
  "typography": {"heading": "font name", "body": "font name", "accent": "font name"},
  "layoutDescription": "description of layout approach",
  "copy": {"headline": "...", "subheadline": "...", "body": "...", "cta": "..."},
  "imagePrompts": ["detailed image generation prompt 1", "prompt 2"],
  "dimensions": [{"platform": "Instagram Post", "size": "1080x1080"}, ...]
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });
  const text = response.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('Failed to parse design brief');
}
