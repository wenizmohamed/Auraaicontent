// AI Copywriting — brand-grounded website copy generation.
//
// Generates headlines / descriptions / articles / CTAs, grounded in the
// client's knowledge base (brand guidelines, prior copy, reference docs)
// via the existing retrieveContext RAG path. Multi-language: en / ar / fr
// are NATIVELY generated per language — Arabic is not a translation of the
// English, it is written idiomatically for the MENA region (client
// requirement from the Nestlé Family revamp brief, 2026-05-21).

import { aiRouter } from './providers/ai-router.js';
import { retrieveContext } from './retrieval.service.js';

export type CopyType = 'headline' | 'description' | 'article' | 'cta';
export type CopyLanguage = 'en' | 'ar' | 'fr';

interface CopySpec {
  label: string;
  lengthHint: string;
  guidance: string;
}

const COPY_SPECS: Record<CopyType, CopySpec> = {
  headline: {
    label: 'headline',
    lengthHint: 'about 10-15 words, a single line',
    guidance: 'Punchy, benefit-led, attention-catching. No trailing period.',
  },
  description: {
    label: 'short description',
    lengthHint: 'about 12-25 words, one or two sentences',
    guidance: 'Concise, concrete, benefit-first. Reads naturally beneath a headline.',
  },
  article: {
    label: 'short article',
    lengthHint: '100-160 words',
    guidance: 'Structured: a hook, two or three supporting points, a closing line. Warm and informative.',
  },
  cta: {
    label: 'call-to-action button label',
    lengthHint: '2-6 words',
    guidance: 'Imperative, action-driving, no fluff.',
  },
};

const LANGUAGE_NAMES: Record<CopyLanguage, string> = {
  en: 'English',
  ar: 'Arabic',
  fr: 'French',
};

// Per-language directives. Arabic + French are explicitly NOT translations —
// they are generated natively so they read as original regional copy.
const LANGUAGE_DIRECTIVES: Record<CopyLanguage, string> = {
  en: 'Write in natural, idiomatic English.',
  ar: 'Write in natural, idiomatic Modern Standard Arabic for a regional MENA audience. '
    + 'This is NOT a translation of English copy — generate native Arabic that reads as if '
    + 'originally written in Arabic, respecting Arabic rhetorical style and cultural nuance.',
  fr: 'Write in natural, idiomatic French. This is native French copy, not a translation — '
    + 'respect French rhetorical style and phrasing.',
};

export interface CopywritingRequest {
  orgId: string;
  clientId?: string;
  copyType: CopyType;
  language: CopyLanguage;
  tone?: string;
  brief: string;
  count?: number;
}

export interface CopywritingResult {
  variants: string[];
  language: CopyLanguage;
  copyType: CopyType;
  groundingChunks: number;
  provider: string;
  model: string;
  latencyMs: number;
}

export async function generateCopy(req: CopywritingRequest): Promise<CopywritingResult> {
  const { orgId, clientId, copyType, language, tone, brief } = req;
  const count = Math.min(Math.max(req.count || 3, 1), 10);
  const spec = COPY_SPECS[copyType];
  const langName = LANGUAGE_NAMES[language];

  // 1. Ground against the client's brand knowledge base (reuses existing RAG).
  //    Best-effort — an empty knowledge base must not hard-fail generation.
  let brandContext = '';
  let groundingChunks = 0;
  if (clientId) {
    try {
      const chunks = await retrieveContext(orgId, clientId, brief, 6);
      groundingChunks = chunks.length;
      if (chunks.length) {
        brandContext = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
      }
    } catch {
      // grounding unavailable — generate ungrounded rather than fail the request.
    }
  }

  // 2. System prompt — language directive + tone + brand grounding.
  const system = [
    'You are a senior brand copywriter producing website copy for a client.',
    LANGUAGE_DIRECTIVES[language],
    tone ? `Tone of voice: ${tone}.` : 'Tone of voice: warm, clear, brand-appropriate.',
    brandContext
      ? 'Ground every line in the client brand material below. Match its vocabulary, '
        + 'claims, and voice. Never invent product facts it does not support.\n\n'
        + `--- BRAND MATERIAL ---\n${brandContext}\n--- END BRAND MATERIAL ---`
      : 'No brand material was provided — stay on-brief and avoid inventing specific product claims.',
  ].join('\n\n');

  // 3. User prompt — ask for a JSON array of variants.
  const prompt = [
    `Write ${count} distinct ${spec.label} option${count > 1 ? 's' : ''} in ${langName}.`,
    `Each should be ${spec.lengthHint}. ${spec.guidance}`,
    '',
    'Brief / subject:',
    brief.trim(),
    '',
    'Return ONLY a JSON array of strings — no preamble, no markdown. Example: ["option one", "option two"].',
  ].join('\n');

  // 4. Generate via the multi-provider router (Gemini primary, xAI fallback).
  const result = await aiRouter.text(
    { prompt, system, temperature: 0.8, json: true },
    { orgId, clientId },
  );

  // 5. Parse defensively — json:true should yield an array, but models drift.
  let variants: string[] = [];
  const raw = result.output;
  if (Array.isArray(raw)) {
    variants = raw.map(String);
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      variants = Array.isArray(parsed) ? parsed.map(String) : [raw];
    } catch {
      variants = raw.split('\n').map(s => s.replace(/^[\d.\-)\s]+/, '').trim()).filter(Boolean);
    }
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const arr = obj.options || obj.variants || obj.copy || Object.values(obj)[0];
    variants = Array.isArray(arr) ? arr.map(String) : [JSON.stringify(raw)];
  }
  variants = variants.map(v => v.trim()).filter(Boolean).slice(0, count);

  return {
    variants,
    language,
    copyType,
    groundingChunks,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
