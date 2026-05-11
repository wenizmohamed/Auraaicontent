// BrandKit enricher (F3) — fetches a Client's BrandKit and prepends a
// structured brand-context block to the prompt before AI dispatch.  Called
// at the single point of injection inside ai-router.routeCall(), so every
// task type (text/image/video/analysis) and every downstream provider
// receives the same brand-aware prompt.
//
// Failure modes (per spec §3):
//   - opts.skip === true             → no-op, returns prompt unchanged
//   - !clientId                       → no-op (legacy callers w/o tenant scope)
//   - no BrandKit row for clientId    → no-op (most clients won't have one yet)
//   - any DB error during fetch       → swallowed, no-op (enrichment is best-effort)
//
// Caps to keep context-window pressure bounded (spec §3 "Failure modes"):
//   - voiceSamples: 3 max          (filtered by opts.platform, else 'general')
//   - sampleImages: 5 max          (primary=true preferred)
//
// Mirrors the shape pattern of `enrichBodyPrompt` in gemini.provider.ts —
// pure string-in / string-out, idempotent on re-application.

import { db } from '../db/prisma.js';

export type BrandKitPlatform =
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'x'
  | 'email'
  | 'general';

export interface BrandKitEnrichOpts {
  platform?: BrandKitPlatform;
  skip?: boolean;
}

interface VoiceSample {
  context?: string;
  sample?: string;
}

interface SampleImage {
  url?: string;
  label?: string;
  primary?: boolean;
  mimeType?: string;
}

const VOICE_SAMPLE_CAP = 3;
const SAMPLE_IMAGE_CAP = 5;
const VISUAL_REFERENCE_CAP = 3;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pickVoiceSamples(samples: VoiceSample[], platform: BrandKitPlatform): string[] {
  const filtered = samples.filter(s => s?.context === platform);
  const general = samples.filter(s => s?.context === 'general');
  // platform-specific first, fall back to general, dedupe, cap to 3.
  const merged = [...filtered, ...general];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of merged) {
    const text = (s?.sample || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= VOICE_SAMPLE_CAP) break;
  }
  return out;
}

function pickVisualAnchors(images: SampleImage[]): string[] {
  // primary=true first, others after, cap to 5 then take top 3 URLs.
  const primaries = images.filter(i => i?.primary === true && i?.url);
  const rest = images.filter(i => i?.primary !== true && i?.url);
  const merged = [...primaries, ...rest].slice(0, SAMPLE_IMAGE_CAP);
  return merged
    .map(i => (i?.url || '').trim())
    .filter(Boolean)
    .slice(0, VISUAL_REFERENCE_CAP);
}

export async function enrichWithBrandKit(
  prompt: string,
  clientId: string | undefined | null,
  opts: BrandKitEnrichOpts = {},
): Promise<string> {
  if (opts.skip) return prompt;
  if (!clientId) return prompt;
  if (!prompt) return prompt;

  let bk: any = null;
  let clientName = '';
  try {
    bk = await db.brandKit.findUnique({
      where: { clientId },
      include: { client: { select: { name: true } } },
    });
    clientName = bk?.client?.name || '';
  } catch (err: any) {
    // Best-effort enrichment: never block AI calls on a BrandKit lookup failure.
    console.warn('[brand-kit-enricher] lookup failed:', err?.message || err);
    return prompt;
  }
  if (!bk) return prompt;

  const platform: BrandKitPlatform = opts.platform || 'general';

  // Voice line — prefer voicePerPlatform[platform] if present, else fall to
  // voiceSamples filtered by context.
  const voicePerPlatform = (bk.voicePerPlatform || {}) as Record<string, string>;
  let voiceLine = '';
  if (typeof voicePerPlatform?.[platform] === 'string' && voicePerPlatform[platform].trim()) {
    voiceLine = voicePerPlatform[platform].trim();
  } else {
    const samples = pickVoiceSamples(asArray<VoiceSample>(bk.voiceSamples), platform);
    if (samples.length) voiceLine = samples.join(' | ');
  }

  // DO NOT rules.
  const doNotRules = asArray<string>((bk.voiceDoNot as any)?.rules);
  const doNotLine = doNotRules.length ? doNotRules.join('; ') : '';

  // Visual anchors.
  const anchors = pickVisualAnchors(asArray<SampleImage>(bk.sampleImages));

  // If we ended up with nothing usable, pass through to avoid a noisy empty block.
  if (!voiceLine && !doNotLine && !anchors.length) return prompt;

  const lines: string[] = [];
  lines.push(`[BRAND KIT — ${clientName || 'Client'}]`);
  if (voiceLine) lines.push(`Voice: ${voiceLine}`);
  if (doNotLine) lines.push(`DO NOT: ${doNotLine}`);
  if (anchors.length) lines.push(`Visual references: ${anchors.join(', ')}`);
  lines.push('[/BRAND KIT]');

  return `${lines.join('\n')}\n${prompt}`;
}
