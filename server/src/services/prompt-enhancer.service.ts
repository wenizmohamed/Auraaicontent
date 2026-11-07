// Model-aware prompt enhancer for the Creative Studio (2026-07-02).
// SOTA prompting pass 2026-07-09: per-engine dialects, silent draft→critique
// quality gate, and vision→prompt reference grounding.
//
// Replaces the generic "make it vivid" rewriter with per-engine templates.
// The structure below (camera first, then subject, action, setting, grade,
// then audio) came from Google's official prompting guide and is still the
// strongest direction we have, but it is NOT Veo-specific: the live video
// engines are Alibaba Wan 3.0 / Wan 2.7 / HappyHorse 1.1 (there is no live
// Veo since 2026-11-07). The base prompt therefore describes the structure
// without naming a model, and each engine's dialect block carries the part
// that actually differs:
//  - English prompts: every engine here wants English. An Arabic or any other
//    language brief is translated in this layer, never passed through raw.
//  - Image ads want explicit composition/negative-space-for-copy, lighting,
//    and EXACT quoted text when copy must render in-image.
//  - Engines read prompts differently (2026-07-09): nano-banana wants flowing
//    narrative + quoted typography; Qwen-Image wants fully-specified poster
//    layouts (and renders Arabic text well); Grok wants short and punchy.
//  - AUDIO CAPABILITY SPLITS THE VIDEO FAMILY (verified on the live
//    workspaces 2026-11-07): wan3.0-* lists Audio as a response modality and
//    renders sound in the SAME pass as the picture, so its dialect KEEPS the
//    audio lines. wan2.7-* and happyhorse-1.1-* publish Video only, so their
//    dialect DELETES every SFX/dialogue line instead. Getting this backwards
//    silently throws away the user's sound design.
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
  // 'vertex' = Google Vertex AI (added 2026-11-07). It serves the same
  // nano-banana / gemini-3-pro-image models as the Developer API, so it must
  // get the GOOGLE dialect, not the Alibaba one.
  engine?: 'gemini' | 'xai' | 'dashscope' | 'vertex';
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
  /** Only for video modes — feeds the engine's real negativePrompt param. */
  negativePrompt?: string;
  provider: string;
  model: string;
  latencyMs: number;
}

// Base VIDEO prompt. Engine-neutral on purpose (2026-11-07): the live video
// engines are Alibaba Wan 3.0 / Wan 2.7 / HappyHorse 1.1, so the base text
// describes the STRUCTURE without claiming a model parses it. The dialect
// block added per engine carries what actually differs, including whether
// audio lines are wanted at all.
const VIDEO_SYSTEM = `You are a film director writing production-grade prompts for an AI video model.
Rewrite the user's idea into ONE continuous shot description using this exact structure, in this order:
[Cinematography] [Subject] [Action] [Context] [Style & Ambiance] [Audio].
Rules:
- START with the camera: shot type, lens/framing, and one clear camera movement (e.g. "Slow dolly push-in, 35mm, shallow depth of field").
- Then the subject and its defining visual details, then exactly what happens during the shot, then the setting, then style/mood/color grade.
- ALWAYS write in English. If the user's idea is in Arabic or any other language, translate the intent faithfully (do NOT transliterate).
- Present tense, concrete visual language. Default to ONE shot with ONE dominant camera move. No cuts. EXCEPTION: if the user explicitly asks for multiple beats/shots, sequence them inline with timestamps ("[00:00] wide establishing … [00:03] medium push-in … [00:06] close hero"). Keep it to 3 beats max and one clear move per beat.
- End the prompt with audio as plain sentences in the SAME single line: "SFX: <sound effects>. Ambient noise: <background soundscape>." Include spoken dialogue in double quotes ONLY if the user asked for speech; for Arabic-market ads keep any dialogue in the user's language.
- 90–140 words total. The whole prompt must be ONE single-line string. No literal line breaks. No markdown, no lists, no camera jargon soup. Every term must be purposeful.
- This is a social-media AD: keep the subject hero-lit and the message readable at a glance.
Also produce a comma-separated negativePrompt of shot-specific things to avoid (styles, objects, artifacts. Plain nouns/phrases, never "no X").
Return ONLY compact single-line JSON (no literal newlines inside strings): {"prompt": "...", "negativePrompt": "..."}`;

// Raw mode (depth='raw'): translate-only, never reinterpret. Keeps brand-exact
// wording intact while still giving the engine an English prompt + a negativePrompt.
const RAW_VIDEO_SYSTEM = `You are a faithful translator for an AI video model. Do NOT rewrite, embellish, or reinterpret the user's idea. Preserve their exact intent and wording. ONLY translate to English if it is in another language (translate faithfully, never transliterate), and format as ONE single-line string. Also produce a short comma-separated negativePrompt of obvious artifacts to avoid (plain nouns, never "no X"). Return ONLY compact single-line JSON: {"prompt": "...", "negativePrompt": "..."}`;
const RAW_IMAGE_SYSTEM = `You are a faithful translator for an AI image model. Do NOT rewrite, embellish, or reinterpret. Preserve the user's exact intent and wording, including any text to render in-image (quote it exactly in its original language). ONLY translate the description to English if needed (faithfully, never transliterate). Return ONLY JSON: {"prompt": "..."}`;

// Depth directives appended to the (non-raw) system prompt.
const DEPTH_NOTES: Record<Exclude<EnhanceDepth, 'raw'>, string> = {
  low: '\nDEPTH = LOW: light touch only. Fix clarity and add at most the single most important missing detail (camera OR lighting). Stay close to the user\'s original wording and length.',
  medium: '',
  high: '\nDEPTH = HIGH: maximize art-direction specificity. Every one of composition, lighting, color palette and finish must be named precisely and vividly, at the upper word bound. Never generic.',
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
Write in English (translate if needed), except text to render in-image. Quote that exactly in its original language. 40–90 words, prose only.
Return ONLY JSON: {"prompt": "..."}`;

// ─── Per-engine dialects (2026-07-09) ────────────────────────────
// Same brief, different phrasing per engine. Short blocks by design —
// they steer vocabulary without bloating the system prompt.

// One keyed table, not loose constants, because the FRONTEND shows the user
// which engine the prompt is written for (apps/desktop/src/lib/creative-models.ts
// keeps a mirror of DIALECT_HINTS). Two lists drift. One table cannot: the
// test in server/test/prompt-enhancer.spec.ts asserts the mirror matches.

/** Every prompt dialect the enhancer knows. */
export type DialectKey =
  | 'qwen-image'
  | 'qwen-image-21'
  | 'nano-banana'
  | 'grok-image'
  | 'z-image'
  | 'wan3'
  | 'wan'
  | 'happyhorse'
  | 'grok-video'
  | 'vidu'
  | 'none';

const DIALECT_NOTES: Record<DialectKey, string> = {
  'nano-banana': `ENGINE NOTES (Gemini nano-banana): this model reads flowing narrative sentences far better than keyword lists. Describe the scene as one coherent paragraph. It renders in-image typography exceptionally well: put any required copy in double quotes with font style, weight and placement. Photorealism responds to explicit camera + lens + lighting language (e.g. 85mm, f/2.8, softbox key).`,

  'qwen-image': `ENGINE NOTES (Qwen-Image): strongest at poster-style layouts and dense, accurate text rendering, including Arabic script (keep Arabic in-image text in Arabic). Spell out any text EXACTLY in double quotes, with font style and position. Fully specify the layout: name every major element and where it sits in the frame. Text-heavy ads, flat design and infographics are this engine's sweet spot.`,

  'grok-image': `ENGINE NOTES (Grok Imagine): favors concise, punchy, subject-first prompts. Lead with the hero subject in the first clause and stay near the LOWER word bound. Bold stylization lands well; long meandering prose drifts.`,

  // Z-Image Turbo tops the open-source text-to-image benchmark and is listed as
  // the current No.1 open-source model on Artificial Analysis. It is strong at
  // bilingual Chinese-English text rendering, so it gets its own note.
  'z-image': `ENGINE NOTES (Z-Image Turbo): photo-real output and strong bilingual Chinese-English text rendering. Put any copy in double quotes exactly as written and say where it sits in the frame. Describe the scene plainly and concretely; this engine rewards specificity over poetry. 50–90 words.`,

  // Qwen-Image 2.1 takes up to TEN reference images and supports LOCAL edits
  // ("change only the shoe"). Its note has to say so, otherwise the enhancer
  // writes a full redraw instruction and the edit lands wrong.
  'qwen-image-21': `ENGINE NOTES (Qwen-Image 2.1): this engine takes up to ten reference images and understands LOCAL edits. When the user asks to change one thing, name exactly which element changes and then say explicitly that everything else must stay identical (product, logo, colours, framing, lighting). Refer to the source as "Image 1". 50–100 words.`,

wan: `ENGINE NOTES (Wan text-to-video): VISUAL-ONLY engine. Omit the SFX/Ambient/dialogue sentences entirely and spend those words on motion instead. One continuous scene: explicit motion verbs for the subject AND one clear camera move. 60–100 words.`,
  'grok-video': `ENGINE NOTES (Grok Imagine video): favors short, high-energy cinematic beats. 60–90 words, one bold camera move, strong stylization. Keep the SFX and Ambient clauses to a few words each.`,

  // Wan 3.0 renders sound in the SAME pass as the picture (the catalog lists
  // Audio as a response modality), and Wan 2.6 Flash supports stable
  // multi-speaker dialogue. The plain Wan note above tells the enhancer to
  // delete every audio line, so the sound capability was never used on the
  // engines that actually have it.
  wan3: `ENGINE NOTES (Wan 3.0): renders sound in the same pass as the picture, so KEEP the audio lines but make them specific and short. Name one camera move, one subject action, and one setting. If the brief implies speech, give the line in the user's own language in double quotes and mark who says it. End with "SFX: <sound>." 60–110 words.`,

  // HappyHorse 1.1 publishes Video only on the live workspace (no audio
  // modality), so it must NOT inherit the Wan 3.0 instruction to keep the audio
  // lines. It is its own engine family: the most physically accurate motion of
  // the three, so it rewards concrete weight, inertia and momentum.
  happyhorse: `ENGINE NOTES (HappyHorse 1.1): VISUAL-ONLY engine, it publishes no audio, so omit the SFX/Ambient/dialogue sentences entirely and spend those words on motion instead. This is our most physically accurate engine, so be concrete about weight, inertia and momentum: how the subject accelerates, settles and reacts. One continuous shot, one clear camera move. 60–100 words.`,

  // Vidu Q3 is an advertising engine: it wants shot-by-shot beats with the
  // subject locked, not one continuous take.
  vidu: `ENGINE NOTES (Vidu Q3): an advertising engine. Write ONE 16-second cut as two or three numbered beats, each starting with a camera move ("[00:00] slow push-in on the product, ..."). The product stays identical in every beat, lit consistently. Name the marketing beat you are building toward (reveal, benefit, call to action). Sound lines are welcome and should name the mood. 70–120 words.`,

  // No live engine lands here. A Google video engine would.
  none: '',
};

/**
 * The one line the UI shows under the engine picker: what kind of prompt this
 * engine wants. Plain words, no jargon, because the whole point is that the
 * user can see why switching engines changes the prompt.
 *
 * The frontend mirrors this table (apps/desktop/src/lib/creative-models.ts).
 * server/test/prompt-enhancer.spec.ts asserts the two agree, so a new
 * engine cannot ship with a prompt nobody can explain.
 */
export const DIALECT_HINTS: Record<DialectKey, string> = {
  'qwen-image': 'Prompt written for Qwen Image. The layout is spelled out and any text in the picture is quoted exactly.',
  'qwen-image-21': 'Prompt written for Qwen Image 2.1. It names what changes and says plainly that the rest stays the same.',
  'nano-banana': 'Prompt written for Gemini. One flowing paragraph, with the camera and lens named.',
  'grok-image': 'Prompt written for Grok. Short and punchy, with the subject first.',
  'z-image': 'Prompt written for Z-Image. A plain concrete description, with any copy quoted exactly.',
  wan3: 'Prompt written for Wan 3.0. This engine makes the sound too, so describe what the scene sounds like.',
  wan: 'Prompt written for Wan 2.7. This engine makes no sound, so the prompt covers motion only.',
  happyhorse: 'Prompt written for HappyHorse. This engine makes no sound, so the prompt spends its words on weight and momentum.',
  'grok-video': 'Prompt written for Grok video. Short, high energy beats.',
  vidu: 'Prompt written for Vidu. Numbered beats for one advertising cut.',
  none: 'Prompt written for a generic engine.',
};

/**
 * The engine AND model Auto will actually run, read from the same env the
 * router uses. This is what makes "Auto" prompt-correct: point
 * AI_IMAGE_PRIMARY at a different provider and the prompt follows it.
 */
export function autoEngineFor(mode: EnhanceMode): { engine: string; model?: string } {
  const isVideo = mode === 'text-to-video' || mode === 'image-to-video';
  const primary = (isVideo ? process.env.AI_VIDEO_PRIMARY : process.env.AI_IMAGE_PRIMARY) || 'dashscope';
  if (primary === 'dashscope') {
    return {
      engine: 'dashscope',
      model: isVideo
        ? (process.env.DASHSCOPE_VIDEO_MODEL || 'wan3.0-video-prime')
        : (process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro'),
    };
  }
  return { engine: primary };
}

/** The engine a model id belongs to. Absent model = Auto = Alibaba. */
export function engineForModel(model?: string): 'gemini' | 'xai' | 'dashscope' | 'vertex' {
  const m = (model || '').toLowerCase();
  if (!m) return 'dashscope';
  if (m.includes('grok')) return 'xai';
  if (m.includes('veo') || m.includes('omni') || m.includes('gemini')) return 'gemini';
  return 'dashscope';
}

export function engineDialect(mode: EnhanceMode, engine?: string, model?: string): string {
  return DIALECT_NOTES[dialectKeyFor(mode, engine, model)];
}

/**
 * Which dialect an engine/model pair gets. Split out from engineDialect so
 * the UI can ask the same question the prompt asks, without shipping the
 * whole instruction block over the wire.
 */
export function dialectKeyFor(mode: EnhanceMode, engine?: string, model?: string): DialectKey {
  const isVideo = mode === 'text-to-video' || mode === 'image-to-video';
  let m = (model || '').toLowerCase();
  let eng = engine;

  // Auto (nothing picked): resolve from the router's own env, so the prompt
  // is written for the engine that will actually run.
  if (!m && !eng) {
    const auto = autoEngineFor(mode);
    eng = auto.engine;
    m = (auto.model || '').toLowerCase();
  }
  // An engine with no model: the provider's default model decides the
  // dialect, and that default is an env value too.
  if (eng === 'dashscope' && !m) {
    m = (isVideo
      ? (process.env.DASHSCOPE_VIDEO_MODEL || 'wan3.0-video-prime')
      : (process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro')).toLowerCase();
  }
  if (isVideo) {
    // Order matters: each family is checked before the next, because a pick
    // must never inherit another family's instruction (Vidu is not Wan,
    // HappyHorse is not Wan 3.0, Wan 3.0 is not Wan 2.7).
    if (m.includes('vidu')) return 'vidu';
    if (/wan3\./.test(m)) return 'wan3';
    if (m.includes('happyhorse')) return 'happyhorse';
    if (m.includes('wan')) return 'wan';
    if (m.includes('grok') || (!m && eng === 'xai')) return 'grok-video';
    return 'none'; // A Google video engine would land here. There is no live one.
  }
  if (m.includes('z-image')) return 'z-image';
  if (m.includes('qwen-image-2.1')) return 'qwen-image-21';
  if (m.includes('qwen') || m.includes('wan') || (!m && eng === 'dashscope')) return 'qwen-image';
  if (m.includes('grok') || (!m && eng === 'xai')) return 'grok-image';
  return 'nano-banana'; // gemini / vertex default (nano-banana)
}

// Silent self-critique before output — one call, zero extra round-trips.
// The named filler words are the measurable AI-tells that make output generic.
const QUALITY_GATE = `
QUALITY GATE. Before answering, silently draft the prompt, then verify: (1) the product/subject is unmistakably the hero; (2) every adjective is concrete and purposeful; (3) composition, lighting and palette are EACH explicitly specified; (4) zero generic filler ("stunning", "breathtaking", "masterpiece", "8k", "ultra-realistic", "high quality", "award-winning"); (5) every NOTE and brand constraint is honored. Fix every failure, then output ONLY the final JSON.`;

async function brandContext(clientId?: string, orgId?: string): Promise<string> {
  if (!clientId || !orgId) return '';
  try {
    // Client (name/industry/primaryColor/brief) + BrandKit palette in parallel.
    const [client, kit] = await Promise.all([
      db.client.findUnique({
        where: { id: clientId, orgId },
        include: { briefs: { select: { tone: true, visualLookFeel: true }, orderBy: { month: 'asc' }, take: 1 } },
      }),
      db.brandKit.findFirst({
        where: { clientId, orgId },
        select: { primaryColor: true, secondaryColor: true, accentColor: true },
      }).catch(() => null),
    ]);
    if (!client) return '';
    const brief = (client as any).briefs?.[0];
    const bits: string[] = [`Brand: ${client.name}`];
    if (client.industry) bits.push(`industry: ${client.industry}`);
    // Palette conditioning (technique #3): give the model the client's EXACT
    // hex list — measurably steers the palette instead of a vague color word.
    const hexes = [kit?.primaryColor || client.primaryColor, kit?.secondaryColor, kit?.accentColor]
      .filter((h): h is string => !!h && /^#?[0-9a-fA-F]{3,8}$/.test(h))
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
    if (hexes.length) bits.push(`dominant brand palette. Weave these EXACT hexes into the color story: ${[...new Set(hexes)].join(', ')}`);
    if (brief?.tone) bits.push(`brand tone: ${brief.tone}`);
    if (brief?.visualLookFeel) bits.push(`visual look & feel: ${brief.visualLookFeel.slice(0, 300)}`);
    return `\n\nBrand context (respect it): ${bits.join('; ')}.`;
  } catch {
    return ''; // best-effort. Enhancement must never fail on brand lookup
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
      ? `\n\nAttached image contents (ground the prompt in what is ACTUALLY in it. Subject identity is non-negotiable): ${desc.trim().slice(0, 400)}`
      : '';
  } catch {
    return ''; // best-effort. Vision context must never fail enhancement
  }
}

// Shared with routes/creative.ts and the video worker.
export const SAFE_ZONE_HINT = 'IMPORTANT COMPOSITION CONSTRAINT: keep the top ~15% and bottom ~15% of the frame clear of text, logos, faces, and key subjects — reserve those bands for social platform UI (Reels/Stories controls, captions). Center all important elements in the middle safe area.';

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

  // Shared with enhanceCreativeVariants — one source of truth for the
  // motion-first/edit/refs/safe-zone/style-pack guards (the 2026-08-02 review
  // traced three bugs to this block having silently diverged copies).
  const notes = enhanceNotes(input, isVideo);
  // Brand lookup + reference-image vision run in PARALLEL — enhancement must
  // stay fast even when both are needed.
  const [brand, refContext] = await Promise.all([
    brandContext(input.clientId, input.orgId),
    describeReference(input),
  ]);

  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${input.prompt.trim()}"${brand}${refContext}`;

  const result = await aiRouter.text(
    // Flash tier: enhancement must feel instant next to a 30-180s generation.
    { prompt: userMsg, system, json: true, temperature: 0.7, maxTokens: 800, model: process.env.PROMPT_ENHANCER_MODEL || 'qwen3.8-flash' },
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

export interface EnhanceVariant { label: string; prompt: string; negativePrompt?: string; }
export interface EnhanceVariantsResult { variants: EnhanceVariant[]; provider: string; model: string; latencyMs: number; }

// Build the shared context notes (motion-first, refs, safe-zone, style pack).
function enhanceNotes(input: EnhanceInput, isVideo: boolean): string[] {
  const notes: string[] = [];
  if (input.mode === 'image-to-video') {
    notes.push('HARD RULE. The shot animates FROM a provided still image that IS frame one. Describe ONLY the motion, camera movement, pacing and audio. Do NOT re-describe, restyle, or replace the subject/product. It already exists in the frame and must stay pixel-identical. If you name the subject at all, name it only to say what it DOES, never what it looks like.');
  }
  if (input.mode === 'image-edit') {
    notes.push('This is an EDIT of an existing image: change ONLY what the user asked for. Subject identity, brand elements and every region the user did not mention stay untouched, with lighting and color continuity to the original.');
  }
  if (input.hasRefs) notes.push('Reference images of the exact product/subject are attached. The output must keep that subject identical; never invent a substitute.');
  if (input.safeZone) notes.push('Composition constraint: keep the top ~15% and bottom ~15% of the frame free of key elements and any rendered text (platform UI bands).');
  if (input.stylePack) {
    const directive = isVideo ? input.stylePack.video : input.stylePack.image;
    notes.push(`STYLE PACK "${input.stylePack.name}"the art direction below is a HARD constraint; weave its exact palette, materials, lighting and mood into the prompt (the user's subject stays the hero): ${directive}`);
  }
  return notes;
}

// Multi-direction "Improve with AI": returns N genuinely DIFFERENT creative
// directions for the same idea (each a full production-grade prompt), so the
// user explores angles instead of accepting one guess. One AI call (fast/cheap).
export async function enhanceCreativeVariants(input: EnhanceInput, count = 3): Promise<EnhanceVariantsResult> {
  // depth='raw' is a brand-exact contract (translate-only, never rewrite) — 3
  // "creative directions" would violate it by definition. Honor it through the
  // single-shot raw path and return that as the one variant.
  if (input.depth === 'raw') {
    const r = await enhanceCreativePrompt(input);
    return {
      variants: [{ label: 'Faithful (raw)', prompt: r.prompt, ...(r.negativePrompt ? { negativePrompt: r.negativePrompt } : {}) }],
      provider: r.provider, model: r.model, latencyMs: r.latencyMs,
    };
  }
  const isVideo = input.mode === 'text-to-video' || input.mode === 'image-to-video';
  // 'raw' already returned above, so what remains types as the non-raw depths.
  const depth: Exclude<EnhanceDepth, 'raw'> = input.depth ?? 'medium';
  const base = isVideo ? VIDEO_SYSTEM : (input.mode === 'image-edit' ? EDIT_SYSTEM : IMAGE_SYSTEM);
  const dialect = engineDialect(input.mode, input.engine, input.model);
  // What the directions may VARY is mode-dependent: for image-to-video the start
  // frame pins subject+setting (varying them re-triggers the product-swap
  // regression the HARD RULE exists for); for edits, continuity IS the contract.
  const varianceAxis = input.mode === 'image-to-video'
    ? 'vary ONLY the motion design. Camera movement, pacing, action beats and audio treatment. NEVER vary, re-describe or restyle the subject, its look, or the setting: frame one already fixes those'
    : input.mode === 'image-edit'
      ? 'vary the EDIT TREATMENT. What is adjusted and how the result is finished (grade, mood, background handling where the user asked). Subject identity, brand elements and everything the user did not ask to change stay untouched in EVERY direction'
      : 'vary the composition, mood, lighting, setting or storytelling approach';
  const variantsDirective = `\n\nOUTPUT CONTRACT OVERRIDE. This section supersedes every earlier instruction about the output JSON shape (the single-object {"prompt": ...} form no longer applies).\nNOW PRODUCE ${count} DISTINCT CREATIVE DIRECTIONS for the SAME user idea. Each must be a GENUINELY different angle. ${varianceAxis}, NOT reworded versions of one another. Give each a short 2-4 word Title-Case LABEL naming its angle (e.g. "Cinematic Hero", "Lifestyle Editorial", "Bold Graphic"). Each direction's "prompt" must INDEPENDENTLY follow every rule above except the superseded output shape.\nThe ONLY valid output is compact single-line JSON with exactly ${count} items: {"variants":[{"label":"...","prompt":"..."${isVideo ? ',"negativePrompt":"..."' : ''}}]}. Any other shape is invalid.`;
  const system = `${base}${dialect ? `\n${dialect}` : ''}${DEPTH_NOTES[depth]}${QUALITY_GATE}${variantsDirective}`;

  const notes = enhanceNotes(input, isVideo);
  const [brand, refContext] = await Promise.all([brandContext(input.clientId, input.orgId), describeReference(input)]);
  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${input.prompt.trim()}"${brand}${refContext}`;

  const result = await aiRouter.text(
    // No maxTokens on purpose: gemini's json path ignores it (own 65536 budget)
    // and passing 2200 to the xai fallback truncated 3 full directions + its
    // thinking tokens into unparseable JSON. temperature still reaches the
    // providers that honor it (xai/dashscope) for direction spread.
    { prompt: userMsg, system, json: true, temperature: 0.9, model: process.env.PROMPT_ENHANCER_MODEL || 'qwen3.8-flash' },
    { orgId: input.orgId, userId: input.userId, clientId: input.clientId },
  );
  const out = result.output as any;
  const raw = Array.isArray(out?.variants) ? out.variants : [];
  const variants: EnhanceVariant[] = raw
    .filter((v: any) => v && typeof v.prompt === 'string' && v.prompt.trim())
    .slice(0, count)
    .map((v: any, i: number) => {
      // Style-pack negatives are a curated art-direction contract — they stand
      // even when the model omits its own negativePrompt (parity with the
      // single-shot merge above).
      const modelNeg = typeof v.negativePrompt === 'string' && v.negativePrompt.trim() ? v.negativePrompt.trim() : undefined;
      const neg = isVideo ? ([modelNeg, input.stylePack?.negative].filter(Boolean).join(', ').slice(0, 400) || undefined) : undefined;
      return {
        label: (typeof v.label === 'string' && v.label.trim() ? v.label.trim() : `Direction ${i + 1}`).slice(0, 40),
        prompt: v.prompt.trim(),
        ...(neg ? { negativePrompt: neg } : {}),
      };
    });

  return { variants, provider: result.provider, model: result.model, latencyMs: result.latencyMs };
}
