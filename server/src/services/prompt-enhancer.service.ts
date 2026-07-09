// Model-aware prompt enhancer for the Creative Studio (2026-07-02).
// SOTA prompting pass 2026-07-09: per-engine dialects, silent draft→critique
// quality gate, and vision→prompt reference grounding.
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
//  - Engines read prompts differently (2026-07-09): nano-banana wants flowing
//    narrative + quoted typography; Qwen-Image wants fully-specified poster
//    layouts (and renders Arabic text well); Grok wants short and punchy;
//    Wan is visual-only (audio lines are wasted words). The dialect block
//    tunes the SAME creative brief to the engine that will actually run it.
//
// Runs through aiRouter.text so the fallback chain + enrichers apply — which
// also means learned Memory preferences (creative thumbs-up/down feedback)
// are auto-injected into every enhancement for this client. Uses a cheap/fast
// model tier — enhancement must feel instant next to generation.

import { aiRouter } from './providers/ai-router.js';
import { db } from '../db/prisma.js';

export type EnhanceMode = 'text-to-image' | 'image-edit' | 'text-to-video' | 'image-to-video';

// Enhancer depth dial (2026-07-09, research technique #4 — Krea/MJ --raw).
// Replaces the blind binary enhance:true/false toggle:
//  - raw     → do NOT rewrite the user's wording; only translate to English if
//              needed and (video) still emit a negativePrompt. For brand-exact
//              claims/copy where the writer means EXACTLY what they typed.
//  - low     → light polish: fix clarity, add minimal missing camera/lighting.
//  - medium  → default: full model-aware rewrite (legacy enhance:true behavior).
//  - high    → medium + push specificity of composition/lighting/palette harder.
export type EnhanceDepth = 'raw' | 'low' | 'medium' | 'high';

export interface EnhanceInput {
  prompt: string;
  mode: EnhanceMode;
  /** Engine hint from the FE picker — shapes vocabulary + constraints. */
  engine?: 'gemini' | 'xai' | 'dashscope';
  /** Exact model id when the user picked one — sharper dialect than engine. */
  model?: string;
  /** How aggressively to rewrite. Defaults to 'medium' (legacy behavior). */
  depth?: EnhanceDepth;
  clientId?: string;
  orgId?: string;
  userId?: string;
  /** Reels/Stories safe-zone toggle — folded into composition guidance. */
  safeZone?: boolean;
  /** Whether reference images are attached (changes edit phrasing). */
  hasRefs?: boolean;
  /** Primary attached image (edit source / i2v start frame) — vision→prompt:
   *  described by the analysis model so the prompt grounds in what is ACTUALLY
   *  in the image instead of the user's (often thin) description of it. */
  refImageBase64?: string;
  refImageMime?: string;
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
- Present tense, concrete visual language. Default to ONE shot with ONE dominant camera move — no cuts. EXCEPTION: if the user explicitly asks for multiple beats/shots, sequence them inline with timestamps ("[00:00] wide establishing … [00:03] medium push-in … [00:06] close hero") — Veo 3.1 parses timestamped beats; keep it to 3 beats max and one clear move per beat.
- End the prompt with audio as plain sentences in the SAME single line: "SFX: <sound effects>. Ambient noise: <background soundscape>." Include spoken dialogue in double quotes ONLY if the user asked for speech; for Arabic-market ads keep any dialogue in the user's language.
- 90–140 words total. The whole prompt must be ONE single-line string — no literal line breaks. No markdown, no lists, no camera jargon soup — every term must be purposeful.
- This is a social-media AD: keep the subject hero-lit and the message readable at a glance.
Also produce a comma-separated negativePrompt of shot-specific things to avoid (styles, objects, artifacts — plain nouns/phrases, never "no X").
Return ONLY compact single-line JSON (no literal newlines inside strings): {"prompt": "...", "negativePrompt": "..."}`;

// Raw mode (depth='raw'): translate-only, never reinterpret. Keeps brand-exact
// wording intact while still giving Veo an English prompt + a negativePrompt.
const RAW_VIDEO_SYSTEM = `You are a faithful translator for an AI video model (Google Veo 3.1). Do NOT rewrite, embellish, or reinterpret the user's idea — preserve their exact intent and wording. ONLY translate to English if it is in another language (translate faithfully, never transliterate), and format as ONE single-line string. Also produce a short comma-separated negativePrompt of obvious artifacts to avoid (plain nouns, never "no X"). Return ONLY compact single-line JSON: {"prompt": "...", "negativePrompt": "..."}`;
const RAW_IMAGE_SYSTEM = `You are a faithful translator for an AI image model. Do NOT rewrite, embellish, or reinterpret — preserve the user's exact intent and wording, including any text to render in-image (quote it exactly in its original language). ONLY translate the description to English if needed (faithfully, never transliterate). Return ONLY JSON: {"prompt": "..."}`;

// Depth directives appended to the (non-raw) system prompt.
const DEPTH_NOTES: Record<Exclude<EnhanceDepth, 'raw'>, string> = {
  low: '\nDEPTH = LOW: light touch only — fix clarity and add at most the single most important missing detail (camera OR lighting). Stay close to the user\'s original wording and length.',
  medium: '',
  high: '\nDEPTH = HIGH: maximize art-direction specificity — every one of composition, lighting, color palette and finish must be named precisely and vividly, at the upper word bound. Never generic.',
};

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

// ─── Per-engine dialects (2026-07-09) ────────────────────────────
// Same brief, different phrasing per engine. Short blocks by design —
// they steer vocabulary without bloating the system prompt.

const NANO_IMAGE_NOTES = `ENGINE NOTES (Gemini nano-banana): this model reads flowing narrative sentences far better than keyword lists — describe the scene as one coherent paragraph. It renders in-image typography exceptionally well: put any required copy in double quotes with font style, weight and placement. Photorealism responds to explicit camera + lens + lighting language (e.g. 85mm, f/2.8, softbox key).`;

const QWEN_IMAGE_NOTES = `ENGINE NOTES (Qwen-Image): strongest at poster-style layouts and dense, accurate text rendering — including Arabic script (keep Arabic in-image text in Arabic). Spell out any text EXACTLY in double quotes, with font style and position. Fully specify the layout: name every major element and where it sits in the frame. Text-heavy ads, flat design and infographics are this engine's sweet spot.`;

const GROK_IMAGE_NOTES = `ENGINE NOTES (Grok Imagine): favors concise, punchy, subject-first prompts — lead with the hero subject in the first clause and stay near the LOWER word bound. Bold stylization lands well; long meandering prose drifts.`;

const WAN_VIDEO_NOTES = `ENGINE NOTES (Wan text-to-video): VISUAL-ONLY engine — omit the SFX/Ambient/dialogue sentences entirely and spend those words on motion instead. One continuous scene: explicit motion verbs for the subject AND one clear camera move. 60–100 words.`;

const GROK_VIDEO_NOTES = `ENGINE NOTES (Grok Imagine video): favors short, high-energy cinematic beats — 60–90 words, one bold camera move, strong stylization. Keep the SFX and Ambient clauses to a few words each.`;

function engineDialect(mode: EnhanceMode, engine?: string, model?: string): string {
  const m = (model || '').toLowerCase();
  const isVideo = mode === 'text-to-video' || mode === 'image-to-video';
  if (isVideo) {
    if (m.includes('wan') || (!m && engine === 'dashscope')) return WAN_VIDEO_NOTES;
    if (m.includes('grok') || (!m && engine === 'xai')) return GROK_VIDEO_NOTES;
    return ''; // Veo / omni — VIDEO_SYSTEM is already Veo-native
  }
  if (m.includes('qwen') || m.includes('wan') || (!m && engine === 'dashscope')) return QWEN_IMAGE_NOTES;
  if (m.includes('grok') || (!m && engine === 'xai')) return GROK_IMAGE_NOTES;
  return NANO_IMAGE_NOTES; // gemini default (nano-banana)
}

// Silent self-critique before output — one call, zero extra round-trips.
// The named filler words are the measurable AI-tells that make output generic.
const QUALITY_GATE = `
QUALITY GATE — before answering, silently draft the prompt, then verify: (1) the product/subject is unmistakably the hero; (2) every adjective is concrete and purposeful; (3) composition, lighting and palette are EACH explicitly specified; (4) zero generic filler ("stunning", "breathtaking", "masterpiece", "8k", "ultra-realistic", "high quality", "award-winning"); (5) every NOTE and brand constraint is honored. Fix every failure, then output ONLY the final JSON.`;

async function brandContext(clientId?: string, orgId?: string): Promise<string> {
  if (!clientId || !orgId) return '';
  try {
    // Client (name/industry/primaryColor/brief) + BrandKit palette in parallel.
    const [client, kit] = await Promise.all([
      db.client.findUnique({
        where: { id: clientId, orgId },
        include: { brief: { select: { tone: true, visualLookFeel: true } } },
      }),
      db.brandKit.findFirst({
        where: { clientId, orgId },
        select: { primaryColor: true, secondaryColor: true, accentColor: true },
      }).catch(() => null),
    ]);
    if (!client) return '';
    const bits: string[] = [`Brand: ${client.name}`];
    if (client.industry) bits.push(`industry: ${client.industry}`);
    // Palette conditioning (technique #3): give the model the client's EXACT
    // hex list — measurably steers the palette instead of a vague color word.
    const hexes = [kit?.primaryColor || client.primaryColor, kit?.secondaryColor, kit?.accentColor]
      .filter((h): h is string => !!h && /^#?[0-9a-fA-F]{3,8}$/.test(h))
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
    if (hexes.length) bits.push(`dominant brand palette — weave these EXACT hexes into the color story: ${[...new Set(hexes)].join(', ')}`);
    if (client.brief?.tone) bits.push(`brand tone: ${client.brief.tone}`);
    if (client.brief?.visualLookFeel) bits.push(`visual look & feel: ${client.brief.visualLookFeel.slice(0, 300)}`);
    return `\n\nBrand context (respect it): ${bits.join('; ')}.`;
  } catch {
    return ''; // best-effort — enhancement must never fail on brand lookup
  }
}

// Vision→prompt: describe the attached image so the rewrite grounds in what
// is ACTUALLY in it (exact product, colors, lighting) instead of the user's
// often-thin description. Best-effort; adds one cheap analysis call, only
// when an image is attached.
async function describeReference(input: EnhanceInput): Promise<string> {
  if (!input.refImageBase64) return '';
  try {
    const r = await aiRouter.analysis(
      {
        prompt: 'Describe this image for a prompt writer in at most 60 words: the exact subject (product/brand identity as visible), its colors and materials, the lighting, and the overall photographic style. Return ONLY JSON: {"description":"..."}',
        imageBase64: input.refImageBase64,
        mimeType: input.refImageMime || 'image/png',
      },
      { orgId: input.orgId, userId: input.userId, clientId: input.clientId },
    );
    const out = r.output as any;
    const desc = typeof out === 'string' ? out : typeof out?.description === 'string' ? out.description : '';
    return desc.trim()
      ? `\n\nAttached image contents (ground the prompt in what is ACTUALLY in it — subject identity is non-negotiable): ${desc.trim().slice(0, 400)}`
      : '';
  } catch {
    return ''; // best-effort — vision context must never fail enhancement
  }
}

export async function enhanceCreativePrompt(input: EnhanceInput): Promise<EnhanceResult> {
  const isVideo = input.mode === 'text-to-video' || input.mode === 'image-to-video';
  const depth: EnhanceDepth = input.depth || 'medium';

  // Raw depth: translate-only, no creative rewrite (brand-exact copy safety).
  let system: string;
  if (depth === 'raw') {
    system = isVideo ? RAW_VIDEO_SYSTEM : RAW_IMAGE_SYSTEM;
  } else {
    const base = isVideo ? VIDEO_SYSTEM : (input.mode === 'image-edit' ? EDIT_SYSTEM : IMAGE_SYSTEM);
    const dialect = engineDialect(input.mode, input.engine, input.model);
    system = `${base}${dialect ? `\n${dialect}` : ''}${DEPTH_NOTES[depth]}${QUALITY_GATE}`;
  }

  const notes: string[] = [];
  if (input.mode === 'image-to-video') {
    // Motion-first hard switch (technique #1 / G2 prompt-half): the attached
    // frame IS the subject — re-describing it is what makes the model reinvent
    // the product. Describe ONLY motion/camera/timing.
    notes.push('HARD RULE — the shot animates FROM a provided still image that IS frame one. Describe ONLY the motion, camera movement, pacing and audio. Do NOT re-describe, restyle, or replace the subject/product — it already exists in the frame and must stay pixel-identical. If you name the subject at all, name it only to say what it DOES, never what it looks like.');
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
  // Brand lookup + reference-image vision run in PARALLEL — enhancement must
  // stay fast even when both are needed.
  const [brand, refContext] = await Promise.all([
    brandContext(input.clientId, input.orgId),
    describeReference(input),
  ]);

  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${input.prompt.trim()}"${brand}${refContext}`;

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
