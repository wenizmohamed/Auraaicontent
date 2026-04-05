import { GoogleGenAI } from '@google/genai';

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not set in the environment.");
  }
  return new GoogleGenAI({ apiKey: apiKey as string });
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
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  const text = response.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('Failed to parse design brief');
}
