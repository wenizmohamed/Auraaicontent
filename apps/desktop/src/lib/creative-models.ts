// Creative Studio model catalog: one list per task section, each starting with
// "Auto" (AURA routes the call: the primary engine first, the rest of the
// server chain on standby). Explicit picks pin one engine; the server still
// falls through its chain if that engine fails.
//
// Keep in step with:
//   server/src/services/providers/ai-router.ts  (chain order per task)
//   server/src/services/providers/dashscope.provider.ts (Alibaba model ids)
//   server/src/lib/ai-pricing.ts (every rate quoted here)
// Verified live against the Alibaba Token Plan key on 2026-10-17.

export type CreativeSection =
  | 'text-to-image'
  | 'image-edit'
  | 'upscale'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-video';

export type Vendor = 'Alibaba' | 'Google' | 'xAI';
export type ProviderName = 'gemini' | 'xai' | 'dashscope';

export interface ModelOption {
  /** Picker id. 'auto' = AURA decides. */
  value: string;
  label: string;
  vendor?: Vendor;
  /** One line, plain words, shown under the label. */
  hint: string;
  /** Request pieces sent to the server. Images: provider (+ model for Alibaba ids,
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
  /** Video cost tier label carried for accounting. */
  tier?: 'draft' | 'hd';
}

// ─── Images ─────────────────────────────────────────────────────

const QWEN_IMAGE: ModelOption = {
  value: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', vendor: 'Alibaba',
  hint: 'Sharp product and lifestyle stills, strong text rendering. Edits too.',
  provider: 'dashscope', model: 'qwen-image-3.0-pro', perImage: 0.05,
};
const WAN_IMAGE_PRO: ModelOption = {
  value: 'wan2.7-image-pro', label: 'Wan 2.7 Image Pro', vendor: 'Alibaba',
  hint: 'Cinematic lighting and texture. Good for hero shots.',
  provider: 'dashscope', model: 'wan2.7-image-pro', perImage: 0.05,
};
const WAN_IMAGE_FAST: ModelOption = {
  value: 'wan2.7-image', label: 'Wan 2.7 Image', vendor: 'Alibaba',
  hint: 'Fast drafts at half the Pro price.',
  provider: 'dashscope', model: 'wan2.7-image', perImage: 0.025,
};
const GEMINI_IMAGE: ModelOption = {
  value: 'gemini-flash-image', label: 'Gemini 3.1 Flash Image', vendor: 'Google',
  hint: 'Nano Banana. Native 1K to 4K output, every aspect ratio, precise edits.',
  provider: 'gemini', perImage: 0.10,
};
const GEMINI_IMAGE_ULTRA: ModelOption = {
  value: 'gemini-pro-image', label: 'Gemini 3 Pro Image', vendor: 'Google',
  hint: 'Top Google tier for print and 4K campaign art.',
  provider: 'gemini', quality: 'ultra', perImage: 0.14,
};
const GROK_IMAGE: ModelOption = {
  value: 'grok-imagine-image-2.0', label: 'Grok Imagine 2.0', vendor: 'xAI',
  hint: 'Quick, punchy social visuals.',
  provider: 'xai', perImage: 0.04,
};

export const TEXT_TO_IMAGE_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks per prompt: Qwen Image 3.0 Pro first, Gemini and Grok on standby.', perImage: 0.05 },
  QWEN_IMAGE, WAN_IMAGE_PRO, WAN_IMAGE_FAST, GEMINI_IMAGE, GEMINI_IMAGE_ULTRA, GROK_IMAGE,
];

// Edits need an engine that takes the source frame: Qwen Image (unified
// generate + edit) and Nano Banana. Grok's edit endpoint is not enabled.
export const IMAGE_EDIT_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Qwen Image 3.0 Pro first, Gemini Nano Banana on standby.', perImage: 0.05 },
  QWEN_IMAGE, GEMINI_IMAGE,
];

// AI-detail pass in Upscale mode regenerates through one of these before scaling.
export const UPSCALE_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks the detail engine: Qwen Image 3.0 Pro first.', perImage: 0.05 },
  QWEN_IMAGE, WAN_IMAGE_PRO, GEMINI_IMAGE, GROK_IMAGE,
];

// ─── Video ──────────────────────────────────────────────────────

const WAN3: ModelOption = {
  value: 'wan3.0-video', label: 'Wan 3.0', vendor: 'Alibaba',
  hint: 'Up to 30s with sound. Text, first frame, first and last frame, or product references.',
  model: 'wan3.0-video', perSec: 0.10, perSec1080: 0.20, minSeconds: 2, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const HH_T2V: ModelOption = {
  value: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1', vendor: 'Alibaba',
  hint: 'Physically realistic motion, cinematic detail. 3 to 15s.',
  model: 'happyhorse-1.1-t2v', perSec: 0.14, perSec1080: 0.18, minSeconds: 3, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const HH_I2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-i2v', model: 'happyhorse-1.1-i2v', hint: 'Animates your still with realistic motion. 3 to 15s.' };
const HH_R2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-r2v', model: 'happyhorse-1.1-r2v', hint: 'Keeps your exact product from the reference images. 3 to 15s.' };
const WAN27_T2V: ModelOption = {
  value: 'wan2.7-t2v', label: 'Wan 2.7', vendor: 'Alibaba',
  hint: 'Previous Wan generation. 3 to 10s, 720p.',
  model: 'wan2.7-t2v', perSec: 0.10, minSeconds: 3, maxSeconds: 10, tier: 'draft',
};
const WAN27_I2V: ModelOption = { ...WAN27_T2V, value: 'wan2.7-i2v', model: 'wan2.7-i2v', hint: 'Previous Wan generation, first-frame animation. 3 to 10s.' };
const WAN27_R2V: ModelOption = { ...WAN27_T2V, value: 'wan2.7-r2v', model: 'wan2.7-r2v', hint: 'Previous Wan generation, multi-reference. 3 to 10s.' };
const VEO: ModelOption = {
  value: 'veo-3.1-generate-preview', label: 'Veo 3.1', vendor: 'Google',
  hint: 'Google flagship. 4, 6 or 8s; 1080p needs an 8s clip; start and end frames.',
  model: 'veo-3.1-generate-preview', perSec: 0.20, perSec1080: 0.20, minSeconds: 4, maxSeconds: 8, supports1080: true, tier: 'hd',
};
const VEO_REF: ModelOption = { ...VEO, hint: 'Google flagship with product references. Always an 8s clip.', minSeconds: 8, maxSeconds: 8 };
const OMNI: ModelOption = {
  value: 'gemini-omni-flash-preview', label: 'Omni Flash', vendor: 'Google',
  hint: 'Fast, strong character consistency. 2 to 12s.',
  model: 'gemini-omni-flash-preview', perSec: 0.10, minSeconds: 2, maxSeconds: 12, tier: 'draft',
};
const GROK_VIDEO: ModelOption = {
  value: 'grok-imagine-video-1.5', label: 'Grok Imagine 1.5', vendor: 'xAI',
  hint: 'Quickest turnaround. Up to 8s, 720p or 1080p.',
  model: 'grok-imagine-video-1.5', perSec: 0.14, perSec1080: 0.25, minSeconds: 4, maxSeconds: 8, supports1080: true, tier: 'draft',
};

export const TEXT_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks per prompt: Wan 3.0 first, Veo and Grok on standby.', perSec: 0.10, perSec1080: 0.20, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3, HH_T2V, WAN27_T2V, VEO, OMNI, GROK_VIDEO,
];

export const IMAGE_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Wan 3.0 animates your frame first, Veo on standby.', perSec: 0.10, perSec1080: 0.20, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3, HH_I2V, WAN27_I2V, VEO, OMNI, GROK_VIDEO,
];

// Offered when product reference images are attached: every engine here keeps
// the exact subject consistent.
export const REFERENCE_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Wan 3.0 reference mode first, Veo on standby.', perSec: 0.10, perSec1080: 0.20, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3, HH_R2V, WAN27_R2V, VEO_REF,
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

/** A stored pick that is not offered in this section falls back to Auto. */
export function validModelValue(section: CreativeSection, value: string): string {
  return MODELS_BY_SECTION[section].some((o) => o.value === value) ? value : 'auto';
}

/** Request pieces for an image call. Auto sends nothing (server primary + chain). */
export function imageRequestFor(section: CreativeSection, value: string): { provider?: ProviderName; model?: string; quality?: 'standard' | 'ultra' } {
  const o = modelOption(section, value);
  if (o.value === 'auto' || !o.provider) return {};
  return { provider: o.provider, ...(o.model ? { model: o.model } : {}), ...(o.quality ? { quality: o.quality } : {}) };
}

const ALL_DURATIONS = [4, 6, 8, 10, 15, 20, 30];
/** Clip lengths the engine accepts (Auto follows its primary, capped at 15s so
 *  a standby engine can still serve the clip). */
export function durationsFor(o: ModelOption): number[] {
  const min = o.minSeconds ?? 4;
  const max = o.maxSeconds ?? 8;
  return ALL_DURATIONS.filter((d) => d >= min && d <= max);
}

export function perSecondRate(o: ModelOption, res: '720p' | '1080p'): number {
  return res === '1080p' && o.perSec1080 ? o.perSec1080 : (o.perSec ?? 0);
}
