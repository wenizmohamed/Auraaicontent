// AURA is the brain. On Auto it takes the user's prompt, understands it,
// digests it into a short brief, and assigns the right model from EVERY model
// the user could pick for that feature (Creative Studio's own catalog). The
// user can still pick a model by hand; then AURA does not choose.
//
// Weni 2026-11-14: "AURA is the brain ... whatever the user gives as prompt,
// AURA takes it in, understands, digests and assigns the right model based on
// the user prompt, but the user can also choose the model himself."
//
// How a decision is made:
//   1. Hard limits, in code: only models offered for this feature (references
//      switch to the reference-video list), that render the clip length,
//      1080p, end frame or 4K asked for, and whose provider can take a call
//      right now (key set, breaker closed).
//   2. AURA reads the prompt, writes a brief (subject, text in the image,
//      shots, people speaking, sound, what must stay identical, complexity)
//      and picks the model that fits that brief best for its price, with a
//      one-line reason.
//   3. An answer off the list, a timeout or an error falls back to the rule
//      picker inside the same limits, so a generation never waits on AURA.
// Grok is the one exception: Weni does not want Grok as the main engine, and
// left on the list AURA kept choosing it for action shots. Grok stays in the
// manual picker (and as the last fallback in the provider chain), not on Auto.

import { aiRouter, canRoute } from './providers/ai-router.js';
import { CREATIVE_CATALOG, type CatalogModel, type CatalogSection } from './creative-catalog.generated.js';
import { engineForModel, selectBestCreativeEngine, type EnhanceMode, type SmartEnginePick } from './prompt-enhancer.service.js';
import type { AiProviderName, AiTask } from './providers/types.js';

type EngineProvider = SmartEnginePick['provider'];

// A capability the picker's data does not spell out: which video engines
// honour an end frame (Wan 3.0 all-in-one and the Seedance 2.x family).
const END_FRAME_MODELS = /^(wan3\.0-video|dreamina-seedance-2-)/i;

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

/** One model AURA may assign, resolved from the catalog. */
export interface EngineCandidate {
  id: string;
  provider: EngineProvider;
  name: string;
  vendor?: string;
  hint: string;
  entry: CatalogModel;
}

export interface EnginePick extends SmartEnginePick {
  /** The model name users see (the picker label). */
  name: string;
  complexity?: 'simple' | 'standard' | 'complex';
  /** AURA's reading of the prompt that led to the choice. */
  brief?: Record<string, unknown>;
  /** aura = AURA chose; rules = fallback picker; only = one model fitted the limits. */
  decidedBy: 'aura' | 'rules' | 'only';
}

const VIDEO_MODES: EnhanceMode[] = ['text-to-video', 'image-to-video'];

function sectionFor(input: DirectEngineInput): CatalogSection {
  if (VIDEO_MODES.includes(input.mode)) return input.hasRefs ? 'reference-video' : input.mode as CatalogSection;
  return input.mode as CatalogSection;
}

function taskFor(mode: EnhanceMode): AiTask {
  return mode === 'image-edit' ? 'image_edit' : mode === 'text-to-image' ? 'image' : 'video';
}

/** Models from the feature's catalog that meet the job's limits and can run now. */
export function candidatesFor(input: DirectEngineInput, available: (p: AiProviderName, t: AiTask) => boolean = canRoute): EngineCandidate[] {
  const video = VIDEO_MODES.includes(input.mode);
  const seen = new Set<string>();
  const out: EngineCandidate[] = [];
  for (const e of CREATIVE_CATALOG[sectionFor(input)] || []) {
    const id = e.model;
    if (!id || seen.has(id)) continue;
    const provider = (e.provider || engineForModel(id)) as EngineProvider;
    if (provider === 'xai') continue; // Grok: manual pick only
    if (!available(provider, taskFor(input.mode))) continue;
    if (video) {
      const d = input.durationSeconds;
      if (d && ((e.maxSeconds && d > e.maxSeconds) || (e.minSeconds && d < e.minSeconds))) continue;
      if (input.resolution === '1080p' && e.supports1080 === false) continue;
      if (input.hasEndFrame && !END_FRAME_MODELS.test(id)) continue;
    } else if (input.imageSize === '4K' && e.maxSize && e.maxSize !== '4K') {
      continue;
    }
    seen.add(id);
    out.push({ id, provider, name: e.label, vendor: e.vendor, hint: e.hint, entry: e });
  }
  return out;
}

function costLine(c: EngineCandidate, input: DirectEngineInput): string {
  const e = c.entry;
  if (VIDEO_MODES.includes(input.mode)) {
    const rate = input.resolution === '1080p' && e.perSec1080 ? e.perSec1080 : e.perSec;
    return rate ? `$${rate.toFixed(3)}/s` : 'price not listed';
  }
  const size = input.imageSize || '2K';
  const each = e.perImageBySize?.[size] ?? e.perImage;
  return each !== undefined ? `$${each.toFixed(3)} per image at ${size}` : 'price not listed';
}

const DIRECTOR_SYSTEM = `You are AURA, the brain of AURAAI's Creative Studio. The user left the model on Auto, so you decide which model makes this piece.

First understand the prompt as a creative director would. Read all of it, not single words. Work out:
- subject: what the piece shows
- text_in_image: none, a few words, exact copy, or Arabic lettering that must be rendered
- shots: how many shots, cuts or timed beats (video)
- people_speaking: whether someone talks, sings or acts to camera (video)
- sound: needed, not needed, or not stated (video)
- must_match: what has to stay identical (a product, face, logo, attached images) or nothing
- style: the look in a few words
- complexity: simple (one subject, plain scene, no exact text, one shot), standard, or complex (several subjects or shots, exact text, brand layout, people speaking, strict product fidelity)

Then assign the ONE model from the list that serves that brief best for its price:
- A specific need decides first: exact or Arabic text, a transparent background, timed beats or several shots, people speaking, a 4K or 1080p output, sound or no sound.
- For a simple job choose a cheaper model that does it well. Spend on the strongest model only when the brief needs what it does best.
- When something must stay identical (the user's attached image, a product, a face, a logo), fidelity comes before price: pick a model that is strong at keeping it, never a draft model.
- Only choose from the list. Every model on it can make this piece right now.

Reply with JSON only:
{"brief": {"subject": "", "text_in_image": "", "shots": 1, "people_speaking": false, "sound": "", "must_match": "", "style": ""}, "complexity": "simple" | "standard" | "complex", "engine": "<id from the list>", "reason": "<one plain sentence, at most 16 words>"}
The reason names what in THIS prompt decided (for example "four timed shots with sound", "Arabic prices on a menu", "one subject and no text, so a cheaper model"). Do not start it with the model name, do not praise the model, no dashes.`;

function buildUserMessage(input: DirectEngineInput, candidates: EngineCandidate[]): string {
  const video = VIDEO_MODES.includes(input.mode);
  const facts: string[] = [`Feature: ${sectionFor(input)}`];
  if (input.hasRefs) facts.push('The user attached reference images that must stay consistent.');
  if (input.hasEndFrame) facts.push('The user attached an end frame.');
  if (input.mode === 'image-to-video') facts.push('The clip starts from an image the user attached.');
  if (input.mode === 'image-edit') facts.push('This edits an image the user attached.');
  if (video && input.durationSeconds) facts.push(`Clip length: ${input.durationSeconds} seconds.`);
  if (video && input.resolution) facts.push(`Resolution: ${input.resolution}.`);
  if (!video && input.imageSize) facts.push(`Image size: ${input.imageSize}.`);
  if (input.fast) facts.push('The user asked for a quick, cheap draft.');
  if (input.quality === 'ultra') facts.push('The user asked for the best quality: cost matters less.');
  const list = candidates.map((c) => {
    const e = c.entry;
    const bits = [`id: ${c.id}`, `name: ${c.name}`, c.vendor ? `maker: ${c.vendor}` : '', `cost: ${costLine(c, input)}`];
    if (video && e.minSeconds && e.maxSeconds) bits.push(`length: ${e.minSeconds} to ${e.maxSeconds}s`);
    if (video) bits.push(`1080p: ${e.supports1080 === false ? 'no' : 'yes'}`);
    if (!video && e.maxSize) bits.push(`max size: ${e.maxSize}`);
    return `- ${bits.filter(Boolean).join(' | ')}\n  ${c.hint}`;
  }).join('\n');
  return `${facts.join('\n')}\n\nModels you can assign (${candidates.length}):\n${list}\n\nUser prompt:\n"""\n${input.prompt.slice(0, 4000)}\n"""`;
}

// The same prompt and limits within 15 minutes get the same model (a
// regenerate should not flip models, and it saves a call).
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; pick: EnginePick }>();
// Identical requests that start together (Creative Studio fires one request
// per variation in parallel) share one decision: one AURA call, one model.
const inflight = new Map<string, Promise<EnginePick>>();

function cacheKey(input: DirectEngineInput, candidates: EngineCandidate[]): string {
  return [input.mode, input.hasRefs ? 1 : 0, input.hasEndFrame ? 1 : 0, input.durationSeconds || '', input.resolution || '',
    input.imageSize || '', input.fast ? 1 : 0, input.quality || '', candidates.map((c) => c.id).join(','), input.prompt.trim()].join('|');
}

export function clearEngineDirectorCache(): void { cache.clear(); inflight.clear(); }

/** The rule picker, held to the same limits and list as AURA. */
function rulesPick(input: DirectEngineInput, candidates: EngineCandidate[]): EnginePick {
  const r = selectBestCreativeEngine(input.mode, input.prompt, {
    fast: input.fast, hasRefs: input.hasRefs, hasEndFrame: input.hasEndFrame, quality: input.quality,
  });
  const fits = candidates.find((c) => c.id === r.model);
  if (fits || candidates.length === 0) return { ...r, name: fits?.name || r.model, decidedBy: 'rules' };
  const first = candidates[0];
  return { provider: first.provider, model: first.id, name: first.name, reason: 'It fits the length, size and references you asked for.', decidedBy: 'rules' };
}

function cleanReason(s: unknown): string {
  return String(s || '').replace(/[‒-―]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Shown after "AURA picked <name>:", so a reason that opens with the name drops it. */
function withoutLeadingName(reason: string, name: string): string {
  if (!reason.toLowerCase().startsWith(name.toLowerCase())) return reason;
  const rest = reason.slice(name.length).replace(/^[\s,:]*(is|was|fits|suits|handles|excels at|specializes in)?\s*/i, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : reason;
}

/**
 * AURA assigns the model for an Auto job. Never throws (except on the
 * caller's own abort): when AURA cannot answer, the rule picker decides
 * inside the same limits.
 */
export async function directEngine(input: DirectEngineInput): Promise<EnginePick> {
  const candidates = candidatesFor(input);
  if (candidates.length === 0) return rulesPick(input, candidates);
  if (candidates.length === 1) {
    const only = candidates[0];
    return { provider: only.provider, model: only.id, name: only.name, reason: 'It is the one model that fits what you asked for.', decidedBy: 'only' };
  }

  const key = cacheKey(input, candidates);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pick;
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = decide(input, candidates, key);
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

async function decide(input: DirectEngineInput, candidates: EngineCandidate[], key: string): Promise<EnginePick> {
  try {
    const result = await aiRouter.text(
      {
        system: DIRECTOR_SYSTEM,
        prompt: buildUserMessage(input, candidates),
        json: true,
        temperature: 0.1,
        // AURA reasons before it answers; a small budget would truncate it.
        maxTokens: 4096,
        model: process.env.ENGINE_DIRECTOR_MODEL || 'gemini-4-hydrogen',
        timeoutMs: Number(process.env.ENGINE_DIRECTOR_TIMEOUT_MS) || 20000,
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
    const out = (typeof result.output === 'string' ? JSON.parse(result.output) : result.output) as {
      engine?: string; complexity?: string; reason?: string; brief?: Record<string, unknown>;
    };
    const chosen = candidates.find((c) => c.id === String(out?.engine || '').trim());
    if (!chosen) return rulesPick(input, candidates);
    const complexity = (['simple', 'standard', 'complex'] as const).find((c) => c === out?.complexity);
    const pick: EnginePick = {
      provider: chosen.provider,
      model: chosen.id,
      name: chosen.name,
      reason: withoutLeadingName(cleanReason(out?.reason), chosen.name) || 'It fits this prompt best.',
      ...(complexity ? { complexity } : {}),
      ...(out?.brief && typeof out.brief === 'object' ? { brief: out.brief } : {}),
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
