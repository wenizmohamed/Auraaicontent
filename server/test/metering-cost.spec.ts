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

  it('gemini-3.8-flash: 200k prompt + 400k completion = $1.65', () => {
    // same promo card as 3.7 (2026-10-10):
    // 200,000 / 1M * 0.75 = 0.15 ; 400,000 / 1M * 3.75 = 1.50 ; total 1.65
    expect(computeCostUsd('gemini-3.8-flash', 200_000, 400_000)).toBeCloseTo(1.65, 6);
  });

  it('grok-4.7: 100k prompt + 50k completion = $0.50', () => {
    // 100,000 / 1M * 2.00 = 0.20 ; 50,000 / 1M * 6.00 = 0.30 ; total 0.50
    expect(computeCostUsd('grok-4.7', 100_000, 50_000)).toBeCloseTo(0.5, 6);
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
  // gemini-3.1-flash-image-preview: promptPerM 0.50, completionPerM 60, perCall 0.067.
  // perCall was 0.10 (a guessed midpoint) until 2026-11-05, when the Google
  // pricing card gave the real per-image rate: $0.067 at 1K.
  // With measured output tokens the tokens ARE the cost; perCall must NOT be added.
  const TOKEN_ONLY = 0.0779; // 1000/1M*0.50 = 0.0005 ; 1290/1M*60 = 0.0774

  it('bills token math only: 1000p + 1290c = $0.0779', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 1000, 1290)).toBeCloseTo(TOKEN_ONLY, 6);
  });

  it('does NOT add perCall on top of measured tokens (would be $0.1779)', () => {
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 1000, 1290);
    const doubleBilled = TOKEN_ONLY + 0.067; // the regression value
    expect(cost).toBeLessThan(doubleBilled);
    expect(Math.abs(cost - doubleBilled)).toBeGreaterThan(0.05); // clearly not the double-billed number
  });
});

describe('metering: image model with ZERO tokens falls back to perCall', () => {
  it('gemini-3.1-flash-image-preview with 0/0 tokens = exactly $0.067 (Google 1K card)', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 0, 0)).toBeCloseTo(0.067, 6);
  });

  it('gemini-3.1-flash-image-preview with undefined tokens = exactly $0.067', () => {
    expect(computeCostUsd('gemini-3.1-flash-image-preview')).toBeCloseTo(0.067, 6);
  });
});

describe('metering: asymmetric token counts on a token-priced image model', () => {
  // gemini-3.1-flash-image-preview: promptPerM 0.50, completionPerM 60, perCall 0.067.
  // perCall was 0.10 (a guessed midpoint) until 2026-11-05, when the Google
  // pricing card gave the real per-image rate: $0.067 at 1K.
  // The perCall suppression keys off measured COMPLETION tokens only, because
  // perCall stands in for the per-image OUTPUT cost. Prompt tokens alone never
  // account for the generated image, so perCall must still apply in that case.

  it('prompt tokens only (1000p + 0c) still bills perCall = $0.0675', () => {
    // 1000/1M*0.50 = 0.0005 ; 0 completion tokens = 0 ; perCall 0.067 still applies.
    // total 0.0005 + 0 + 0.067 = 0.0675
    expect(computeCostUsd('gemini-3.1-flash-image-preview', 1000, 0)).toBeCloseTo(0.0675, 6);
  });

  it('prompt tokens only is strictly dearer than the token math alone', () => {
    // Guards the inverse regression: suppressing perCall whenever ANY token is
    // measured would drop this to $0.0005 and lose the whole image cost.
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 1000, 0);
    expect(cost).toBeGreaterThan(0.0005);
    expect(cost).toBeCloseTo(0.0005 + 0.067, 6);
  });

  it('completion tokens only (0p + 1290c) suppresses perCall = $0.0774', () => {
    // 0 prompt tokens = 0 ; 1290/1M*60 = 0.0774 ; perCall suppressed by the
    // measured output tokens. total 0.0774
    const cost = computeCostUsd('gemini-3.1-flash-image-preview', 0, 1290);
    expect(cost).toBeCloseTo(0.0774, 6);
    expect(cost).toBeLessThan(0.0774 + 0.067); // not double-billed with perCall
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

  it('grok-imagine-video-1.5 (720p default) with 8s duration = $1.12', () => {
    // xAI card 2026-10-17: 0.14/s at 720p * 8s = 1.12 (was billed at the 480p 0.08 rate).
    expect(computeCostUsd('grok-imagine-video-1.5', 0, 0, 1, 8)).toBeCloseTo(1.12, 6);
  });

  it('grok-imagine-video-1.5:1080p with 8s duration = $2.00', () => {
    // 0.25/s * 8s = 2.00
    expect(computeCostUsd('grok-imagine-video-1.5:1080p', 0, 0, 1, 8)).toBeCloseTo(2.00, 6);
  });

  it('grok-imagine-video-1.5:480p with 8s duration = $0.64', () => {
    // 0.08/s * 8s = 0.64
    expect(computeCostUsd('grok-imagine-video-1.5:480p', 0, 0, 1, 8)).toBeCloseTo(0.64, 6);
  });

  // Alibaba Token Plan engines (primary since 2026-10-17). Per-second BY
  // RESOLUTION; the provider reports the tier as a ":<res>" suffix.
  it('wan3.0-video (720P baseline) 8s = $0.80', () => {
    // 0.10/s * 8s = 0.80
    expect(computeCostUsd('wan3.0-video', 0, 0, 1, 8)).toBeCloseTo(0.80, 6);
  });

  it('wan3.0-video-prime (720P, Auto default) 4s = $0.56', () => {
    // 0.14/s * 4s = 0.56
    expect(computeCostUsd('wan3.0-video-prime', 0, 0, 1, 4)).toBeCloseTo(0.56, 6);
  });

  it('wan3.0-video:1080p 8s = $1.60 (double the 720P rate)', () => {
    // 0.20/s * 8s = 1.60
    expect(computeCostUsd('wan3.0-video:1080p', 0, 0, 1, 8)).toBeCloseTo(1.60, 6);
  });

  it('wan3.0-video:480p 30s = $1.50 (longest clip, cheapest tier)', () => {
    // 0.05/s * 30s = 1.50
    expect(computeCostUsd('wan3.0-video:480p', 0, 0, 1, 30)).toBeCloseTo(1.50, 6);
  });

  it('happyhorse-1.1-t2v 5s = $0.70', () => {
    // 0.14/s * 5s = 0.70
    expect(computeCostUsd('happyhorse-1.1-t2v', 0, 0, 1, 5)).toBeCloseTo(0.70, 6);
  });

  it('happyhorse-1.1-i2v:1080p 10s = $1.80', () => {
    // 0.18/s * 10s = 1.80
    expect(computeCostUsd('happyhorse-1.1-i2v:1080p', 0, 0, 1, 10)).toBeCloseTo(1.80, 6);
  });

  it('happyhorse-1.1-r2v:480p 15s = $1.05', () => {
    // 0.07/s * 15s = 1.05
    expect(computeCostUsd('happyhorse-1.1-r2v:480p', 0, 0, 1, 15)).toBeCloseTo(1.05, 6);
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

describe('metering: Alibaba workspace tiers (price catalog, re-read live 2026-11-06)', () => {
  // The Alibaba workspace price API publishes per-image and per-second tiers.
  // The provider reports the tier it billed and the model id carries it as a
  // ":<tier>" suffix, so the meter must resolve the tier, not the bare id.
  //
  // The qwen-image-3.0-pro rates were CORRECTED on 2026-11-06: the catalog
  // publishes $0.04 at 1K and $0.075 at 2K, not the $0.033 / $0.078 that
  // this file recorded from the 2026-11-04 read. The old numbers over-billed
  // the 1K tier by 21% and over-billed the 2K tier by 4%.

  it('qwen-image-3.0-pro at 1K bills $0.04 per image', () => {
    expect(computeCostUsd('qwen-image-3.0-pro:1k')).toBeCloseTo(0.04, 6);
  });

  it('qwen-image-3.0-pro at 2K bills $0.075 per image', () => {
    expect(computeCostUsd('qwen-image-3.0-pro:2k')).toBeCloseTo(0.075, 6);
  });

  it('the bare qwen-image-3.0-pro id bills the 1K rate', () => {
    expect(computeCostUsd('qwen-image-3.0-pro')).toBeCloseTo(0.04, 6);
  });

  it('a 2K image costs more than a 1K image', () => {
    expect(computeCostUsd('qwen-image-3.0-pro:2k')).toBeGreaterThan(
      computeCostUsd('qwen-image-3.0-pro:1k'),
    );
  });

  it('wan2.7-t2v at 1080P bills $0.15 per second (720P is $0.10)', () => {
    expect(computeCostUsd('wan2.7-t2v', 0, 0, 1, 4)).toBeCloseTo(0.4, 6);
    expect(computeCostUsd('wan2.7-t2v:1080p', 0, 0, 1, 4)).toBeCloseTo(0.6, 6);
  });

  it('wan3.0-video-prime honours the resolution tier it was billed at', () => {
    // 4s at 480P ($0.068/s) = $0.272 ; at 720P ($0.14/s) = $0.56 ;
    // at 1080P ($0.28/s) = $1.12
    expect(computeCostUsd('wan3.0-video-prime:480p', 0, 0, 1, 4)).toBeCloseTo(0.272, 6);
    expect(computeCostUsd('wan3.0-video-prime', 0, 0, 1, 4)).toBeCloseTo(0.56, 6);
    expect(computeCostUsd('wan3.0-video-prime:1080p', 0, 0, 1, 4)).toBeCloseTo(1.12, 6);
  });

  it('every Alibaba video family the picker offers is priced', () => {
    // The Creative Studio engine picker offers these ids. An unpriced one
    // logs a $0 UsageEvent, and the boot guard only audits *_MODEL env vars,
    // so hardcoded picker rungs must be priced by hand.
    for (const m of [
      'wan3.0-video', 'wan3.0-video-prime',
      'wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-r2v',
      'happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v',
      'qwen-image-3.0-pro', 'wan2.7-image', 'wan2.7-image-pro',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });

  it('every resolution tier of the picker video models is priced', () => {
    for (const m of [
      'wan3.0-video:480p', 'wan3.0-video:1080p',
      'wan3.0-video-prime:480p', 'wan3.0-video-prime:1080p',
      'wan2.7-t2v:1080p', 'wan2.7-i2v:1080p', 'wan2.7-r2v:1080p',
      'happyhorse-1.1-t2v:480p', 'happyhorse-1.1-t2v:1080p',
      'happyhorse-1.1-i2v:480p', 'happyhorse-1.1-i2v:1080p',
      'happyhorse-1.1-r2v:480p', 'happyhorse-1.1-r2v:1080p',
      'qwen-image-3.0-pro:1k', 'qwen-image-3.0-pro:2k',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });
});

describe('metering: Gemini ladder rungs (2026-11-05 live catalog)', () => {
  // Google killed two ladder rungs on 2026-11-05 (gemini-2.5-flash and every
  // imagen-4.0-* id 404). The replacements were priced from the live Google
  // pricing card so no rung logs $0.

  it('the new text-ladder rungs are priced at the Google card rates', () => {
    // 1M prompt + 1M completion.
    expect(computeCostUsd('gemini-3.7-flash', 1_000_000, 1_000_000)).toBeCloseTo(4.50, 6);
    expect(computeCostUsd('gemini-3.6-flash', 1_000_000, 1_000_000)).toBeCloseTo(4.50, 6);
    expect(computeCostUsd('gemini-3.5-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(2.80, 6);
    expect(computeCostUsd('gemini-3.1-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(1.75, 6);
  });

  it('the new image-ladder rungs are priced', () => {
    expect(isPriced('gemini-3-pro-image-preview')).toBe(true);
    expect(isPriced('gemini-3.1-flash-lite-image')).toBe(true);
    expect(isPriced('gemini-2.5-flash-image')).toBe(true);
  });

  it('gemini-3.1-flash-lite-image falls back to its per-image rate with no tokens', () => {
    expect(computeCostUsd('gemini-3.1-flash-lite-image', 0, 0)).toBeCloseTo(0.034, 6);
  });

  it('gemini-4-argon bills the pre-2026-12-01 promo card', () => {
    // $2.00 in / $10.00 out per 1M through 2026-11-30, then $4/$20.
    expect(computeCostUsd('gemini-4-argon', 1_000_000, 1_000_000)).toBeCloseTo(12.00, 6);
  });

  it('gemini-nano-banana-2.1 is priced at the Google card rate', () => {
    expect(isPriced('gemini-nano-banana-2.1')).toBe(true);
    expect(computeCostUsd('gemini-nano-banana-2.1', 0, 0)).toBeCloseTo(0.034, 6);
  });

  it('gemini-2.5-flash-image falls back to its per-image rate with no tokens', () => {
    expect(computeCostUsd('gemini-2.5-flash-image', 0, 0)).toBeCloseTo(0.039, 6);
  });

  it('every Gemini model id the provider ladders reference is priced', () => {
    // The boot guard only audits *_MODEL env vars, so a hardcoded ladder rung
    // that nobody priced silently logs $0.
    for (const m of [
      'gemini-4-argon', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash',
      'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite', 'gemini-pro-latest', 'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image',
      'gemini-3-pro-image', 'gemini-3-pro-image-preview',
      'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image',
      'gemini-nano-banana-2.1', 'gemini-3-pro-image-preview',
      'gemini-embedding-2-preview', 'gemini-omni-flash-preview',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });
});
