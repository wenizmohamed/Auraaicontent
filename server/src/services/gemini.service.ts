import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

// ─── Client singleton ────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
    _client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _client;
}

// ─── Model map ───────────────────────────────────────────────────

export const MODELS = {
  planner: env.GEMINI_PLANNER_MODEL,         // gemini-3-flash-preview
  strategist: env.GEMINI_STRATEGIST_MODEL,    // gemini-3.1-pro-preview
  image: env.GEMINI_IMAGE_MODEL,              // gemini-3.1-flash-image-preview
  video: env.GEMINI_VIDEO_MODEL,              // veo-3.1-generate-preview
  videoFast: env.GEMINI_VIDEO_FAST_MODEL,     // veo-3.1-fast-generate-preview
  embedding: env.GEMINI_EMBEDDING_MODEL,      // gemini-embedding-2-preview
} as const;

// ─── generateText ────────────────────────────────────────────────

export async function generateText(
  prompt: string,
  model: string = MODELS.planner,
): Promise<string> {
  const client = getClient();
  const response = await client.models.generateContent({ model, contents: prompt });
  const text = response.text;
  if (!text) throw new Error(`Gemini returned empty response (model: ${model})`);
  return text;
}

// ─── generateJson ────────────────────────────────────────────────

export async function generateJson<T>(
  prompt: string,
  model: string = MODELS.planner,
): Promise<T> {
  const client = getClient();
  const response = await client.models.generateContent({
    model,
    contents: prompt + '\n\nReturn ONLY valid JSON. No markdown, no code fences.',
    config: { responseMimeType: 'application/json' },
  });

  const text = response.text || '';
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fallback: extract JSON from response
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Failed to parse JSON from Gemini (model: ${model}). Raw: ${text.slice(0, 200)}`);
  }
}

// ─── embedText ───────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.models.embedContent({
    model: MODELS.embedding,
    contents: text,
  });
  const embedding = response.embeddings?.[0]?.values;
  if (!embedding?.length) throw new Error('Gemini returned empty embedding');
  return embedding;
}

// ─── analyzeAsset (multimodal) ───────────────────────────────────

export async function analyzeAsset(
  base64Data: string,
  mimeType: string,
  prompt: string = 'Analyze this asset for a social media content team. Return JSON with: description, mood, tags, colors, qualityScore (1-10), bestFit (platforms), suggestion.',
): Promise<any> {
  const client = getClient();
  const response = await client.models.generateContent({
    model: MODELS.planner,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: prompt },
      ],
    }],
    config: { responseMimeType: 'application/json' },
  });

  const text = response.text || '';
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Failed to parse asset analysis JSON. Raw: ${text.slice(0, 200)}`);
  }
}
