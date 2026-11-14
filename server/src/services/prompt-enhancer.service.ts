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
import type { AiProviderName } from './providers/types.js';
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
  engine?: 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus';
  /** Exact model id when the user picked one — sharper dialect than engine. */
  model?: string;
  /** How aggressively to rewrite. Defaults to 'medium' (legacy behavior). */
  depth?: EnhanceDepth;
  clientId?: string;
  orgId?: string;
  userId?: string;
  /** Opt-in brand kit conditioning. Off by default in Creative Studio so active
   *  client brand copy never hijacks unrelated prompts; on in Agent campaigns. */
  useBrandKit?: boolean;
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
// Strip pasted AI-chat meta instructions ("Copy this prompt into your generator...",
// "Export each slide separately...", "If your generator supports...") while never
// removing lines that carry hex codes, explicit slide headers, or quoted copy.
export function stripChatMetaWrapper(raw: string): string {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const cleaned = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/#[0-9a-fA-F]{3,8}\b/.test(t) || /\bslide\s*\d+\b/i.test(t) || /"[^"]{2,}"/.test(t)) return true;
    if (/^(copy|paste)\s+(and\s+paste\s+)?this\s+(prompt|into|below)\b/i.test(t)) return false;
    if (/^here\s+(is|'s)\s+(your|the|a)\s+(ready[- ]to[- ]use\s+|master\s+)?prompt\b/i.test(t)) return false;
    if (/^export\s+each\s+slide\s+separately\b/i.test(t)) return false;
    if (/^if\s+your\s+(image\s+)?generator\s+supports\b/i.test(t)) return false;
    if (/^(pro\s+tip|usage\s+note|how\s+to\s+use)\s*:/i.test(t)) return false;
    return true;
  });
  const joined = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return joined || raw.trim();
}

const VIDEO_SYSTEM = `You are AURA (powered by Gemini 4 Carbon), an elite commercial film director and cinematographer writing production-grade prompts for 2026 flagship AI video engines (ByteDance Dreamina Seedance 2.5 & 2.0 with native audio, Alibaba Wan 3.0 Prime with native audio, MiniMax H3 2K cinema with stereo audio, Google Gemini Omni 1.2 Flash Video, HappyHorse 1.1 physics, xAI Grok Imagine Video 1.5).
First, understand the user's real intent: effortlessly decode messy shorthand, typos, slang, Arabic/English mix, pop-culture or sports references, and imaginative concepts into crystal-clear visual storytelling.
Rewrite the user's idea into ONE cohesive cinematic shot description using this exact sequence:
[Cinematography & Camera Rig] [Hero Subject & Micro-Textures] [Physical Action & Temporal Progression] [Environment & Lighting Physics] [Color Grade & Atmosphere] [Audio].
Rules:
- START with the camera rig and optics: shot scale, focal length, depth of field, and one fluid physical camera movement (e.g. "Low-angle Steadicam push-in on an 85mm anamorphic prime, shallow f/1.8 depth of field"). Preserve any specific camera, lens, or aesthetic cue the user asked for.
- Describe every hero subject with tangible physical materials (condensation droplets, brushed anodized metal, fabric weave, fur strands, natural skin subsurface scattering) and choreograph how the action unfolds over time with realistic weight, momentum, and secondary motion.
- If the user references iconic sports, pop-culture, or character archetypes (especially in stylized, animal, or playful scenes), translate the archetype into unmistakable visual wardrobe and staging (such as iconic jersey colors, squad numbers like crimson-and-green #7 vs sky-blue-and-white striped #10, signature stance, and stadium atmosphere) so every engine renders it faithfully without safety-filter false positives.
- ALWAYS write in English. If the user's idea is in Arabic or another language, translate the visual intent faithfully (do NOT transliterate), while keeping any requested spoken dialogue or in-scene signage in its original language inside double quotes.
- Never invent or insert unrelated brand names, logos, or copy that the user did not ask for. Never use em-dashes or en-dashes.
- Present tense, concrete visual language. Default to ONE continuous shot with ONE dominant camera move. EXCEPTION: if the user asks for a multi-cut ad or long sequence, choreograph up to 3 timestamped beats inline ("[00:00] wide establishing ... [00:03] medium tracking ... [00:06] macro hero reveal").
- End with audio as plain sentences in the SAME single line (unless the engine dialect explicitly says to omit audio): "SFX: <foley and impact sounds>. Ambient noise: <room tone or environmental soundscape>."
- Adaptive length: 90-145 words for standard concepts, expanding up to 220 words when preserving multi-beat storyboards, exact spoken lines, or explicit brand hex/material specs. The whole prompt must be ONE single-line string with no literal line breaks, no markdown, and no filler.
Also produce a comma-separated negativePrompt of shot-specific artifacts to avoid (morphing geometry, floating limbs, jitter, watermark, text overlay glitches: plain nouns/phrases, never "no X").
Return ONLY compact single-line JSON: {"prompt": "...", "negativePrompt": "..."}`;

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

const IMAGE_SYSTEM = `You are AURA (powered by Gemini 4 Carbon), an executive creative director and master photographer writing prompts for 2026 flagship AI image engines (Google Gemini 3 Pro Image, Gemini Nano Banana 2.1, ByteDance Dola Seedream 5.5 & Seedream 5.0 4K, MiniMax H3-Image 4K, Qwen Image 3.0 Pro, Wan 2.7 Image Pro, xAI Grok Imagine 2.0).
First, understand what the user truly wants: decode shorthand, typos, casual phrasing, Arabic/English code-switching, cultural or sports references, editorial graphic layouts, and multi-character interactions with effortless precision.
Rewrite the user's idea into ONE production-grade visual prompt following this flow:
hero subjects or editorial layout structure -> composition, camera angle, margins & spatial staging -> lighting geometry (key/fill/rim direction, Kelvin warmth, specular highlights) -> color story (including exact hex codes when given) & environment -> optical or typographic finish.
Rules:
- SINGLE-FRAME CONTRACT: One image generation call renders ONE standalone full-bleed frame, NEVER a multi-panel collage, contact sheet, or "seven separate slides" inside a single image. If the user pastes a multi-slide carousel brief, render ONLY the single requested slide (or Slide 1, the cover slide, when no slide number is specified) as one complete full-bleed artwork, omitting all other slides.
- Honor every specific subject, count, action, style, film stock, hex color code, layout margin, or camera cue the user mentioned. Never replace their subject or force a generic studio backdrop when their scene calls for a stadium, street, cafe, editorial graphic card, or fantasy world.
- If the user references iconic sports, pop-culture, or character archetypes in creative/stylized/animal concepts (e.g. cats as Ronaldo and Messi), translate those references into unmistakable visual details (distinctive crimson-and-green #7 kit vs sky-blue-and-white vertical-striped #10 kit, athletic posture, stitched leather match ball, floodlit pitch) so the image engine nails the scene cleanly without celebrity-likeness blocks.
- Write the scene description in English (translate faithfully if needed), EXCEPT text that must render inside the image: quote any headline, subheadline, slide counter, jersey number, logo, or Arabic/English copy EXACTLY as written in double quotes, specifying font style, weight, material treatment, and exact placement in the frame. Never add unrequested text or unrelated brand names.
- ADAPTIVE FIDELITY: Use concrete physical nouns and optical terms (subsurface scattering, rim light, 85mm f/1.8, tactile grain). Write 70-130 words for concise ideas, expanding up to 220 words when preserving rich master briefs with explicit quoted copy, hex palettes (#XXXXXX), and layout margins. Flowing prose, no markdown, no bullet lists, never use em-dashes or en-dashes.
Return ONLY JSON: {"prompt": "..."}`;

const EDIT_SYSTEM = `You are AURA (powered by Gemini 4 Carbon), a master commercial retoucher and art director writing precision edit instructions for multi-modal AI image-editing engines (Google Gemini 3 Pro Image, Gemini Nano Banana 2.1, ByteDance Dola Seedream 5.5 & Seedream 5.0 4K, MiniMax H3-Image 4K, Qwen Image 3.0 Pro, Wan 2.7 Image Pro, xAI Grok Imagine 2.0).
Decode any shorthand or typos in the user's request and rewrite it into ONE unambiguous edit instruction:
1. State the exact visual modification, replacement, or multi-image synthesis first.
2. Explicitly lock what must remain pixel-consistent from the base/reference images (product geometry, brand logo, facial identity, perspective, and camera angle).
3. Specify how new or modified elements integrate seamlessly into the existing lighting direction, shadow falloff, reflections, and color grade (preserving any explicit hex color codes).
Write in English (translate if needed), except in-image text which must be quoted EXACTLY in its original language. Never inject unrelated brand names. 50-120 words, prose only, never use em-dashes or en-dashes.
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
  | 'wan-image'
  | 'qwen-image-21'
  | 'nano-banana'
  | 'grok-image'
  | 'minimax-image'
  | 'seedream'
  | 'z-image'
  | 'wan3'
  | 'wan'
  | 'happyhorse'
  | 'grok-video'
  | 'omni-video'
  | 'hailuo-h3'
  | 'seedance'
  | 'seedance-v1'
  | 'vidu'
  | 'none';

const DIALECT_NOTES: Record<DialectKey, string> = {
  'nano-banana': `ENGINE NOTES (Gemini 3 Pro Image & Nano Banana 2.1 / nano-banana): this model reads flowing narrative sentences far better than keyword lists. Describe the scene as one coherent paragraph. It excels at multi-subject composition, world knowledge, in-image typography, and multi-reference blends: put any required copy in double quotes with font style, weight and placement. Photorealism responds to explicit camera + lens + lighting language (e.g. 85mm, f/2.8, softbox key).`,

  'qwen-image': `ENGINE NOTES (Qwen-Image): strongest at poster-style layouts and dense, accurate text rendering, including Arabic script (keep Arabic in-image text in Arabic). Spell out any text EXACTLY in double quotes, with font style and position. Fully specify the layout: name every major element and where it sits in the frame. Text-heavy ads, flat design and infographics are this engine's sweet spot.`,

  'wan-image': `ENGINE NOTES (Wan 2.7 Image Pro): Alibaba's flagship photorealistic cinema and luxury product engine. Emphasize tactile micro-textures (skin pores, fabric weave, brushed metal, liquid condensation), optical lens physics (e.g. 85mm f/1.4 prime, creamy bokeh, volumetric rim lighting), and three-dimensional foreground/midground/background depth. For edits, lock the hero subject's geometry and match shadow falloff and surface reflections.`,

  'grok-image': `ENGINE NOTES (Grok Imagine 2.0): favors concise, punchy, subject-first prompts with bold contrast and editorial lighting. Lead with the hero subject and its physical materials in the first clause, name the lighting setup clearly, and stay near the LOWER word bound. Supports native 2K generation and image edits.`,

  'minimax-image': `ENGINE NOTES (MiniMax H3-Image & Image-01): native 4K studio photorealism, rich editorial portraiture, character consistency, and multi-image composition. Describe subjects, skin and material micro-textures, lighting ratios, and optical depth (focal length + aperture) in clear flowing prose. Put any in-image copy in double quotes with font style and placement. For edits, state clearly what changes while keeping subject identity and lighting cohesive. 65-110 words.`,

  seedream: `ENGINE NOTES (ByteDance Dola Seedream 5.5 & Seedream 5.0 4K): ByteDance's flagship studio photorealism, graphic design, multi-reference consistency (up to 10 images), and native RGBA transparent PNG engine. Describe subjects, physical textures, lighting ratios, and camera optics (e.g. 85mm f/1.8 prime) in flowing prose. Quote any in-image typography in double quotes with font style and placement. When the user requests a cutout, sticker, icon, or transparent background, explicitly state "isolated on a clean transparent background". 65-120 words.`,

  'z-image': `ENGINE NOTES (Z-Image Turbo): photo-real output and strong bilingual Chinese-English text rendering. Put any copy in double quotes exactly as written and say where it sits in the frame. Describe the scene plainly and concretely; this engine rewards specificity over poetry. 50-90 words.`,

  'qwen-image-21': `ENGINE NOTES (Qwen-Image 2.1): this engine takes up to ten reference images and understands LOCAL edits. When the user asks to change one thing, name exactly which element changes and then say explicitly that everything else must stay identical (product, logo, colours, framing, lighting). Refer to the source as "Image 1". 50-100 words.`,

  wan: `ENGINE NOTES (Wan text-to-video): VISUAL-ONLY engine. Omit the SFX/Ambient/dialogue sentences entirely and spend those words on motion instead. One continuous scene: explicit motion verbs for the subject AND one clear camera move. 60-100 words.`,

  'grok-video': `ENGINE NOTES (Grok Imagine Video 1.5): favors high-energy 1080p cinematic beats, crisp camera movement (tracking, whip-pan, slow push-in), and dynamic lighting physics. 60-95 words, one decisive camera move, vivid temporal action. Keep the SFX and Ambient clauses concise.`,

  'omni-video': `ENGINE NOTES (Gemini Omni 1.2 Flash Video): Google's native multimodal video engine on the Interactions API. Reads natural cinematic prose best. Omit explicit SFX/Ambient tags and spend every word on continuous physical motion, camera choreography, optical lighting, and material realism across 4 to 12 seconds. 65-110 words.`,

  'hailuo-h3': `ENGINE NOTES (MiniMax H3 / Hailuo H3): renders native 2K cinema video with synchronized stereo audio (4 to 15s), micro-expression human acting, and complex camera choreography. KEEP the audio lines and make them vivid and specific. Choreograph one decisive physical camera move (dolly, Steadicam arc, crane, handheld push-in), expressive human acting or physical motion, lighting geometry, and atmosphere. If spoken dialogue is implied, write it in double quotes in the speaker's language. End with "SFX: <sound>. Ambient noise: <soundscape>." 75-120 words.`,

  seedance: `ENGINE NOTES (ByteDance Dreamina Seedance 2.5 & 2.0): renders cinema-grade video (4 to 30s on 2.5, 4 to 15s on 2.0, up to 1080p/4K) with synchronized native audio, multi-shot cuts, first/last frame bookends, and omni multimodal references. KEEP the audio lines and make them vivid and specific. Choreograph decisive camera movement, expressive character acting or product physics, and cohesive lighting; for multi-shot ads, use timestamped beats ("[00:00] ... [00:04] ..."). End with "SFX: <sound>. Ambient noise: <soundscape>." 75-130 words.`,

  'seedance-v1': `ENGINE NOTES (ByteDance Seedance 1.0 Pro / Pro Fast): VISUAL-ONLY cinema video engine (2 to 12s up to 1080p, no native audio). Omit the SFX/Ambient/dialogue sentences entirely and spend every word on crisp camera choreography, physical motion, and lighting atmosphere. 60-100 words.`,

  wan3: `ENGINE NOTES (Wan 3.0): renders synchronized sound in the same pass as the video (2 to 30s at 720p/1080p), so KEEP the audio lines and make them vivid and specific. Choreograph the camera move, subject action, physical environment, and lighting. If the brief implies speech, give the line in the user's own language in double quotes and mark who says it. End with "SFX: <sound>. Ambient noise: <soundscape>." 70-120 words.`,

  happyhorse: `ENGINE NOTES (HappyHorse 1.1): VISUAL-ONLY engine, it publishes no audio, so omit the SFX/Ambient/dialogue sentences entirely and spend those words on motion instead. This is our most physically accurate engine, so be concrete about weight, inertia and momentum: how the subject accelerates, settles and reacts. One continuous shot, one clear camera move. 60-100 words.`,

  vidu: `ENGINE NOTES (Vidu Q3): an advertising engine. Write ONE 16-second cut as two or three numbered beats, each starting with a camera move ("[00:00] slow push-in on the product, ..."). The product stays identical in every beat, lit consistently. Name the marketing beat you are building toward (reveal, benefit, call to action). Sound lines are welcome and should name the mood. 70-120 words.`,

  none: '',
};

export const DIALECT_HINTS: Record<DialectKey, string> = {
  'qwen-image': 'Prompt written for Qwen Image. The layout is spelled out and any text in the picture is quoted exactly.',
  'wan-image': 'Prompt written for Wan 2.7 Image. Rich optical lighting, physical surface texture, and camera depth.',
  'qwen-image-21': 'Prompt written for Qwen Image 2.1. It names what changes and says plainly that the rest stays the same.',
  'nano-banana': 'Prompt written for Gemini. One flowing paragraph, with the camera and lens named.',
  'grok-image': 'Prompt written for Grok. Short and punchy, with the subject first.',
  'minimax-image': 'Prompt written for MiniMax H3-Image. Native up-to-4K photorealism, studio lighting, and character fidelity.',
  seedream: 'Prompt written for ByteDance Seedream. Studio lighting and lens, any copy quoted exactly, and a transparent background when you ask for one.',
  'z-image': 'Prompt written for Z-Image. A plain concrete description, with any copy quoted exactly.',
  wan3: 'Prompt written for Wan 3.0. This engine makes the sound too, so describe what the scene sounds like.',
  wan: 'Prompt written for Wan 2.7. This engine makes no sound, so the prompt covers motion only.',
  happyhorse: 'Prompt written for HappyHorse. This engine makes no sound, so the prompt spends its words on weight and momentum.',
  'grok-video': 'Prompt written for Grok video. Short, high energy beats.',
  'omni-video': 'Prompt written for Gemini Omni Video. Flowing cinematic motion, camera optics, and physical realism.',
  'hailuo-h3': 'Prompt written for MiniMax H3. Native 2K cinema motion, human micro-expressions, and synchronized stereo sound.',
  seedance: 'Prompt written for ByteDance Seedance 2.5 and 2.0. Shot-by-shot camera moves and cuts, with the sound described.',
  'seedance-v1': 'Prompt written for ByteDance Seedance 1.0. This engine makes no sound, so the prompt covers motion and camera only.',
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
  if (primary === 'minimax') {
    return {
      engine: 'minimax',
      model: isVideo
        ? (process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-H3')
        : (process.env.MINIMAX_IMAGE_MODEL || 'MiniMax-H3-Image'),
    };
  }
  if (primary === 'byteplus') {
    return {
      engine: 'byteplus',
      model: isVideo
        ? (process.env.ARK_VIDEO_MODEL || 'dreamina-seedance-2-5-260628')
        : (process.env.ARK_IMAGE_MODEL || 'dola-seedream-5-5-261028'),
    };
  }
  return { engine: primary };
}

/** The engine a model id belongs to. Absent model = Auto = Alibaba. */
export function engineForModel(model?: string): 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus' {
  const m = (model || '').toLowerCase();
  if (!m) return 'dashscope';
  if (m.includes('seedance') || m.includes('seedream') || m.includes('dreamina') || m.includes('dola-seed')) return 'byteplus';
  if (m.includes('minimax') || m.includes('hailuo') || m === 'image-01') return 'minimax';
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
  if (eng === 'minimax' && !m) {
    m = (isVideo
      ? (process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-H3')
      : (process.env.MINIMAX_IMAGE_MODEL || 'MiniMax-H3-Image')).toLowerCase();
  }
  if (eng === 'byteplus' && !m) {
    m = (isVideo
      ? (process.env.ARK_VIDEO_MODEL || 'dreamina-seedance-2-5-260628')
      : (process.env.ARK_IMAGE_MODEL || 'dola-seedream-5-5-261028')).toLowerCase();
  }
  if (isVideo) {
    // Order matters: each family is checked before the next, because a pick
    // must never inherit another family's instruction (Vidu is not Wan,
    // HappyHorse is not Wan 3.0, Wan 3.0 is not Wan 2.7, MiniMax H3 is not Wan).
    if (m.includes('dreamina-seedance') || m.includes('seedance-2') || m.includes('seedance-1-5') || (!m && eng === 'byteplus')) return 'seedance';
    if (m.includes('seedance')) return 'seedance-v1';
    if (m.includes('minimax') || m.includes('hailuo') || (!m && eng === 'minimax')) return 'hailuo-h3';
    if (m.includes('omni') || m.includes('veo')) return 'omni-video';
    if (m.includes('vidu')) return 'vidu';
    if (/wan3\./.test(m)) return 'wan3';
    if (m.includes('happyhorse')) return 'happyhorse';
    if (m.includes('wan')) return 'wan';
    if (m.includes('grok') || (!m && eng === 'xai')) return 'grok-video';
    if (!m && (eng === 'gemini' || eng === 'vertex')) return 'omni-video';
    return 'none';
  }
  if (m.includes('seedream') || (!m && eng === 'byteplus')) return 'seedream';
  if (m.includes('minimax') || m === 'image-01' || (!m && eng === 'minimax')) return 'minimax-image';
  if (m.includes('z-image')) return 'z-image';
  if (m.includes('qwen-image-2.1')) return 'qwen-image-21';
  if (m.includes('wan')) return 'wan-image';
  if (m.includes('qwen') || (!m && eng === 'dashscope')) return 'qwen-image';
  if (m.includes('grok') || (!m && eng === 'xai')) return 'grok-image';
  return 'nano-banana'; // gemini / vertex default (nano-banana)
}

export interface SmartEnginePick {
  provider: 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus';
  model: string;
  reason: string;
}

/**
 * AURA's per-prompt Creative Director router. Inspects the user's intent,
 * language, layout density, subject complexity, and motion requirements to pick
 * the highest-performing engine when the user leaves the picker on Auto.
 */
export function selectBestCreativeEngine(
  mode: EnhanceMode,
  prompt: string,
  opts: { fast?: boolean; hasRefs?: boolean; hasEndFrame?: boolean; quality?: 'standard' | 'ultra' } = {},
): SmartEnginePick {
  const p = (prompt || '').trim();
  const hasArabic = /[\u0600-\u06FF]/.test(p);

  if (mode === 'image-edit') {
    if (hasArabic) {
      return { provider: 'dashscope', model: 'qwen-image-3.0-pro', reason: 'Arabic typography and structured layout edit' };
    }
    if (/\b(transparent\s+background|rgba|die[\s-]?cut|sticker|cutout|isolated\s+png|seedream)\b/i.test(p)) {
      return { provider: 'byteplus', model: 'dola-seedream-5-5-261028', reason: 'Native RGBA transparent cutout and multi-reference Seedream 5.5 edit' };
    }
    return {
      provider: 'gemini',
      model: opts.fast ? 'gemini-nano-banana-2.1' : 'gemini-3-pro-image',
      reason: 'Flagship identity-preserving multimodal image edit',
    };
  }

  if (mode === 'text-to-image') {
    if (!hasArabic && /\b(carousel|slide\s*\d+)\b/i.test(p)) {
      return { provider: 'gemini', model: 'gemini-3-pro-image', reason: 'Editorial social card layout, exact typography, and hex palette control' };
    }
    if (hasArabic || /\b(poster|infographic|flyer|menu|brochure|typography|calligraphy|arabic)\b/i.test(p)) {
      return { provider: 'dashscope', model: 'qwen-image-3.0-pro', reason: 'Bilingual typography and structured poster layout' };
    }
    if (/\b(transparent\s+background|rgba|die[\s-]?cut|sticker|cutout|isolated\s+png|seedream)\b/i.test(p)) {
      return { provider: 'byteplus', model: 'dola-seedream-5-5-261028', reason: 'Native RGBA transparent PNG and graphic design synthesis' };
    }
    if (opts.fast) {
      return { provider: 'gemini', model: 'gemini-nano-banana-2.1', reason: 'Fast high-coherence Gemini image synthesis' };
    }
    if (/\b(neon|cyberpunk|synthwave|vaporwave|street\s*art|graffiti|dark\s*noir)\b/i.test(p) && opts.quality !== 'ultra') {
      return { provider: 'xai', model: 'grok-imagine-image-2.0', reason: 'Punchy high-contrast 2K aesthetic' };
    }
    if (
      /\b(perfume|oud|serum|skincare|cosmetic|macro\s+shot|condensation\s+droplets|luxury\s+bottle|watch\s+dial)\b/i.test(p)
      && !/"[^"]+"/.test(p)
      && opts.quality !== 'ultra'
    ) {
      return { provider: 'dashscope', model: 'wan2.7-image-pro', reason: 'Photorealistic luxury product and tactile micro-texture' };
    }
    if (/\b(editorial\s+portrait|fashion\s+editorial|headshot|beauty\s+campaign|4k\s+portrait)\b/i.test(p) && opts.quality !== 'ultra') {
      return { provider: 'minimax', model: 'MiniMax-H3-Image', reason: 'Native 4K studio portrait and character photorealism' };
    }
    return {
      provider: 'gemini',
      model: 'gemini-3-pro-image',
      reason: 'Flagship world-knowledge, multi-subject composition, and studio optics',
    };
  }

  // Video modes: text-to-video & image-to-video
  if (/\b(seedance|dreamina|multi[\s-]?shot|storyboard|commercial\s+cut|montage|three[\s-]?shot|two[\s-]?shot\s+cut)\b/i.test(p)) {
    return { provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', reason: 'ByteDance Seedance 2.5 multi-shot cinema direction with synchronized audio' };
  }
  if (opts.hasEndFrame || opts.hasRefs) {
    return { provider: 'dashscope', model: 'wan3.0-video-prime', reason: 'First/last frame and reference-consistent 1080p video' };
  }
  if (opts.fast) {
    return { provider: 'gemini', model: 'gemini-omni-1.1-flash', reason: 'Fast native multimodal video generation' };
  }
  if (/\b(monologue|talking\s+head|lip[\s-]?sync|micro[\s-]?expression|facial\s+expression|emotional\s+close[\s-]?up|actor\s+delivering|presenter\s+speaking)\b/i.test(p)) {
    return { provider: 'minimax', model: 'MiniMax-H3', reason: 'Native 2K human acting, micro-expressions, and stereo audio' };
  }
  if (/\b(whip[\s-]?pan|car\s+chase|drift|fpv|drone\s+dive|parkour|explosion|high[\s-]?speed)\b/i.test(p) && mode === 'text-to-video') {
    return { provider: 'xai', model: 'grok-imagine-video-1.5', reason: 'High-energy 1080p dynamic action cinematography' };
  }
  if (
    mode === 'text-to-video'
    && !/\b(audio|sound|sfx|dialogue|speaking|talking|voice|music|singing|whisper)\b/i.test(p)
    && /\b(cat|cats|dog|dogs|wildlife|animal|ocean\s+waves|timelapse|botanical)\b/i.test(p)
  ) {
    return { provider: 'gemini', model: 'gemini-omni-1.2-flash', reason: 'Natural organic motion and multimodal world physics' };
  }
  return {
    provider: 'dashscope',
    model: 'wan3.0-video-prime',
    reason: 'Flagship 1080p cinema video with synchronized native audio',
  };
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

  const cleanedPrompt = depth === 'raw' ? input.prompt.trim() : stripChatMetaWrapper(input.prompt);
  const effectiveInput: EnhanceInput = { ...input, prompt: cleanedPrompt };

  // Shared with enhanceCreativeVariants: one source of truth for the
  // motion-first/edit/refs/safe-zone/style-pack/single-slide guards.
  const notes = enhanceNotes(effectiveInput, isVideo);
  // Brand lookup runs ONLY when opt-in useBrandKit is enabled; reference-image
  // vision always runs when a frame is attached.
  const [brand, refContext] = await Promise.all([
    input.useBrandKit ? brandContext(input.clientId, input.orgId) : Promise.resolve(''),
    describeReference(input),
  ]);

  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${cleanedPrompt}"${brand}${refContext}`;

  const enhancerModel = process.env.PROMPT_ENHANCER_MODEL || 'gemini-4-carbon';
  const enhancerProvider = (process.env.PROMPT_ENHANCER_PROVIDER as AiProviderName | undefined) || 'gemini';

  const result = await aiRouter.text(
    {
      prompt: userMsg,
      system,
      json: true,
      temperature: 0.65,
      maxTokens: 8192,
      model: enhancerModel,
    },
    {
      orgId: input.orgId,
      userId: input.userId,
      clientId: input.clientId,
      skipBrandKit: true,
      skipKnowledge: true,
      preferredProvider: enhancerProvider,
    },
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

// Build the shared context notes (motion-first, single-slide carousel, refs, safe-zone, style pack).
export function enhanceNotes(input: EnhanceInput, isVideo: boolean): string[] {
  const notes: string[] = [];
  if (
    input.mode === 'text-to-image'
    && (/\bslide\s*1\b[\s\S]*\bslide\s*2\b/i.test(input.prompt) || /\b([2-9]|1\d)[\s-]*slide\s+carousel\b/i.test(input.prompt))
  ) {
    const targetMatch = input.prompt.match(/\b(?:render|generate|only|just)\s+slide\s*(\d+)\b/i);
    const targetSlide = targetMatch ? `Slide ${targetMatch[1]}` : 'Slide 1 (the Cover slide)';
    notes.push(`SINGLE-SLIDE CAROUSEL RULE. This image engine renders ONE standalone frame per call, NEVER multiple slides, split-screens, or grids. Render ONLY ${targetSlide} as one full-bleed artwork. Preserve the global art direction, exact hex color codes, layout margins, typography hierarchy, slide counter (such as "01/07"), and the exact quoted copy for ${targetSlide} ONLY. Omit the copy and scenes of all other slides, and NEVER write phrases like "seven separate slides" or "carousel set".`);
  }
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
    notes.push(`STYLE PACK "${input.stylePack.name}": the art direction below is a HARD constraint; weave its exact palette, materials, lighting and mood into the prompt (the user's subject stays the hero): ${directive}`);
  }
  return notes;
}

// Multi-direction "Improve with AI": returns N genuinely DIFFERENT creative
// directions for the same idea (each a full production-grade prompt), so the
// user explores angles instead of accepting one guess. One AI call (fast/cheap).
export async function enhanceCreativeVariants(input: EnhanceInput, count = 3): Promise<EnhanceVariantsResult> {
  // depth='raw' is a brand-exact contract (translate-only, never rewrite): 3
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

  const cleanedPrompt = stripChatMetaWrapper(input.prompt);
  const effectiveInput: EnhanceInput = { ...input, prompt: cleanedPrompt };
  const notes = enhanceNotes(effectiveInput, isVideo);
  const [brand, refContext] = await Promise.all([
    input.useBrandKit ? brandContext(input.clientId, input.orgId) : Promise.resolve(''),
    describeReference(input),
  ]);
  const userMsg = `${notes.length ? notes.map(n => `NOTE: ${n}`).join('\n') + '\n\n' : ''}User idea:\n"${cleanedPrompt}"${brand}${refContext}`;

  const enhancerModel = process.env.PROMPT_ENHANCER_MODEL || 'gemini-4-carbon';
  const enhancerProvider = (process.env.PROMPT_ENHANCER_PROVIDER as AiProviderName | undefined) || 'gemini';

  const result = await aiRouter.text(
    {
      prompt: userMsg,
      system,
      json: true,
      temperature: 0.85,
      maxTokens: 12288,
      model: enhancerModel,
    },
    {
      orgId: input.orgId,
      userId: input.userId,
      clientId: input.clientId,
      skipBrandKit: true,
      skipKnowledge: true,
      preferredProvider: enhancerProvider,
    },
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
