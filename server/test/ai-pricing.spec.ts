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
  // xAI
  'grok-4.20',
  'grok-imagine-image',
  'grok-imagine-video',
  // Moonshot Kimi
  'kimi-k2.6',
  // DashScope (provider defaults)
  'qwen3.7-max',
  'qwen3.6-plus',
  'qwen-image-2.0-pro',
  'wan2.7-image-pro',
  // Anthropic assistant (chat.ts CLAUDE_ASSISTANT_MODEL)
  'claude-sonnet-4-20250514',
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

  it('auditConfiguredModelPricing flags an unpriced *_MODEL env var', () => {
    const unpriced = auditConfiguredModelPricing({
      GEMINI_TEXT_MODEL: 'gemini-pro-latest',          // priced
      SOME_NEW_MODEL: 'brand-new-unpriced-model-2027', // not priced
    } as NodeJS.ProcessEnv);
    expect(unpriced).toContain('brand-new-unpriced-model-2027');
    expect(unpriced).not.toContain('gemini-pro-latest');
  });
});
