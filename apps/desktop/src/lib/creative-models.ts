// Creative Studio model catalog: one list per task section, each starting with
// "Auto" (AURA routes the call: the primary engine first, the rest of the
// server chain on standby). Explicit picks pin one engine; the server still
// falls through its chain if that engine fails.
//
// Keep in step with:
//   server/src/services/providers/ai-router.ts  (chain order per task)
//   server/src/services/providers/dashscope.provider.ts (Alibaba model ids)
//   server/src/lib/ai-pricing.ts (every rate quoted here)
// Re-verified live 2026-11-07 against the LIVE Alibaba workspaces (EU for
// text+image, Tokyo for video) and the Google Vertex AI project. Every rate
// below is the number the workspace catalog publishes, and every engine listed
// here was probed with a real generation call — an engine that 403s or 404s is
// a broken promise, so it is not offered.
//
// Engines removed on 2026-11-07 because they exist on NO live workspace:
//   wan2.7-image, wan2.7-image-pro, wan2.6-image, wan2.6-t2i, z-image-turbo,
//   the whole Vidu family, wan2.6-i2v-flash, gemini-omni-flash-preview
//   (no live Google video engine at all) and both xAI engines (the account
//   has no credits).
// The server chain still keeps those ids as a standby so they come back on
// their own when the workspace entitlement returns.

export type CreativeSection =
  | 'text-to-image'
  | 'image-edit'
  | 'upscale'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-video';

export type Vendor = 'Alibaba' | 'Google' | 'xAI';
// 'vertex' = Google Vertex AI / Agent Platform (added 2026-11-07). It serves
// the same gemini-nano-banana / gemini-3-pro-image models as the Developer
// API, but on a funded entitlement, so it is what the Google entries pin.
export type ProviderName = 'gemini' | 'xai' | 'dashscope' | 'vertex';

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
  /** Largest still size this engine actually renders. Alibaba's image models
   *  top out at 2K (the catalog only publishes a 1K and a 2K price tier), so
   *  offering them a 4K button is a promise the engine cannot keep. */
  maxSize?: '1K' | '2K' | '4K';
  /** Video cost tier label carried for accounting. */
  tier?: 'draft' | 'hd';
}

/**
 * Image engines whose price changes with the output tier. Alibaba bills
 * qwen-image-3.0-pro per image and the 2K tier costs more than 1K. Google
 * prices every nano-banana model per image too, and the rate climbs with
 * resolution. So the label has to follow the resolution the user picked.
 * The server prices the same tiers (see server/src/lib/ai-pricing.ts).
 *
 * Keyed by model id OR by picker value, because the Gemini entries do not
 * pin a model id: the server ladder picks the newest nano-banana, and the
 * price shown must be the one that engine actually bills.
 */
const TIERED_IMAGE_RATES: Record<string, { '1K': number; '2K': number; '4K': number }> = {
  // Alibaba EU catalog, read live 2026-11-07:
  //   qwen-image-3.0-pro -> 1K $0.03438, 2K $0.068761
  //   qwen-image-3.0    -> $0.024754 at BOTH tiers (so big frames cost no more)
  'qwen-image-3.0-pro': { '1K': 0.03438, '2K': 0.068761, '4K': 0.068761 },
  'qwen-image-3.0': { '1K': 0.024754, '2K': 0.024754, '4K': 0.024754 },
  // Auto runs qwen-image-3.0-pro first in every image section, so it quotes
  // that engine's table.
  'auto': { '1K': 0.03438, '2K': 0.068761, '4K': 0.068761 },
  // Google bills image output by TOKENS, so these per-resolution numbers are
  // the picker's own table (the meter's perCall is the 1K fallback).
  'gemini-nano-banana-2.1': { '1K': 0.034, '2K': 0.050, '4K': 0.113 },
  'gemini-3-pro-image': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
};

/** The tier table for an engine, if its rate depends on the resolution. */
function tierFor(o: ModelOption): { '1K': number; '2K': number; '4K': number } | undefined {
  return (o.model && TIERED_IMAGE_RATES[o.model]) || TIERED_IMAGE_RATES[o.value];
}

/** True when this engine's rate depends on the output resolution. */
export function isTieredImage(o: ModelOption): boolean {
  return !!tierFor(o);
}

/** The rate for one engine at the picked resolution. */
export function effectivePerImage(o: ModelOption, imageSize?: '1K' | '2K' | '4K'): number | undefined {
  const tiered = tierFor(o);
  if (tiered) return tiered[imageSize ?? '2K'];
  return o.perImage;
}

// ─── Images ─────────────────────────────────────────────────────

const QWEN_IMAGE: ModelOption = {
  value: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', vendor: 'Alibaba',
  hint: 'Sharp product and lifestyle stills, strong text rendering. Edits too.',
  provider: 'dashscope', model: 'qwen-image-3.0-pro', perImage: 0.03438, maxSize: '2K',
};
// Google entries pin Vertex AI, not the Developer API. The Developer API key
// is billing-dead (402 "prepayment credits are depleted" on every model), but
// the Vertex entitlement on the same Google Cloud project is funded and
// serves both image models. The server still keeps the Developer-API route as
// a standby so the lane recovers by itself when the credits return.
const GEMINI_IMAGE: ModelOption = {
  value: 'gemini-flash-image', label: 'Gemini Nano Banana 2.1', vendor: 'Google',
  hint: 'Newest Google image model. Native 1K to 4K output, every aspect ratio, precise edits.',
  provider: 'vertex', model: 'gemini-nano-banana-2.1',
};
const GEMINI_IMAGE_ULTRA: ModelOption = {
  value: 'gemini-pro-image', label: 'Gemini 3 Pro Image', vendor: 'Google',
  hint: 'Top Google tier for print and 4K campaign art.',
  provider: 'vertex', model: 'gemini-3-pro-image', quality: 'ultra',
};
// Alibaba engines from the live EU catalog, probed 2026-11-07.
const QWEN_IMAGE_21_PRO: ModelOption = {
  value: 'qwen-image-2.1-pro', label: 'Qwen Image 2.1 Pro', vendor: 'Alibaba',
  hint: 'One flat rate at every size. Handles edits as well as new images.',
  provider: 'dashscope', model: 'qwen-image-2.1-pro', perImage: 0.035333, maxSize: '2K',
};
const QWEN_IMAGE_21_TURBO: ModelOption = {
  value: 'qwen-image-2.1-turbo', label: 'Qwen Image 2.1 Turbo', vendor: 'Alibaba',
  hint: 'Cheapest engine that still edits. Renders in about four seconds.',
  provider: 'dashscope', model: 'qwen-image-2.1-turbo', perImage: 0.014133, maxSize: '2K',
};
const QWEN_IMAGE_30: ModelOption = {
  value: 'qwen-image-3.0', label: 'Qwen Image 3.0', vendor: 'Alibaba',
  hint: 'Same price at 1K and 2K, so big frames cost no more.',
  provider: 'dashscope', model: 'qwen-image-3.0', perImage: 0.024754, maxSize: '2K',
};

export const TEXT_TO_IMAGE_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks per prompt: Qwen Image 3.0 Pro first, Gemini Nano Banana on standby.' },
  QWEN_IMAGE, QWEN_IMAGE_30, QWEN_IMAGE_21_PRO, QWEN_IMAGE_21_TURBO,
  GEMINI_IMAGE, GEMINI_IMAGE_ULTRA,
];

// Edits need an engine that takes the source frame: Qwen Image (unified
// generate + edit) and Nano Banana. Both were probed with a real edit call on
// the EU workspace and on Vertex on 2026-11-07.
export const IMAGE_EDIT_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Qwen Image 3.0 Pro first, Gemini Nano Banana on standby.' },
  QWEN_IMAGE, QWEN_IMAGE_21_PRO, QWEN_IMAGE_21_TURBO, GEMINI_IMAGE,
];

// AI-detail pass in Upscale mode regenerates through one of these before scaling.
export const UPSCALE_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks the detail engine: Qwen Image 3.0 Pro first.' },
  QWEN_IMAGE, QWEN_IMAGE_30, QWEN_IMAGE_21_PRO, GEMINI_IMAGE, GEMINI_IMAGE_ULTRA,
];

// ─── Video ──────────────────────────────────────────────────────

// Video rates below are the Alibaba TOKYO catalog, read live 2026-11-07, and
// every one of these engines was submitted and confirmed SUCCEEDED on that
// workspace. The EU and Tokyo catalogs agree on every rate they share.
const WAN3_PRIME: ModelOption = {
  value: 'wan3.0-video-prime', label: 'Wan 3.0 Prime', vendor: 'Alibaba',
  hint: 'Fastest: a 4s clip in about 30s. Up to 30s with sound. Text, first frame, first and last frame, or product references.',
  model: 'wan3.0-video-prime', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 2, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const WAN3: ModelOption = {
  value: 'wan3.0-video', label: 'Wan 3.0', vendor: 'Alibaba',
  hint: 'Same engine at the lower rate, about twice the wait. Up to 30s with sound.',
  model: 'wan3.0-video', perSec: 0.082513, perSec1080: 0.165025, minSeconds: 2, maxSeconds: 30, supports1080: true, tier: 'hd',
};
const HH_T2V: ModelOption = {
  value: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1', vendor: 'Alibaba',
  hint: 'Physically realistic motion, cinematic detail. 3 to 15s.',
  model: 'happyhorse-1.1-t2v', perSec: 0.123769, perSec1080: 0.165026, minSeconds: 3, maxSeconds: 15, supports1080: true, tier: 'hd',
};
const HH_I2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-i2v', model: 'happyhorse-1.1-i2v', hint: 'Animates your still with realistic motion. 3 to 15s.' };
const HH_R2V: ModelOption = { ...HH_T2V, value: 'happyhorse-1.1-r2v', model: 'happyhorse-1.1-r2v', hint: 'Keeps your exact product from the reference images. 3 to 15s.' };
const WAN27_T2V: ModelOption = {
  value: 'wan2.7-t2v', label: 'Wan 2.7', vendor: 'Alibaba',
  hint: 'Previous Wan generation. 3 to 10s, 720p.',
  model: 'wan2.7-t2v', perSec: 0.086012, minSeconds: 3, maxSeconds: 10, tier: 'draft',
};
const WAN27_I2V: ModelOption = { ...WAN27_T2V, value: 'wan2.7-i2v', model: 'wan2.7-i2v', hint: 'Previous Wan generation, first-frame animation. 3 to 10s.' };
const WAN27_R2V: ModelOption = { ...WAN27_T2V, value: 'wan2.7-r2v', model: 'wan2.7-r2v', hint: 'Previous Wan generation, multi-reference. 3 to 10s.' };

export const TEXT_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks per prompt: Wan 3.0 Prime first, then Wan 3.0 and HappyHorse.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3_PRIME, WAN3, HH_T2V, WAN27_T2V,
];

export const IMAGE_TO_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Wan 3.0 Prime animates your frame first, then Wan 3.0 and HappyHorse.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3_PRIME, WAN3, HH_I2V, WAN27_I2V,
];

// Offered when product reference images are attached: every engine here keeps
// the exact subject consistent.
export const REFERENCE_VIDEO_MODELS: ModelOption[] = [
  { value: 'auto', label: 'Auto', hint: 'AURA picks: Wan 3.0 Prime reference mode first, then HappyHorse and Wan 2.7.', perSec: 0.127199, perSec1080: 0.254399, minSeconds: 4, maxSeconds: 15, supports1080: true, tier: 'hd' },
  WAN3_PRIME, WAN3, HH_R2V, WAN27_R2V,
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

/** Clip lengths the UI offers. 16 is here because the Vidu Q3 ad engine is
 * built for a 16-second ad cut — offering only 15 would make the engine's
 * headline promise unreachable from the picker. */
const ALL_DURATIONS = [4, 6, 8, 10, 12, 15, 16, 20, 30];
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

/** Format a rate for the picker label. Six decimals, trailing zeros
 *  trimmed: the rates in the catalog span $0.254399/s down to $0.0006/img,
 *  and a two-decimal format rounded them to $0.25 and $0.00 — a 2%
 *  overstatement on one and a 100% understatement on the other. Four
 *  decimals was not enough either: the Alibaba video rates carry six
 *  significant decimals ($0.127199/s) and truncating them made the label
 *  disagree with what the meter charges. The meter charges the exact
 *  number, so the label has to show the exact number too, with just the
 *  trailing zeros removed. */
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

/**
 * The still sizes an engine actually renders.
 *
 * Alibaba's image models publish only a 1K and a 2K price tier, so a 4K
 * button on them is a promise the engine cannot keep — the provider clamps
 * the long edge to 2048px and returns a 2K picture. Offering 4K anyway made
 * the app charge a 4K rate for a 2K render. Auto keeps 4K because Google is
 * on standby and genuinely renders 4K.
 */
export function sizesFor(o: ModelOption): { label: string; value: '1K' | '2K' | '4K'; hint: string }[] {
  const max = o.maxSize ?? '4K';
  return ALL_IMAGE_SIZES.filter((s) => SIZE_ORDER[s.value] <= SIZE_ORDER[max]);
}

/** True when the picked engine cannot render the requested size. */
export function exceedsMaxSize(o: ModelOption, size: '1K' | '2K' | '4K'): boolean {
  return !sizesFor(o).some((s) => s.value === size);
}
