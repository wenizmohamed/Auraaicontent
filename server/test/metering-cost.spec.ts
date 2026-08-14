// Golden-input tests for the cost meter (server/src/lib/ai-pricing.ts).
// Every expected number here is computed BY HAND from the published pricing
// table, never from the implementation. If computeCostUsd drifts (for example
// someone re-adds perCall on top of measured image tokens), these fail loudly.

import { describe, it, expect } from 'vitest';
import {
  AI_PRICING,
  computeCostUsd,
  isPriced,
  DEFAULT_VIDEO_DURATION_S,
} from '../src/lib/ai-pricing';

describe('metering: text models (token math)', () => {
  it('gemini-flash-latest: 200k prompt + 400k completion = $1.65', () => {
    // 3.7-flash promo card (2026-08-14):
    // 200,000 / 1M * 0.75 = 0.15 ; 400,000 / 1M * 3.75 = 1.50 ; total 1.65
    expect(computeCostUsd('gemini-flash-latest', 200_000, 400_000)).toBeCloseTo(1.65, 6);
  });

  it('grok-4.6: 100k prompt + 50k completion = $0.50', () => {
    // 100,000 / 1M * 2.00 = 0.20 ; 50,000 / 1M * 6.00 = 0.30 ; total 0.50
    expect(computeCostUsd('grok-4.6', 100_000, 50_000)).toBeCloseTo(0.5, 6);
  });

  it('qwen3.8-max: 1M prompt + 1M completion = $8.00', () => {
    // 1M / 1M * 2.00 = 2.00 ; 1M / 1M * 6.00 = 6.00 ; total 8.00
    expect(computeCostUsd('qwen3.8-max', 1_000_000, 1_000_000)).toBeCloseTo(8.0, 6);
  });

  it('gemini-3.1-pro-preview: 500k prompt + 250k completion = $4.00', () => {
    // 500,000 / 1M * 2.00 = 1.00 ; 250,000 / 1M * 12.00 = 3.00 ; total 4.00
    expect(computeCostUsd('gemini-3.1-pro-preview', 500_000, 250_000)).toBeCloseTo(4.0, 6);
  });
});

describe('metering: image model WITH measured completion tokens (double-count regression)', () => {
  // gemini-3.1-flash-image-preview: promptPerM 0.50, completionPerM 60, perCall 0.10.
  // With measured output tokens the tokens ARE the cost; perCall must NOT be added.
  const TOKEN_ONLY = 0.0779; // 1000/1M*0.50 = 0.0005 ; 1290/1M*60 = 0.0774

  it('bills token math only: 1000p + 1290c = $0.0779', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 1000, 1290)).toBeCloseTo(TOKEN_ONLY, 6);
  });

  it('does NOT add perCall on top of measured tokens (would be $0.1779)', () => {
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 1000, 1290);
    const doubleBilled = TOKEN_ONLY + 0.10; // the regression value
    expect(cost).toBeLessThan(doubleBilled);
    expect(Math.abs(cost - doubleBilled)).toBeGreaterThan(0.05); // clearly not the double-billed number
  });
});

describe('metering: image model with ZERO tokens falls back to perCall', () => {
  it('gemini-3.1-flash-image-preview with 0/0 tokens = exactly $0.10', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 0, 0)).toBeCloseTo(0.10, 6);
  });

  it('gemini-3.1-flash-image-preview with undefined tokens = exactly $0.10', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview')).toBeCloseTo(0.10, 6);
  });
});

describe('metering: asymmetric token counts on a token-priced image model', () => {
  // gemini-3.1-flash-image-preview: promptPerM 0.50, completionPerM 60, perCall 0.10.
  // The perCall suppression keys off measured COMPLETION tokens only, because
  // perCall stands in for the per-image OUTPUT cost. Prompt tokens alone never
  // account for the generated image, so perCall must still apply in that case.

  it('prompt tokens only (1000p + 0c) still bills perCall = $0.1005', () => {
    // 1000/1M*0.50 = 0.0005 ; 0 completion tokens = 0 ; perCall 0.10 still applies.
    // total 0.0005 + 0 + 0.10 = 0.1005
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 1000, 0)).toBeCloseTo(0.1005, 6);
  });

  it('prompt tokens only is strictly dearer than the token math alone', () => {
    // Guards the inverse regression: suppressing perCall whenever ANY token is
    // measured would drop this to $0.0005 and lose the whole image cost.
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 1000, 0);
    expect(cost).toBeGreaterThan(0.0005);
    expect(cost).toBeCloseTo(0.0005 + 0.10, 6);
  });

  it('completion tokens only (0p + 1290c) suppresses perCall = $0.0774', () => {
    // 0 prompt tokens = 0 ; 1290/1M*60 = 0.0774 ; perCall suppressed by the
    // measured output tokens. total 0.0774
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 0, 1290);
    expect(cost).toBeCloseTo(0.0774, 6);
    expect(cost).toBeLessThan(0.0774 + 0.10); // not double-billed with perCall
  });
});

describe('metering: perCall-only models', () => {
  it('imagen-4.0-generate-001 = exactly $0.04 with zero tokens', () => {
    expect(computeCostUsd('imagen-4.0-generate-001', 0, 0)).toBeCloseTo(0.04, 6);
  });

  it('grok-imagine-image = exactly $0.02 with zero tokens', () => {
    expect(computeCostUsd('grok-imagine-image', 0, 0)).toBeCloseTo(0.02, 6);
  });
});

describe('metering: video per-second pricing', () => {
  it('veo-3.1-fast with explicit 6s duration = $1.20', () => {
    // 0.20/s * 6s = 1.20
    expect(computeCostUsd('veo-3.1-fast-generate-preview', 0, 0, 1, 6)).toBeCloseTo(1.20, 6);
  });

  it('veo-3.1-fast WITHOUT duration uses DEFAULT_VIDEO_DURATION_S, not a hardcoded 8', () => {
    const noDuration = computeCostUsd('veo-3.1-fast-generate-preview', 0, 0, 1);
    const viaConstant = computeCostUsd('veo-3.1-fast-generate-preview', 0, 0, 1, DEFAULT_VIDEO_DURATION_S);
    // Whatever the constant is, the no-duration path must equal duration = constant.
    expect(noDuration).toBeCloseTo(viaConstant, 6);
    // Hand math for the constant's documented current value: 0.20/s * 8s = 1.60.
    expect(DEFAULT_VIDEO_DURATION_S).toBe(8);
    expect(noDuration).toBeCloseTo(1.60, 6);
  });

  it('grok-imagine-video-1.5 with 8s duration = $0.64', () => {
    // Repriced 2026-08-14 to the xAI card: 0.08/s * 8s = 0.64 (was 0.05/s).
    expect(computeCostUsd('grok-imagine-video-1.5', 0, 0, 1, 8)).toBeCloseTo(0.64, 6);
  });
});

describe('metering: unpriced models', () => {
  it('unknown model costs $0 and isPriced() is false', () => {
    const model = 'totally-unknown-model-9000';
    expect(isPriced(model)).toBe(false);
    expect(computeCostUsd(model, 123_456, 654_321, 3, 12)).toBe(0);
  });

  it('priced models report isPriced() true', () => {
    expect(isPriced('gemini-flash-latest')).toBe(true);
    expect(isPriced('imagen-4.0-generate-001')).toBe(true);
  });
});

describe('metering: calls > 1 multiplies per-call and per-second pricing', () => {
  it('grok-imagine-image x3 calls = $0.06', () => {
    // 0.02 per image * 3 = 0.06
    expect(computeCostUsd('grok-imagine-image', 0, 0, 3)).toBeCloseTo(0.06, 6);
  });

  it('veo-3.1-fast 5s x2 calls = $2.00', () => {
    // 0.20/s * 5s * 2 calls = 2.00
    expect(computeCostUsd('veo-3.1-fast-generate-preview', 0, 0, 2, 5)).toBeCloseTo(2.00, 6);
  });

  it('imagen-4.0-generate-001 x4 calls = $0.16', () => {
    // 0.04 per image * 4 = 0.16
    expect(computeCostUsd('imagen-4.0-generate-001', 0, 0, 4)).toBeCloseTo(0.16, 6);
  });
});

describe('metering: no double billing anywhere in the pricing table', () => {
  // For EVERY model that has both token pricing and a perCall stand-in, a call
  // with measured completion tokens must bill token math only. If someone
  // re-adds perCall on top, cost jumps by perCall and this loop fails.
  const withBoth = Object.entries(AI_PRICING).filter(
    ([, p]) => (p.promptPerM > 0 || p.completionPerM > 0) && (p.perCall ?? 0) > 0,
  );

  it('table contains at least one model with both token pricing and perCall', () => {
    expect(withBoth.length).toBeGreaterThan(0);
  });

  it.each(withBoth.map(([name]) => [name]))(
    '%s: measured tokens bill strictly less than token math plus perCall',
    (name) => {
      const p = AI_PRICING[name];
      const promptTokens = 1_000;
      const completionTokens = 1_300;
      const tokenOnly =
        (promptTokens / 1_000_000) * p.promptPerM +
        (completionTokens / 1_000_000) * p.completionPerM;
      const cost = computeCostUsd(name, promptTokens, completionTokens);
      expect(cost).toBeCloseTo(tokenOnly, 6);
      expect(cost).toBeLessThan(tokenOnly + (p.perCall as number));
    },
  );
});
