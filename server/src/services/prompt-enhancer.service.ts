// Model-aware prompt enhancer for the Creative Studio (2026-07-02).
//
// Replaces the generic "make it vivid" rewriter with per-engine templates
// built from triple-verified research (deep-research run wf_5e37c63e):
//  - Veo 3.1's official structure is [Cinematography] + [Subject] + [Action]
//    + [Context] + [Style & Ambiance], cinematography FIRST, with audio
//    directives: dialogue in "quotes", `SFX:` line, `Ambient noise:` line.
//    (cloud.google.com "ultimate prompting guide for Veo 3.1")
//  - Veo only accepts ENGLISH prompts — Arabic/any-language briefs must be
//    translated in this layer, never passed through raw.
//  - Image ads want explicit composition/negative-space-for-copy, lighting,
//    and EXACT quoted text when copy must render in-image.
//
// Runs through aiRouter.text so the fallback chain + enrichers apply. Uses a
// cheap/fast model tier — enhancement must feel instant next to generation.

import { aiRouter } from './providers/ai-router.js';
import { db } from '../db/prisma.js';

export type EnhanceMode = 'text-to-image' | 'image-edit' | 'text-to-video' | 'image-to-video';

export interface EnhanceInput {
  prompt: string;
  mode: EnhanceMode;
  /** Engine hint from the FE picker — shapes vocabulary + constraints. */
  engine?: 'gemini' | 'xai' | 'dashscope';
  clientId?: string;
  orgId?: string;
  userId?: string;
  /** Reels/Stories safe-zone toggle — folded into composition guidance. */
  safeZone?: boolean;
  /** Whether reference images are attached (changes edit phrasing). */
  hasRefs?: boolean;
  /** Curated Style Pack (style-packs.ts) — injected as a hard design contract. */
  stylePack?: { name: string; image: string; video: string; negative?: string };
}

export interface EnhanceResult {
  prompt: string;
  /** Only for video modes — feeds Veo's real negativePrompt param. */
  negativePrompt?: string;
  provider: string;
  model: string;
  latencyMs: number;
}

const VIDEO_SYSTEM = `You are a film director writing production-grade prompts for an AI video model (Google Veo 3.1).
Rewrite the user's idea into ONE continuous shot description using this exact structure, in this order:
[Cinematography] [Subject] [Action] [Context] [Style & Ambiance] [Audio].
Rules:
- START with the camera: shot type, lens/framing, and one clear camera movement (e.g. "Slow dolly push-in, 35mm, shallow depth of field").
- Then the subject and its defining visual details, then exactly what happens during the shot, then the setting, then style/mood/color grade.
- ALWAYS write in English. If the user's idea is in Arabic or any other language, translate the intent faithfully (do NOT transliterate).
- Present tense, concrete visual language. One shot only — no cuts, no "scene 2".
- End the prompt with audio as plain sentences in the SAME single line: "SFX: <sound effects>. Ambient noise: <background soundscape>." Include spoken dialogue in double quotes ONLY if the user asked for speech; for Arabic-market ads keep any dialogue in the user's language.
- 90–140 words total. The whole prompt must be ONE single-line string — no literal line breaks. No markdown, no lists, no camera jargon soup — every term must be purposeful.
- This is a social-media AD: keep the subject hero-lit and the message readable at a glance.
Also produce a comma-separated negativePrompt of shot-specific things to avoid (styles, objects, artifacts — plain nouns/phrases, never "no X").
Return ONLY compact single-line JSON (no literal newlines inside strings): {"prompt": "...", "negativePrompt": "..."}`;

const IMAGE_SYSTEM = `You are a creative director writing prompts for an AI image model producing premium social-media ad creative.
Rewrite the user's idea into ONE production-grade prompt with this flow:
subject & focal point → composition & framing (rule of thirds, negative space where ad copy would sit) → lighting (quality, direction, mood) → color palette & photographic style → technical finish (lens, depth of field, texture).
Rules:
- Write the prompt in English (translate the user's intent if needed), EXCEPT text that must render inside the image: quote that text EXACTLY as the user wrote it, in its original language, in double quotes, and describe its typography and placement.
- Concrete nouns, purposeful adjectives, present tense. 60–110 words, flowing prose, no lists, no markdown.
- This is ad creative: the product/subject must be unmistakably the hero; backgrounds support, never compete.
Return ONLY JSON: {"prompt": "..."}`;

const EDIT_SYSTEM = `You are a retoucher/art director writing edit instructions for an AI image-editing model.
Rewrite the user's request into ONE precise edit instruction: what changes, what stays untouched (subject identity, brand elements), and how the result should look (lighting/color continuity with the original).
Write in English (translate if needed), except text to render in-image — quote that exactly in its original language. 40–90 words, prose only.
Return ONLY JSON: {"prompt": "..."}`;

async function brandContext(clientId?: string, orgId?: string): Promise<string> {
  if (!clientId || !orgId) return '';
  try {
    const client = await db.client.findUnique({
      where: { id: clientId, orgId },
      include: { brief: { select: { tone: true, visualLookFeel: true } } },
    });
    if (!client) return '';
    const bits: string[] = [`Brand: ${client.name}`];
    if (client.industry) bits.push(`industry: ${client.industry}`);
    if (client.primaryColor) bits.push(`primary brand color: ${client.primaryColor} (use it deliberately in the palette)`);
    if (client.brief?.tone) bits.push(`brand tone: ${client.brief.tone}`);
    if (client.brief?.visualLookFeel) bits.push(`visual look & feel: ${client.brief.visualLookFeel.slice(0, 300)}`);
    return `\n\nBrand context (respect it): ${bits.join('; ')}.`;
  } catch {
    return ''; // best-effort — enhancement must never fail on brand lookup
  }
}

export async function enhanceCreativePrompt(input: EnhanceInput): Promise<EnhanceResult> {
  const isVideo = input.mode === 'text-to-video' || input.mode === 'image-to-video';
  const system = isVideo ? VIDEO_SYSTEM : (input.mode === 'image-edit' ? EDIT_SYSTEM : IMAGE_SYSTEM);

  const notes: string[] = [];
  if (input.mode === 'image-to-video') {
    notes.push('The shot animates FROM a provided still image: describe motion, camera work and audio that bring that exact frame to life — do not re-describe or replace the subject.');
  }
  if (input.hasRefs) {
    notes.push('Reference images of the exact product/subject are attached — the output must keep that subject identical; never invent a substitute.');
  }
  if (input.safeZone) {
    notes.push('Composition constraint: keep the top ~15% and bottom ~15% of the frame free of key elements and any rendered text (platform UI bands).');
  }
  if (input.stylePack) {
    // The pack is a precision design contract (exact hexes, materials, light)
    // — the motionsites.ai lesson: specificity is what makes output premium.
    const directive = isVideo ? input.stylePack.video : input.stylePack.image;
    notes.push(`STYLE PACK "${input.stylePack.name}" — the art direction below is a HARD constraint; weave its exact palette, materials, lighting and mood into the prompt (the user's subject stays the hero): ${directive}`);
  }
  const brand = await brandContext(input.clientId, input.orgId);

  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${input.prompt.trim()}"${brand}`;

  const result = await aiRouter.text(
    // Flash tier: enhancement must feel instant next to a 30-180s generation.
    { prompt: userMsg, system, json: true, temperature: 0.7, maxTokens: 800, model: process.env.PROMPT_ENHANCER_MODEL || 'gemini-flash-latest' },
    { orgId: input.orgId, userId: input.userId, clientId: input.clientId },
  );

  const out = result.output as any;
  const enhanced = (typeof out?.prompt === 'string' && out.prompt.trim()) ? out.prompt.trim() : input.prompt;
  const modelNegative = isVideo && typeof out?.negativePrompt === 'string' && out.negativePrompt.trim()
    ? out.negativePrompt.trim()
    : undefined;
  const negative = isVideo
    ? [modelNegative, input.stylePack?.negative].filter(Boolean).join(', ').slice(0, 400) || undefined
    : undefined;

  return {
    prompt: enhanced,
    negativePrompt: negative,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
