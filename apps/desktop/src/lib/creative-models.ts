// Creative Studio model catalog: one list per task section, each starting with
// "Auto" (AURA routes the call: the primary engine first, the rest of the
// server chain on standby). Explicit picks pin one engine; the server still
// falls through its chain if that engine fails.
//
// Keep in step with:
//   server/src/services/providers/ai-router.ts  (chain order per task)
//   server/src/services/providers/dashscope.provider.ts (Alibaba model ids)
//   server/src/lib/ai-pricing.ts (every rate quoted here)
// Re-verified live 2026-11-11 against Weni's active 2026 accounts:
//   1. Alibaba Bailian Token Plan (ap-southeast-1): qwen-image-3.0-pro,
//      wan2.7-image-pro, wan2.7-image, wan3.0-video-prime, wan3.0-video,
//      happyhorse-1.1-t2v / i2v / r2v.
//   2. Google AI Studio / Gemini Developer API + Vertex: gemini-nano-banana-2.1,
//      gemini-3-pro-image.
//   3. xAI Grok: grok-imagine-image-2.0 (T2I + I2I edit), grok-imagine-video-1.5,
//      grok-imagine-video-1.5-lite.

export type CreativeSection =
  | 'text-to-image'
  | 'image-edit'
  | 'upscale'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-video';

export type Vendor = 'Alibaba' | 'Google' | 'xAI' | 'MiniMax' | 'ByteDance';
export type ProviderName = 'gemini' | 'xai' | 'dashscope' | 'vertex' | 'minimax' | 'byteplus';

export interface ModelOption {
  /** Picker id. 'auto' = AURA decides. */
  value: string;
  label: string;
  vendor?: Vendor;
  /** One line, plain words, shown under the label. */
  hint: string;
  /** Request pieces sent to the server. Images: provider (+ model for Alibaba/Grok ids,
   *  + quality for the Google ultra tier). Video: model id (server maps it to
   *  the provider). Auto sends nothing. */
  provider?: ProviderName;
  model?: string;
  quality?: 'standard' | 'ultra';
  /** Owner/admin price hints. Images per picture; video per second at 720p,
   *  with the 1080p rate where the engine charges more for it. */
  perImage?: number;
  perSec?: number;
  perSec1080?: number;
  /** Video limits used by the duration + output controls. */
  minSeconds?: number;
  maxSeconds?: number;
  supports1080?: boolean;
  /** Largest still size this engine actually renders. */
  maxSize?: '1K' | '2K' | '4K';
  /** Video cost tier label carried for accounting. */
  tier?: 'draft' | 'hd';
}

const TIERED_IMAGE_RATES: Record<string, { '1K': number; '2K': number; '4K': number }> = {
  'qwen-image-3.0-pro': { '1K': 0.03438, '2K': 0.068761, '4K': 0.068761 },
  'wan2.7-image-pro': { '1K': 0.044257, '2K': 0.075, '4K': 0.075 },
  'wan2.7-image': { '1K': 0.027504, '2K': 0.027504, '4K': 0.027504 },
  'dola-seedream-5-5-261028': { '1K': 0.02, '2K': 0.035, '4K': 0.035 },
  'dola-seedream-5-0-pro-260628': { '1K': 0.045, '2K': 0.09, '4K': 0.09 },
  // Auto quotes the engine it lands on most: Nano Banana Pro is the
  // fall-through pick for generate and edit, and the first hop for the
  // upscale detail pass. Quoting Qwen's $0.034 here showed a quarter of the
  // real price for most Auto images.
  'auto': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'gemini-nano-banana-2.1': { '1K': 0.034, '2K': 0.050, '4K': 0.113 },
  'gemini-3-pro-image': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'grok-imagine-image-2.0': { '1K': 0.04, '2K': 0.06, '4K': 0.06 },
};

function tierFor(o: ModelOption): { '1K': number; '2K': number; '4K': number } | undefined {
  return (o.model && TIERED_IMAGE_RATES[o.model]) || TIERED_IMAGE_RATES[o.value];
}

export function isTieredImage(o: ModelOption): boolean {
  return !!tierFor(o);
}

export function effectivePerImage(o: ModelOption, imageSize?: '1K' | '2K' | '4K'): number | undefined {
  const tiered = tierFor(o);
  if (tiered) return tiered[imageSize ?? '2K'];
  return o.perImage;
}

// ─── Images ─────────────────────────────────────────────────────

const QWEN_IMAGE: ModelOption = {
  value: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', vendor: 'Alibaba',
  hint: 'Best for layouts, posters, and exact Arabic/English text rendering. Edits too.',
  provider: 'dashscope', model: 'qwen-image-3.0-pro', perImage: 0.03438, maxSize: '2K',
};
const WAN27_IMAGE_PRO: ModelOption = {
  value: 'wan2.7-image-pro', label: 'Wan 2.7 Image Pro', vendor: 'Alibaba',
  hint: 'Flagship Alibaba photorealism. Rich optical lens depth, natural textures, and image edits.',
  provider: 'dashscope', model: 'wan2.7-image-pro', perImage: 0.075, maxSize: '2K',
};
const WAN27_IMAGE: ModelOption = {
  value: 'wan2.7-image', label: 'Wan 2.7 Image', vendor: 'Alibaba',
  hint: 'Fast photorealistic stills and clean image edits at a flat per-image rate.',
  provider: 'dashscope', model: 'wan2.7-image', perImage: 0.027504, maxSize: '2K',
};
const GEMINI_IMAGE: ModelOption = {
  value: 'gemini-flash-image', label: 'Nano Banana 2.1', vendor: 'Google',
  hint: 'Newest Google image model. Native 1K to 4K output, every aspect ratio, precise multi-image edits.',
  provider: 'gemini', model: 'gemini-nano-banana-2.1',
};
const GEMINI_IMAGE_ULTRA: ModelOption = {
  value: 'gemini-pro-image', label: 'Nano Banana Pro', vendor: 'Google',
  hint: 'Flagship Google 2K/4K campaign art, editorial carousels, world knowledge, and identity-locked edits.',
  provider: 'gemini', model: 'gemini-3-pro-image', quality: 'ultra',
};
const GROK_IMAGE_2: ModelOption = {
  value: 'grok-imagine-image-2.0', label: 'Grok Imagine 2.0', vendor: 'xAI',
  hint: 'xAI flagship image engine. Bold cinematic realism, dramatic lighting, generation and edits.',
  provider: 'xai', model: 'grok-imagine-image-2.0', perImage: 0.04, maxSize: '2K',
};
const MINIMAX_H3_IMAGE: ModelOption = {
  value: 'minimax-h3-image', label: 'MiniMax H3-Image (4K)', vendor: 'MiniMax',
  hint: 'Native up-to-4K studio photorealism, editorial portraits, and multi-image edits.',
  provider: 'minimax', model: 'MiniMax-H3-Image', perImage: 0.035, maxSize: '4K',
};
const MINIMAX_H3_IMAGE_FAST: ModelOption = {
  value: 'minimax-h3-image-fast', label: 'MiniMax H3-Image Highspeed', vendor: 'MiniMax',
  hint: 'High-speed native 4K stills and rapid multi-reference image edits.',
  provider: 'minimax', model: 'MiniMax-H3-Image-Highspeed', perImage: 0.04, maxSize: '4K',
};
const MINIMAX_IMAGE_01: ModelOption = {
  value: 'minimax-image-01', label: 'MiniMax Image-01', vendor: 'MiniMax',
  hint: 'Ultra-economy stills and character-consistent reference framing.',
  provider: 'minimax', model: 'image-01', perImage: 0.0035, maxSize: '2K',
};
const SEEDREAM_55: ModelOption = {
  value: 'dola-seedream-5-5', label: 'Dola Seedream 5.5', vendor: 'ByteDance',
  hint: 'ByteDance stills up to 2K. Ask for a transparent background and it returns a real transparent PNG. Edits take up to 10 images.',
  provider: 'byteplus', model: 'dola-seedream-5-5-261028', perImage: 0.02, maxSize: '2K',
};
const SEEDREAM_50_4K: ModelOption = {
  value: 'seedream-5-0-4k', label: 'Seedream 5.0 (4K)', vendor: 'ByteDance',
  hint: 'ByteDance stills at up to 4096 by 4096 pixels, one flat price per image.',
  provider: 'byteplus', model: 'seedream-5-0-260128', perImage: 0.035, maxSize: '4K',
};
const SEEDREAM_50_PRO: ModelOption = {
  value: 'dola-seedream-5-0-pro', label: 'Dola Seedream 5.0 Pro', vendor: 'ByteDance',
  hint: 'Seedream 5.0 Pro, for detailed layouts and text inside the image, up to 2K.',
  provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628', perImage: 0.045, maxSize: '2K',
};
const SEEDREAM_50_FLASH: ModelOption = {
  value: 'dola-seedream-5-0-flash', label: 'Dola Seedream 5.0 Flash', vendor: 'ByteDance',
  hint: 'The cheapest Seedream. Quick 2K stills and edits.',
  provider: 'byteplus', model: 'dola-seedream-5-0-flash-260915', perImage: 0.018, maxSize: '2K',
};

export const TEXT_TO_IMAGE_MODELS: ModelOption[] = [
  // The Auto hints describe selectBestCreativeEngine (server/src/services/
  // prompt-enhancer.service.ts) word for word: a keyword match on the prompt,
  // NOT a model call. Change one, change the other.
  { value: 'auto', label: 'Auto', hint: 'AURA reads your prompt, works out what it needs (text in the image, people, product, style, how complex it is) and assigns the right model from this list. Pick a model yourself to override. Grok only runs when you pick it.' },
  GEMINI_IMAGE_ULTRA, GEMINI_IMAGE,
  SEEDREAM_55, SEEDREAM_50_4K, SEEDREAM_50_PRO, SEEDREAM_50_FLASH,
  MINIMAX_H3_IMAGE, MINIMAX_H3_IMAGE_FAST, MINIMAX_IMAGE_01,
  QWEN_IMAGE, WAN27_IMAGE_PRO, WAN27_IMAGE,
  GROK_IMAGE_2,
];

export const IMAGE_EDIT_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA reads your instruction, works out what must change and what must stay identical, and assigns the right model from this list. Pick a model yourself to override. Grok only runs when you pick it.' },
  GEMINI_IMAGE_ULTRA, GEMINI_IMAGE,
  SEEDREAM_55, SEEDREAM_50_4K, SEEDREAM_50_PRO, SEEDREAM_50_FLASH,
  MINIMAX_H3_IMAGE, MINIMAX_H3_IMAGE_FAST, MINIMAX_IMAGE_01,
  QWEN_IMAGE, WAN27_IMAGE_PRO, WAN27_IMAGE,
  GROK_IMAGE_2,
];

export const UPSCALE_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'The detail pass runs on Nano Banana Pro first, with Seedream 5.0 (4K), Qwen Image 3.0 Pro and MiniMax H3-Image on standby.' },
  SEEDREAM_50_4K, SEEDREAM_55, QWEN_IMAGE, MINIMAX_H3_IMAGE, MINIMAX_H3_IMAGE_FAST, WAN27_IMAGE_PRO, WAN27_IMAGE,
  GEMINI_IMAGE, GEMINI_IMAGE_ULTRA, GROK_IMAGE_2, SEEDREAM_50_FLASH, MINIMAX_IMAGE_01,
];

// ─── Video ──────────────────────────────────────────────────────

const SEEDANCE_25: ModelOption = {
  value: 'dreamina-seedance-2-5', label: 'Dreamina Seedance 2.5', vendor: 'ByteDance',
  hint: 'Clips of 4 to 30 seconds with sound. Handles multi-shot cuts, a start and end frame, or up to 10 reference images.',
  model: 'dreamina-seedance-2-5-260628', perSec: 0.231, perSec1080: 0.569, minSeconds: 4, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const SEEDANCE_20: ModelOption = {
  value: 'dreamina-seedance-2-0', label: 'Dreamina Seedance 2.0', vendor: 'ByteDance',
  hint: 'Clips of 4 to 15 seconds with sound. Takes a start and end frame or reference images.',
  model: 'dreamina-seedance-2-0-260128', perSec: 0.15, perSec1080: 0.37, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const SEEDANCE_20_FAST: ModelOption = {
  value: 'dreamina-seedance-2-0-fast', label: 'Dreamina Seedance 2.0 Fast', vendor: 'ByteDance',
  hint: 'A faster Seedance 2.0 at 720p, with sound. 4 to 15 seconds.',
  model: 'dreamina-seedance-2-0-fast-260128', perSec: 0.12, perSec1080: 0.12, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'draft',
};
const SEEDANCE_20_MINI: ModelOption = {
  value: 'dreamina-seedance-2-0-mini', label: 'Dreamina Seedance 2.0 Mini', vendor: 'ByteDance',
  hint: 'The cheapest Seedance with sound, at 720p. 4 to 15 seconds.',
  model: 'dreamina-seedance-2-0-mini-260615', perSec: 0.08, perSec1080: 0.08, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'draft',
};
const SEEDANCE_10_FAST: ModelOption = {
  value: 'seedance-1-0-pro-fast', label: 'Seedance 1.0 Pro Fast', vendor: 'ByteDance',
  hint: 'The cheapest video engine, with no sound. Up to 1080p, 4 to 12 seconds. Good for testing a camera move.',
  model: 'seedance-1-0-pro-fast-251015', perSec: 0.02, perSec1080: 0.048, minSeconds: 4, maxSeconds: 12, supports1080: true, tier: 'draft',
};
const WAN3_PRIME: ModelOption = {
  value: 'wan3.0-video-prime', label: 'Wan 3.0 Prime', vendor: 'Alibaba',
  hint: 'Fastest: a 4s clip in about 30s. Up to 30s with native sound. Text, first/last frame, or product references.',
  model: 'wan3.0-video-prime', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 2, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const WAN3: ModelOption = {
  value: 'wan3.0-video', label: 'Wan 3.0', vendor: 'Alibaba',
  hint: 'Same Wan 3.0 native-audio cinema engine at the lower rate. Up to 30s with sound.',
  model: 'wan3.0-video', perSec: 0.082513, perSec1080: 0.165025, minSeconds: 2, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const MINIMAX_H3_VIDEO: ModelOption = {
  value: 'minimax-h3', label: 'MiniMax H3 (2K + Audio)', vendor: 'MiniMax',
  hint: 'Native 2K cinema video with stereo sound, human micro-expressions, first/last frame, and product refs. 4 to 15s.',
  model: 'MiniMax-H3', perSec: 0.08, perSec1080: 0.13, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const MINIMAX_H3_MAX_VIDEO: ModelOption = {
  value: 'minimax-h3-max', label: 'MiniMax H3-Max', vendor: 'MiniMax',
  hint: 'Fast MiniMax cinema drafts with synchronized sound and dynamic camera motion. 4 to 15s.',
  model: 'MiniMax-H3-Max', perSec: 0.08, perSec1080: 0.08, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'draft',
};
const HH_T2V: ModelOption = {
  value: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1', vendor: 'Alibaba',
  hint: 'Physically realistic motion, weight, and cinematic detail. 3 to 15s.',
  model: 'happyhorse-1.1-t2v', perSec: 0.123769, perSec1080: 0.165026, minSeconds: 3, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const HH_I2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-i2v', model: 'happyhorse-1.1-i2v', hint: 'Animates your still with physically realistic motion. 3 to 15s.' };
const HH_R2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-r2v', model: 'happyhorse-1.1-r2v', hint: 'Keeps your exact product from the reference images. 3 to 15s.' };

const OMNI_12_FLASH: ModelOption = {
  value: 'gemini-omni-1.2-flash', label: 'Omni 1.2 Flash', vendor: 'Google',
  hint: 'Google native multimodal video engine. Natural physics, wildlife, organic motion, and camera depth. 4 to 15s.',
  model: 'gemini-omni-1.2-flash', perSec: 0.08, perSec1080: 0.08, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'hd',
};
const OMNI_11_FLASH: ModelOption = {
  value: 'gemini-omni-1.1-flash', label: 'Omni 1.1 Flash', vendor: 'Google',
  hint: 'Fast Google multimodal video drafts with smooth camera motion. 4 to 15s.',
  model: 'gemini-omni-1.1-flash', perSec: 0.06, perSec1080: 0.06, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'draft',
};

const GROK_VIDEO_15: ModelOption = {
  value: 'grok-imagine-video-1.5', label: 'Grok Imagine Video 1.5', vendor: 'xAI',
  hint: 'xAI cinema video engine. High-energy motion, dynamic camera physics, text-to-video & image-to-video. 4 to 15s.',
  model: 'grok-imagine-video-1.5', perSec: 0.14, perSec1080: 0.25, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const GROK_VIDEO_15_LITE: ModelOption = {
  value: 'grok-imagine-video-1.5-lite', label: 'Grok Imagine Video 1.5 Lite', vendor: 'xAI',
  hint: 'Fast, low-cost xAI motion drafts for rapid creative iteration. 4 to 15s.',
  model: 'grok-imagine-video-1.5-lite', perSec: 0.04, perSec1080: 0.08, minSeconds: 4, maxSeconds: 15, supports1080: false, tier: 'draft',
};

export const TEXT_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA reads your prompt, works out what it needs (shots, people speaking, sound, length, how complex it is) and assigns the right model from this list. Pick a model yourself to override. Grok only runs when you pick it.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  SEEDANCE_25, SEEDANCE_20, SEEDANCE_20_FAST, SEEDANCE_20_MINI, WAN3_PRIME, WAN3, MINIMAX_H3_VIDEO, MINIMAX_H3_MAX_VIDEO, OMNI_12_FLASH, OMNI_11_FLASH, GROK_VIDEO_15, GROK_VIDEO_15_LITE, HH_T2V, SEEDANCE_10_FAST,
];

export const IMAGE_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA reads your prompt and your image, works out what must stay identical and what should move, and assigns the right model from this list. Pick a model yourself to override. Grok only runs when you pick it.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  SEEDANCE_25, SEEDANCE_20, SEEDANCE_20_FAST, SEEDANCE_20_MINI, WAN3_PRIME, WAN3, MINIMAX_H3_VIDEO, MINIMAX_H3_MAX_VIDEO, OMNI_12_FLASH, OMNI_11_FLASH, GROK_VIDEO_15, GROK_VIDEO_15_LITE, HH_I2V, SEEDANCE_10_FAST,
];

export const REFERENCE_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA reads your prompt and assigns the model from this list that keeps your references most faithfully. Pick a model yourself to override.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  SEEDANCE_25, SEEDANCE_20, SEEDANCE_20_FAST, SEEDANCE_20_MINI, WAN3_PRIME, WAN3, MINIMAX_H3_VIDEO, HH_R2V,
];

export const MODELS_BY_SECTION: Record<CreativeSection, ModelOption[]> = {
  'text-to-image': TEXT_TO_IMAGE_MODELS,
  'image-edit': IMAGE_EDIT_MODELS,
  'upscale': UPSCALE_MODELS,
  'text-to-video': TEXT_TO_VIDEO_MODELS,
  'image-to-video': IMAGE_TO_VIDEO_MODELS,
  'reference-video': REFERENCE_VIDEO_MODELS,
};

export function modelOption(section: CreativeSection, value: string): ModelOption {
  const list = MODELS_BY_SECTION[section];
  return list.find((o) => o.value === value) || list[0];
}

export function validModelValue(section: CreativeSection, value: string): string {
  return MODELS_BY_SECTION[section].some((o) => o.value === value) ? value : 'auto';
}

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

export const DIALECT_HINTS: Record<DialectKey, string> = {
  'qwen-image': 'Prompt written for Qwen Image. The layout is spelled out and any text in the picture is quoted exactly.',
  'wan-image': 'Prompt written for Wan 2.7 Image. Rich optical lighting, physical surface texture, and camera depth.',
  'qwen-image-21': 'Prompt written for Qwen Image 2.1. It names what changes and says plainly that the rest stays the same.',
  'nano-banana': 'Prompt written for Nano Banana. One flowing paragraph, with the camera and lens named.',
  'grok-image': 'Prompt written for Grok. Short and punchy, with the subject first.',
  'minimax-image': 'Prompt written for MiniMax H3-Image. Native up-to-4K photorealism, studio lighting, and character fidelity.',
  seedream: 'Prompt written for ByteDance Seedream. Studio lighting and lens, any copy quoted exactly, and a transparent background when you ask for one.',
  'z-image': 'Prompt written for Z-Image. A plain concrete description, with any copy quoted exactly.',
  wan3: 'Prompt written for Wan 3.0. This engine makes the sound too, so describe what the scene sounds like.',
  wan: 'Prompt written for Wan 2.7. This engine makes no sound, so the prompt covers motion only.',
  happyhorse: 'Prompt written for HappyHorse. This engine makes no sound, so the prompt spends its words on weight and momentum.',
  'grok-video': 'Prompt written for Grok video. Short, high energy beats.',
  'omni-video': 'Prompt written for Omni Video. Flowing cinematic motion, camera optics, and physical realism.',
  'hailuo-h3': 'Prompt written for MiniMax H3. Native 2K cinema motion, human micro-expressions, and synchronized stereo sound.',
  seedance: 'Prompt written for ByteDance Seedance 2.5 and 2.0. Shot-by-shot camera moves and cuts, with the sound described.',
  'seedance-v1': 'Prompt written for ByteDance Seedance 1.0. This engine makes no sound, so the prompt covers motion and camera only.',
  vidu: 'Prompt written for Vidu. Numbered beats for one advertising cut.',
  none: 'Prompt written for a generic engine.',
};

export function dialectKeyFor(option: ModelOption, section: CreativeSection): DialectKey {
  const isVideo = section === 'text-to-video' || section === 'image-to-video' || section === 'reference-video';
  const m = (option.model || '').toLowerCase();
  if (isVideo) {
    if (m.includes('seedance-1')) return 'seedance-v1';
    if (m.includes('seedance')) return 'seedance';
    if (m.includes('minimax') || m.includes('hailuo')) return 'hailuo-h3';
    if (m.includes('omni') || m.includes('veo')) return 'omni-video';
    if (m.includes('vidu')) return 'vidu';
    if (/wan3\./.test(m)) return 'wan3';
    if (m.includes('happyhorse')) return 'happyhorse';
    if (m.includes('wan')) return 'wan';
    if (m.includes('grok')) return 'grok-video';
    return 'none';
  }
  if (m.includes('seedream')) return 'seedream';
  if (m.includes('minimax') || m === 'image-01') return 'minimax-image';
  if (m.includes('z-image')) return 'z-image';
  if (m.includes('qwen-image-2.1')) return 'qwen-image-21';
  if (m.includes('wan')) return 'wan-image';
  if (m.includes('qwen')) return 'qwen-image';
  if (m.includes('grok')) return 'grok-image';
  return 'nano-banana';
}

export const AUTO_DIALECT_HINT = 'AURA picks the best engine for your prompt, then writes the prompt in its exact visual dialect.';

export function dialectHintFor(option: ModelOption, section: CreativeSection): string {
  if (option.value === 'auto') return AUTO_DIALECT_HINT;
  return DIALECT_HINTS[dialectKeyFor(option, section)];
}

export function imageRequestFor(section: CreativeSection, value: string): { provider?: ProviderName; model?: string; quality?: 'standard' | 'ultra' } {
  const o = modelOption(section, value);
  if (o.value === 'auto' || !o.provider) return {};
  return { provider: o.provider, ...(o.model ? { model: o.model } : {}), ...(o.quality ? { quality: o.quality } : {}) };
}

const ALL_DURATIONS = [4, 6, 8, 10, 12, 15, 16, 20, 30];

export function durationsFor(o: ModelOption): number[] {
  const min = o.minSeconds ?? 4;
  const max = o.maxSeconds ?? 8;
  return ALL_DURATIONS.filter((d) => d >= min && d <= max);
}

export function perSecondRate(o: ModelOption, res: '720p' | '1080p'): number {
  return res === '1080p' && o.supports1080 !== false && o.perSec1080 ? o.perSec1080 : (o.perSec ?? 0);
}

export function formatRate(usd: number): string {
  const s = usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${s}`;
}

const ALL_IMAGE_SIZES: { label: string; value: '1K' | '2K' | '4K'; hint: string }[] = [
  { label: '1K', value: '1K', hint: 'Fast' },
  { label: '2K', value: '2K', hint: 'High detail' },
  { label: '4K', value: '4K', hint: 'Max quality' },
];
const SIZE_ORDER: Record<'1K' | '2K' | '4K', number> = { '1K': 0, '2K': 1, '4K': 2 };

export function sizesFor(o: ModelOption): { label: string; value: '1K' | '2K' | '4K'; hint: string }[] {
  const max = o.maxSize ?? '4K';
  return ALL_IMAGE_SIZES.filter((s) => SIZE_ORDER[s.value] <= SIZE_ORDER[max]);
}

export function exceedsMaxSize(o: ModelOption, size: '1K' | '2K' | '4K'): boolean {
  return !sizesFor(o).some((s) => s.value === size);
}
