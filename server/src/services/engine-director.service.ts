// AURA's engine director: on Auto, AURA reads the whole prompt, judges how
// complex the job is and picks the engine for it.
//
// Weni 2026-11-14: "i dont want to make grok the main in creative tool. You
// should decide as AURA based on the complexity and prompt by the user which
// models to use per task." The keyword router it replaces let ONE word decide
// (a "whip pan" inside a timed four-beat sequence sent the clip to Grok), and
// every image it did not recognise went to the most expensive engine.
//
// How it decides:
//   1. Hard limits first, in code: the mode, attached references, an end frame,
//      clip length, 1080p or 4K, and whether the provider can take a call right
//      now (key set, breaker closed). Only engines that pass are offered.
//   2. AURA's text model weighs the prompt against what each remaining engine
//      does best and costs, and returns one engine id plus a one-line reason.
//      Simple jobs go to a cheaper engine; complex ones to the strongest fit.
//   3. Anything off the list, a timeout or a provider error falls back to the
//      rule-based picker, so a generation never waits on the director.
// Grok is not offered on Auto. It stays in the manual picker and as the last
// fallback inside the provider chain.

import { aiRouter, canRoute } from './providers/ai-router.js';
import { priceFor } from '../lib/ai-pricing.js';
import { selectBestCreativeEngine, type EnhanceMode, type SmartEnginePick } from './prompt-enhancer.service.js';
import type { AiProviderName, AiTask } from './providers/types.js';

type EngineProvider = SmartEnginePick['provider'];

export interface EngineSpec {
  id: string;
  provider: EngineProvider;
  /** The name users see. */
  name: string;
  modes: EnhanceMode[];
  /** What this engine does best, in plain words, for the director. */
  bestFor: string;
  /** Video: renders a sound track. */
  sound?: boolean;
  /** Video: longest clip in seconds. */
  maxSeconds?: number;
  /** Video: can render 1080p. */
  hd?: boolean;
  /** Video: honours an end frame. */
  endFrame?: boolean;
  /** Video: honours reference images. */
  refs?: boolean;
  /** Image: can render 4K. */
  can4k?: boolean;
  /** Image: only offered when 4K is asked for. */
  only4k?: boolean;
  /** ai-pricing key the cost line is read from. */
  priceId: string;
}

const IMAGE_MODES: EnhanceMode[] = ['text-to-image', 'image-edit'];
const VIDEO_MODES: EnhanceMode[] = ['text-to-video', 'image-to-video'];

export const AUTO_ENGINES: EngineSpec[] = [
  // Stills and edits
  { id: 'qwen-image-3.0-pro', provider: 'dashscope', name: 'Qwen Image 3.0 Pro', modes: IMAGE_MODES, priceId: 'qwen-image-3.0-pro:2k',
    bestFor: 'Exact text inside the image: posters, menus, flyers, infographics, price tags. Arabic and bilingual lettering. Structured layouts.' },
  { id: 'gemini-3-pro-image', provider: 'gemini', name: 'AURA Image Pro', modes: IMAGE_MODES, can4k: true, priceId: 'gemini-3-pro-image',
    bestFor: 'The strongest all-rounder and the most expensive. Crowded or multi-subject scenes, campaign key visuals, carousel slides with exact typography and hex colours, edits that must keep a face, logo or product identical.' },
  { id: 'gemini-nano-banana-2.1', provider: 'gemini', name: 'AURA Image', modes: IMAGE_MODES, can4k: true, priceId: 'gemini-nano-banana-2.1',
    bestFor: 'Quick, good-looking general images and simple edits: one clear subject, a plain scene, no exact text to render.' },
  { id: 'dola-seedream-5-5-261028', provider: 'byteplus', name: 'Seedream 5.5', modes: IMAGE_MODES, priceId: 'dola-seedream-5-5-261028:2k',
    bestFor: 'Transparent backgrounds (stickers, cutouts, isolated products, icons). Clean product stills and graphic illustration. Edits that blend up to 10 images.' },
  { id: 'wan2.7-image-pro', provider: 'dashscope', name: 'Wan 2.7 Image Pro', modes: ['text-to-image'], priceId: 'wan2.7-image-pro:2k',
    bestFor: 'Photoreal luxury product close-ups: perfume, cosmetics, watches, jewellery, food and material texture, macro detail.' },
  { id: 'MiniMax-H3-Image', provider: 'minimax', name: 'MiniMax H3-Image', modes: ['text-to-image'], priceId: 'MiniMax-H3-Image',
    bestFor: 'Portraits and people: faces, skin, fashion, beauty and lifestyle shots with a person as the subject.' },
  { id: 'seedream-5-0-260128', provider: 'byteplus', name: 'Seedream 5.0 (4K)', modes: ['text-to-image'], can4k: true, only4k: true, priceId: 'seedream-5-0-260128',
    bestFor: 'Stills that must come out at 4K.' },

  // Video
  { id: 'wan3.0-video-prime', provider: 'dashscope', name: 'Wan 3.0 Prime', modes: VIDEO_MODES, sound: true, maxSeconds: 30, hd: true, endFrame: true, refs: true, priceId: 'wan3.0-video-prime',
    bestFor: 'The default for single-shot clips with sound. Keeps an attached product, start frame, end frame or up to 10 reference images consistent. Up to 30 seconds.' },
  { id: 'dreamina-seedance-2-5-260628', provider: 'byteplus', name: 'Seedance 2.5', modes: VIDEO_MODES, sound: true, maxSeconds: 30, hd: true, endFrame: true, refs: true, priceId: 'dreamina-seedance-2-5-260628',
    bestFor: 'Multi-shot sequences: timed beats like [00:00] [00:03], storyboards, several cuts or scenes in one clip, with sound. The priciest per second, so only when the clip really has several shots or needs up to 30 seconds of cuts.' },
  { id: 'dreamina-seedance-2-0-260128', provider: 'byteplus', name: 'Seedance 2.0', modes: VIDEO_MODES, sound: true, maxSeconds: 15, hd: true, endFrame: true, refs: true, priceId: 'dreamina-seedance-2-0-260128',
    bestFor: 'Short clips with two or three cuts, with sound, up to 15 seconds. Cheaper than Seedance 2.5.' },
  { id: 'dreamina-seedance-2-0-mini-260615', provider: 'byteplus', name: 'Seedance 2.0 Mini', modes: VIDEO_MODES, sound: true, maxSeconds: 15, hd: false, priceId: 'dreamina-seedance-2-0-mini-260615',
    bestFor: 'Simple single-shot clips with sound at 720p, up to 15 seconds. The cheapest engine with sound.' },
  { id: 'MiniMax-H3', provider: 'minimax', name: 'MiniMax H3', modes: VIDEO_MODES, sound: true, maxSeconds: 15, hd: true, priceId: 'MiniMax-H3',
    bestFor: 'People talking or acting on camera: dialogue, lip-sync, facial expressions, presenters.' },
  { id: 'gemini-omni-1.2-flash', provider: 'gemini', name: 'AURA Omni 1.2 Flash', modes: ['text-to-video'], sound: false, maxSeconds: 15, hd: false, priceId: 'gemini-omni-1.2-flash',
    bestFor: 'Animals, nature and organic motion when no sound is needed. No sound track.' },
];

export interface DirectEngineInput {
  mode: EnhanceMode;
  prompt: string;
  hasRefs?: boolean;
  hasEndFrame?: boolean;
  /** Requested clip length (video). */
  durationSeconds?: number;
  /** Requested video resolution. */
  resolution?: string;
  /** Requested still size. */
  imageSize?: '1K' | '2K' | '4K';
  /** The user asked for a quick draft. */
  fast?: boolean;
  /** The user asked for the best quality. */
  quality?: 'standard' | 'ultra';
  orgId?: string;
  userId?: string;
  clientId?: string;
  signal?: AbortSignal;
}

export interface EnginePick extends SmartEnginePick {
  /** The engine name users see. */
  name: string;
  complexity?: 'simple' | 'standard' | 'complex';
  /** aura = the director chose; rules = fallback picker; only = one engine fitted the limits. */
  decidedBy: 'aura' | 'rules' | 'only';
}

function taskFor(mode: EnhanceMode): AiTask {
  return mode === 'image-edit' ? 'image_edit' : mode === 'text-to-image' ? 'image' : 'video';
}

/** Engines that satisfy the job's hard limits and can take a call right now. */
export function candidatesFor(input: DirectEngineInput, available: (p: AiProviderName, t: AiTask) => boolean = canRoute): EngineSpec[] {
  const video = VIDEO_MODES.includes(input.mode);
  const want4k = !video && input.imageSize === '4K';
  return AUTO_ENGINES.filter((e) => {
    if (!e.modes.includes(input.mode)) return false;
    if (!available(e.provider, taskFor(input.mode))) return false;
    if (video) {
      if (input.hasRefs && !e.refs) return false;
      if (input.hasEndFrame && !e.endFrame) return false;
      if ((input.durationSeconds || 0) > (e.maxSeconds || 0)) return false;
      if (input.resolution === '1080p' && !e.hd) return false;
    } else {
      if (want4k && !e.can4k) return false;
      if (!want4k && e.only4k) return false;
    }
    return true;
  });
}

function costLine(e: EngineSpec): string {
  const p = priceFor(e.priceId) as { perCall?: number; perSecond?: number } | undefined;
  if (p?.perSecond) return `$${p.perSecond.toFixed(3)} per second`;
  if (p?.perCall) return `$${p.perCall.toFixed(3)} per image`;
  return 'price not listed';
}

const DIRECTOR_SYSTEM = `You are AURA, the creative director of AURAAI. A user left the engine picker on Auto. Choose the ONE engine that will do this job best, judged against what it costs.

How to decide:
1. Read the whole prompt, not single words. Judge its complexity:
   - simple: one subject, a plain scene, no exact text, one shot.
   - standard: a styled scene, a product with some detail, or one camera move.
   - complex: several subjects or shots, exact words that must appear in the image, a brand layout, people speaking, or a product that must stay identical.
2. Match the job to what each engine does best (the list below). A specific need decides first: exact in-image text or Arabic lettering, a transparent background, people speaking on camera, timed beats or several shots.
3. Then weigh cost: for a simple job pick a cheaper engine that does it well; pay for the strongest engine only when the job needs what it does best.
4. Only choose from the list. Every engine on it can run this job right now.

Reply with JSON only: {"engine": "<id from the list>", "complexity": "simple" | "standard" | "complex", "reason": "<one plain sentence, at most 16 words>"}
The reason names what in THIS prompt decided (for example "four timed shots with sound", "Arabic text on a menu", "one subject and no text, so the cheaper engine"). Do not start it with the engine name, do not praise the engine, no dashes.`;

function buildUserMessage(input: DirectEngineInput, candidates: EngineSpec[]): string {
  const video = VIDEO_MODES.includes(input.mode);
  const facts: string[] = [`Task: ${input.mode}`];
  if (input.hasRefs) facts.push('The user attached reference images that must stay consistent.');
  if (input.hasEndFrame) facts.push('The user attached an end frame.');
  if (input.mode === 'image-to-video') facts.push('The clip starts from an image the user attached.');
  if (input.mode === 'image-edit') facts.push('This edits an existing image the user attached.');
  if (video && input.durationSeconds) facts.push(`Clip length: ${input.durationSeconds} seconds.`);
  if (video && input.resolution) facts.push(`Resolution: ${input.resolution}.`);
  if (!video && input.imageSize) facts.push(`Image size: ${input.imageSize}.`);
  if (input.fast) facts.push('The user asked for a quick, cheap draft: prefer the fastest cheap engine that still fits.');
  if (input.quality === 'ultra') facts.push('The user asked for the best quality: cost matters less.');
  const list = candidates.map((e) => {
    const bits = [`id: ${e.id}`, `name: ${e.name}`, `cost: ${costLine(e)}`];
    if (video) bits.push(e.sound ? 'sound: yes' : 'sound: no', `max: ${e.maxSeconds}s`);
    return `- ${bits.join(' | ')}\n  best for: ${e.bestFor}`;
  }).join('\n');
  return `${facts.join('\n')}\n\nEngines you can choose from:\n${list}\n\nUser prompt:\n"""\n${input.prompt.slice(0, 4000)}\n"""`;
}

// Same prompt and limits within 15 minutes get the same engine (a regenerate
// should not flip engines, and it saves the director call).
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; pick: EnginePick }>();

function cacheKey(input: DirectEngineInput, candidates: EngineSpec[]): string {
  return [input.mode, input.hasRefs ? 1 : 0, input.hasEndFrame ? 1 : 0, input.durationSeconds || '', input.resolution || '',
    input.imageSize || '', input.fast ? 1 : 0, input.quality || '', candidates.map((c) => c.id).join(','), input.prompt.trim()].join('|');
}

export function clearEngineDirectorCache(): void { cache.clear(); }

function specFor(id: string): EngineSpec | undefined {
  return AUTO_ENGINES.find((e) => e.id === id);
}

/** The rule-based picker, held to the same limits as the director. */
function rulesPick(input: DirectEngineInput, candidates: EngineSpec[]): EnginePick {
  const r = selectBestCreativeEngine(input.mode, input.prompt, {
    fast: input.fast, hasRefs: input.hasRefs, hasEndFrame: input.hasEndFrame, quality: input.quality,
  });
  const fits = candidates.find((c) => c.id === r.model);
  if (fits || candidates.length === 0) {
    return { ...r, name: fits?.name || specFor(r.model)?.name || r.model, decidedBy: 'rules' };
  }
  const first = candidates[0];
  return { provider: first.provider, model: first.id, name: first.name, reason: `${first.name} fits the length, size and references you asked for.`, decidedBy: 'rules' };
}

/** Shown after "AURA picked <name>:", so a reason that opens with the name drops it. */
function withoutLeadingName(reason: string, name: string): string {
  if (!reason.toLowerCase().startsWith(name.toLowerCase())) return reason;
  const rest = reason.slice(name.length).replace(/^[\s,:]*(is|was|fits|suits|handles|excels at|specializes in)?\s*/i, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : reason;
}

function cleanReason(s: unknown): string {
  return String(s || '').replace(/[‒-―]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * AURA picks the engine for an Auto job. Never throws: when the director is
 * unavailable it falls back to the rule-based picker within the same limits.
 */
export async function directEngine(input: DirectEngineInput): Promise<EnginePick> {
  const candidates = candidatesFor(input);
  if (candidates.length === 0) return rulesPick(input, candidates);
  if (candidates.length === 1) {
    const only = candidates[0];
    return { provider: only.provider, model: only.id, name: only.name, reason: `${only.name} is the one engine that fits what you asked for.`, decidedBy: 'only' };
  }

  const key = cacheKey(input, candidates);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pick;

  try {
    const result = await aiRouter.text(
      {
        system: DIRECTOR_SYSTEM,
        prompt: buildUserMessage(input, candidates),
        json: true,
        temperature: 0.1,
        // The text model reasons before it answers; a small budget truncates it.
        maxTokens: 2048,
        // Hydrogen: the same picks as Carbon in live tests, about 4s instead of 9s (2026-11-14).
        model: process.env.ENGINE_DIRECTOR_MODEL || 'gemini-4-hydrogen',
        timeoutMs: Number(process.env.ENGINE_DIRECTOR_TIMEOUT_MS) || 15000,
        signal: input.signal,
      },
      {
        orgId: input.orgId,
        userId: input.userId,
        clientId: input.clientId,
        skipBrandKit: true,
        skipKnowledge: true,
        preferredProvider: (process.env.PROMPT_ENHANCER_PROVIDER as AiProviderName | undefined) || 'gemini',
      },
    );
    const out = (typeof result.output === 'string' ? JSON.parse(result.output) : result.output) as { engine?: string; complexity?: string; reason?: string };
    const chosen = candidates.find((c) => c.id === String(out?.engine || '').trim());
    if (!chosen) return rulesPick(input, candidates);
    const complexity = (['simple', 'standard', 'complex'] as const).find((c) => c === out?.complexity);
    const pick: EnginePick = {
      provider: chosen.provider,
      model: chosen.id,
      name: chosen.name,
      reason: withoutLeadingName(cleanReason(out?.reason), chosen.name) || 'It fits this prompt best.',
      ...(complexity ? { complexity } : {}),
      decidedBy: 'aura',
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), pick });
    return pick;
  } catch (e) {
    if (input.signal?.aborted) throw e;
    console.warn(`[engine-director] fell back to rules: ${String((e as Error)?.message || e).slice(0, 160)}`);
    return rulesPick(input, candidates);
  }
}
