// Cost-meter coverage guard. The AI cost dashboard derives spend from a
// model -> price table (src/lib/ai-pricing.ts). A model name that isn't in the
// table is tracked as a call but costed $0 — which silently undercounts spend.
// This bit us on 2026-06-29: prod .env pointed GEMINI_*_MODEL at rolling
// "-latest" aliases + the Claude assistant, none of which were priced, so all
// text/analysis/chat/Claude spend logged as $0.
//
// These tests assert that every model the app is configured to use IS priced,
// so the regression can't recur unnoticed in CI.
//
// Run:  npm test -- ai-pricing.spec.ts

import { describe, expect, it } from 'vitest';
import { isPriced, computeCostUsd, auditConfiguredModelPricing } from '../src/lib/ai-pricing.js';

// The model names env.ts defaults to, PLUS the rolling aliases + assistant that
// prod .env actually configures. All must be priced.
const REQUIRED_MODELS = [
  // Gemini (env.ts defaults)
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-embedding-2-preview',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-generate-001',
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  // Gemini rolling aliases configured in prod .env (the 2026-06-29 gap)
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  // 2026-08-14 refresh: current prod .env models — must stay priced forever
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  // xAI
  'grok-4.20',
  'grok-4.5',
  'grok-4.6',
  'grok-4.7',
  'grok-imagine-image',
  'grok-imagine-image-2.0',
  'grok-imagine-video',
  'grok-imagine-video-1.5', 'grok-imagine-video-1.5:480p', 'grok-imagine-video-1.5:1080p', 'grok-imagine-video:480p',
  // Moonshot Kimi
  'kimi-k2.6',
  'k3',
  // DashScope (provider defaults)
  'qwen3.7-max',
  'qwen3.8-max',
  'qwen3.7-plus',
  'qwen3.8-flash',
  'qwen3.6-plus',
  'qwen-image-2.0-pro',
  'qwen-image-3.0-pro',
  'wan2.7-image-pro',
  'wan2.7-image',
  // 2026-10-17: Alibaba is the image + video primary. Every rung the DashScope
  // video provider can emit (incl. the ":<res>" billing suffixes) must be priced.
  'wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-r2v',
  'wan3.0-video', 'wan3.0-video:480p', 'wan3.0-video:1080p',
  'wan3.0-video-prime', 'wan3.0-video-prime:480p', 'wan3.0-video-prime:1080p',
  'happyhorse-1.1-t2v', 'happyhorse-1.1-t2v:480p', 'happyhorse-1.1-t2v:1080p',
  'happyhorse-1.1-i2v', 'happyhorse-1.1-i2v:480p', 'happyhorse-1.1-i2v:1080p',
  'happyhorse-1.1-r2v', 'happyhorse-1.1-r2v:480p', 'happyhorse-1.1-r2v:1080p',
  // Anthropic assistant (chat.ts CLAUDE_ASSISTANT_MODEL)
  'claude-sonnet-4-20250514',
  // ── 2026-11-07: the live Alibaba workspaces (EU text+image, Tokyo video) ──
  // The EU/Tokyo catalogs publish these rates; every id the picker or the
  // server ladder can emit must have a row, including the ":<res>" suffixes.
  'qwen-image-3.0', 'qwen-image-3.0:1k', 'qwen-image-3.0:2k',
  'qwen-image-3.0-pro:1k', 'qwen-image-3.0-pro:2k',
  'qwen-image-2.1-pro', 'qwen-image-2.1-turbo',
  'wan2.7-t2v:1080p', 'wan2.7-i2v:1080p', 'wan2.7-r2v:1080p',
  'wan2.7-videoedit', 'wan2.7-videoedit:1080p',
  'wan2.6-t2v', 'wan2.6-t2v:1080p',
  'wan2.6-i2v', 'wan2.6-i2v:1080p',
  'wan2.6-r2v', 'wan2.6-r2v:1080p',
  'wan2.6-image', 'wan2.6-t2i',
  'happyhorse-1.0-t2v', 'happyhorse-1.0-t2v:1080p',
  'happyhorse-1.0-i2v', 'happyhorse-1.0-i2v:1080p',
  'happyhorse-1.0-r2v', 'happyhorse-1.0-r2v:1080p',
  'happyhorse-1.0-video-edit', 'happyhorse-1.0-video-edit:1080p',
  // Vertex AI serves the same Gemini model ids on the same price card, so
  // those rows must already exist (they are listed above under Gemini).
  'gemini-4-argon', 'gemini-4-carbon', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-nano-banana-2.1', 'gemini-3-pro-image',
  'gemini-omni-1.2-flash', 'gemini-omni-1.1-flash', 'gemini-omni-flash-preview',
  // 2026-11-12: Anthropic Claude 5.5 + xAI Grok 2.0 tiered image resolution rows + Kimi K3.1
  'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-4-6', 'claude-haiku-5-5',
  'grok-imagine-image-2.0:1k', 'grok-imagine-image-2.0:2k',
  'grok-imagine-video-1.5-lite', 'grok-imagine-video-1.5-lite:1080p',
  'kimi-k3.1-pro-highspeed', 'kimi-k3.1-pro', 'kimi-k3',
  // 2026-11-12: MiniMax M Plan (H3 2K video, H3-Image 4K, Image-01, M3 text)
  'MiniMax-H3', 'MiniMax-H3:1080p', 'MiniMax-H3:2k', 'MiniMax-H3-Max', 'MiniMax-H3-Max:480p',
  'MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed', 'image-01',
  'MiniMax-M3', 'MiniMax-M3.1-Flash',
  // 2026-11-14: BytePlus ModelArk (ByteDance Seedance 2.5/2.0/1.0, Seedream 5.5/5.0, Dola Seed 2.1)
  'dreamina-seedance-2-5-260628', 'dreamina-seedance-2-5-260628:480p', 'dreamina-seedance-2-5-260628:1080p',
  'dreamina-seedance-2-0-260128', 'dreamina-seedance-2-0-260128:1080p', 'dreamina-seedance-2-0-260128:4k',
  'dreamina-seedance-2-0-fast-260128', 'dreamina-seedance-2-0-mini-260615',
  'seedance-1-0-pro-fast-251015', 'seedance-1-0-pro-fast-251015:1080p', 'seedance-1-0-pro-250528',
  'dola-seedream-5-5-261028', 'dola-seedream-5-5-261028:1k', 'dola-seedream-5-5-261028:2k',
  'dola-seedream-5-0-pro-260628', 'dola-seedream-5-0-pro-260628:1k', 'dola-seedream-5-0-pro-260628:2k',
  'dola-seedream-5-0-flash-260915', 'seedream-5-0-260128', 'dola-seed-2-1-turbo-260628',
];

describe('ai-pricing coverage', () => {
  for (const model of REQUIRED_MODELS) {
    it(`prices ${model}`, () => {
      expect(isPriced(model)).toBe(true);
      // priced models must produce a non-zero cost for non-zero token usage
      // (token-billed) OR be an explicitly per-call/per-second model.
      expect(computeCostUsd(model, 1_000_000, 1_000_000, 1, 8)).toBeGreaterThan(0);
    });
  }

  it('treats an unknown model as unpriced (not silently priced)', () => {
    expect(isPriced('totally-made-up-model-xyz')).toBe(false);
  });

  // Vertex's OpenAI-compatible route requires a `google/` publisher prefix on
  // the model id (a bare id answers 400 "Malformed publisher model"). That
  // prefix is a routing artifact — without normalisation every Vertex chat
  // call would be metered at $0, because the price table keys off the bare id.
  it('prices a Vertex publisher-prefixed model id as the bare id', () => {
    expect(isPriced('google/gemini-3.8-flash')).toBe(true);
    expect(computeCostUsd('google/gemini-3.8-flash', 1_000_000, 1_000_000, 1))
      .toBe(computeCostUsd('gemini-3.8-flash', 1_000_000, 1_000_000, 1));
    // And it must be a REAL cost, not a silent $0.
    expect(computeCostUsd('google/gemini-3.8-flash', 1_000_000, 1_000_000, 1)).toBeGreaterThan(0);
  });

  it('auditConfiguredModelPricing flags an unpriced *_MODEL env var', () => {
    const unpriced = auditConfiguredModelPricing({
      GEMINI_TEXT_MODEL: 'gemini-pro-latest',          // priced
      SOME_NEW_MODEL: 'brand-new-unpriced-model-2027', // not priced
    } as NodeJS.ProcessEnv);
    expect(unpriced).toContain('brand-new-unpriced-model-2027');
    expect(unpriced).not.toContain('gemini-pro-latest');
  });
});
