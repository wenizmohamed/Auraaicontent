// Golden-input tests for the Alibaba engines in the Creative Studio catalog.
//
// Every expected number here is computed BY HAND from the workspace price
// API (GET /api/v1/models?page_size=200 on the DashScope workspace host),
// re-read live on 2026-11-07 against the two LIVE workspaces: EU (text +
// image) and Tokyo (video). The catalog publishes:
//   images  — "图片生成" per image, OR "1K图片生成"/"2K图片生成" per tier
//             (the tier only exists for the Qwen-Image 3.0 family)
//   video   — "视频生成（720P）" / "视频生成（1080P）" per second
//
// The EU and Tokyo catalogs AGREE on every model they share, so one table
// serves both.
//
// These rows exist because the boot guard only audits *_MODEL env vars: a
// hardcoded provider rung that nobody priced silently logs $0, and video is
// roughly 97% of spend.

import { describe, it, expect } from 'vitest';
import { computeCostUsd, isPriced } from '../src/lib/ai-pricing';

describe('metering: Alibaba image engines (EU catalog, re-read live 2026-11-07)', () => {
  it('qwen-image-2.1-pro: $0.035333 per image, flat at every size', () => {
    // EU catalog: 图片生成 = 0.035333
    expect(computeCostUsd('qwen-image-2.1-pro', 0, 0)).toBeCloseTo(0.035333, 6);
  });

  it('qwen-image-2.1-turbo: $0.014133 per image', () => {
    // EU catalog: 图片生成 = 0.014133
    expect(computeCostUsd('qwen-image-2.1-turbo', 0, 0)).toBeCloseTo(0.014133, 6);
  });

  it('qwen-image-3.0: $0.024754 per image at BOTH the 1K and 2K tier', () => {
    // EU catalog: 1K图片生成 = 0.024754, 2K图片生成 = 0.024754
    expect(computeCostUsd('qwen-image-3.0', 0, 0)).toBeCloseTo(0.024754, 6);
    expect(computeCostUsd('qwen-image-3.0:1k', 0, 0)).toBeCloseTo(0.024754, 6);
    expect(computeCostUsd('qwen-image-3.0:2k', 0, 0)).toBeCloseTo(0.024754, 6);
  });

  it('qwen-image-3.0-pro: $0.03438 at 1K and $0.068761 at 2K (the tier really differs)', () => {
    // EU catalog: 1K图片生成 = 0.03438, 2K图片生成 = 0.068761
    expect(computeCostUsd('qwen-image-3.0-pro', 0, 0)).toBeCloseTo(0.03438, 6);
    expect(computeCostUsd('qwen-image-3.0-pro:1k', 0, 0)).toBeCloseTo(0.03438, 6);
    expect(computeCostUsd('qwen-image-3.0-pro:2k', 0, 0)).toBeCloseTo(0.068761, 6);
  });

  it('z-image-turbo: $0.015 standard, $0.03 thinking', () => {
    // catalog: image_standard = 0.015, image_thinking = 0.03
    expect(computeCostUsd('z-image-turbo', 0, 0)).toBeCloseTo(0.015, 6);
    expect(computeCostUsd('z-image-turbo:thinking', 0, 0)).toBeCloseTo(0.03, 6);
  });

  it('wan2.6-image and wan2.6-t2i: $0.028671 per image', () => {
    // EU catalog: 图片生成 = 0.028671
    expect(computeCostUsd('wan2.6-image', 0, 0)).toBeCloseTo(0.028671, 6);
    expect(computeCostUsd('wan2.6-t2i', 0, 0)).toBeCloseTo(0.028671, 6);
  });

  it('qwen-mt-image-2.0 (translation engine): $0.0006 per image', () => {
    // catalog: image_number = 0.0006
    expect(computeCostUsd('qwen-mt-image-2.0', 0, 0)).toBeCloseTo(0.0006, 6);
  });
});

describe('metering: Alibaba video engines (Tokyo catalog, re-read live 2026-11-07)', () => {
  it('vidu Q3 Ad: $0.125/s at 720p, $0.15/s at 1080p', () => {
    // catalog: video_ratio_720p = 0.125, video_ratio_1080p = 0.15
    expect(computeCostUsd('vidu/viduq3-ad_reference2video', 0, 0, 1, 16)).toBeCloseTo(2.00, 6);
    expect(computeCostUsd('vidu/viduq3-ad_reference2video:1080p', 0, 0, 1, 16)).toBeCloseTo(2.40, 6);
  });

  it('vidu Q3 Mix: $0.12/s at 720p, $0.145/s at 1080p', () => {
    // 0.12 * 10 = 1.20 ; 0.145 * 10 = 1.45
    expect(computeCostUsd('vidu/viduq3-mix_reference2video', 0, 0, 1, 10)).toBeCloseTo(1.20, 6);
    expect(computeCostUsd('vidu/viduq3-mix_reference2video:1080p', 0, 0, 1, 10)).toBeCloseTo(1.45, 6);
  });

  it('vidu Q3 Drama: $0.14/s at both tiers', () => {
    // 0.14 * 12 = 1.68
    expect(computeCostUsd('vidu/viduq3-drama_reference2video', 0, 0, 1, 12)).toBeCloseTo(1.68, 6);
    expect(computeCostUsd('vidu/viduq3-drama_reference2video:1080p', 0, 0, 1, 12)).toBeCloseTo(1.68, 6);
  });

  it('vidu Q2 Pro fast: $0.016/s at 720p, $0.032/s at 1080p', () => {
    // 0.016 * 8 = 0.128 ; 0.032 * 8 = 0.256
    expect(computeCostUsd('vidu/viduq2-pro-fast_img2video', 0, 0, 1, 8)).toBeCloseTo(0.128, 6);
    expect(computeCostUsd('vidu/viduq2-pro-fast_img2video:1080p', 0, 0, 1, 8)).toBeCloseTo(0.256, 6);
  });

  it('wan2.6-i2v-flash: $0.05/s at 720p, $0.075/s at 1080p, $0.025/s without sound', () => {
    // 0.05 * 15 = 0.75 ; 0.075 * 15 = 1.125 ; 0.025 * 15 = 0.375
    expect(computeCostUsd('wan2.6-i2v-flash', 0, 0, 1, 15)).toBeCloseTo(0.75, 6);
    expect(computeCostUsd('wan2.6-i2v-flash:1080p', 0, 0, 1, 15)).toBeCloseTo(1.125, 6);
    expect(computeCostUsd('wan2.6-i2v-flash-noaudio', 0, 0, 1, 15)).toBeCloseTo(0.375, 6);
  });

  it('wan2.6-r2v-flash: the same rates as the i2v flash tier', () => {
    expect(computeCostUsd('wan2.6-r2v-flash', 0, 0, 1, 10)).toBeCloseTo(0.50, 6);
    expect(computeCostUsd('wan2.6-r2v-flash:1080p', 0, 0, 1, 10)).toBeCloseTo(0.75, 6);
  });

  it('wan2.2-i2v-flash: $0.015/s at 480p, $0.036/s at 720p', () => {
    expect(computeCostUsd('wan2.2-i2v-flash:480p', 0, 0, 1, 10)).toBeCloseTo(0.15, 6);
    expect(computeCostUsd('wan2.2-i2v-flash', 0, 0, 1, 10)).toBeCloseTo(0.36, 6);
  });

  it('wan2.5 preview: $0.05/s at 480p, $0.10/s at 720p, $0.15/s at 1080p', () => {
    expect(computeCostUsd('wan2.5-t2v-preview:480p', 0, 0, 1, 8)).toBeCloseTo(0.40, 6);
    expect(computeCostUsd('wan2.5-t2v-preview', 0, 0, 1, 8)).toBeCloseTo(0.80, 6);
    expect(computeCostUsd('wan2.5-t2v-preview:1080p', 0, 0, 1, 8)).toBeCloseTo(1.20, 6);
  });

  it('wan2.7-videoedit: $0.086012/s at 720p, $0.143353/s at 1080p', () => {
    // Tokyo catalog: 视频生成（720P）= 0.086012, 视频生成（1080P）= 0.143353
    expect(computeCostUsd('wan2.7-videoedit', 0, 0, 1, 10)).toBeCloseTo(0.86012, 6);
    expect(computeCostUsd('wan2.7-videoedit:1080p', 0, 0, 1, 10)).toBeCloseTo(1.43353, 6);
  });

  it('happyhorse-1.0-video-edit: $0.123769/s at 720p, $0.220034/s at 1080p', () => {
    expect(computeCostUsd('happyhorse-1.0-video-edit', 0, 0, 1, 10)).toBeCloseTo(1.23769, 6);
    expect(computeCostUsd('happyhorse-1.0-video-edit:1080p', 0, 0, 1, 10)).toBeCloseTo(2.20034, 6);
  });

  it('happyhorse-1.0 generation rungs are priced (dearer than 1.1 at 1080p)', () => {
    // Tokyo catalog: 1.0 is 720p 0.123769, 1080p 0.220034.
    // 1.1 is 720p 0.123769, 1080p 0.165026.
    expect(computeCostUsd('happyhorse-1.0-t2v', 0, 0, 1, 10)).toBeCloseTo(1.23769, 6);
    expect(computeCostUsd('happyhorse-1.0-t2v:1080p', 0, 0, 1, 10)).toBeCloseTo(2.20034, 6);
    expect(computeCostUsd('happyhorse-1.0-i2v', 0, 0, 1, 10)).toBeCloseTo(1.23769, 6);
    expect(computeCostUsd('happyhorse-1.0-r2v', 0, 0, 1, 10)).toBeCloseTo(1.23769, 6);
  });
});

describe('metering: every Alibaba engine the picker offers is priced', () => {
  it('the image engines in the Creative Studio catalog all have a price row', () => {
    // This list is the picker as of 2026-11-07. The engines that exist on no
    // live workspace (z-image-turbo, wan2.7-image, wan2.7-image-pro) were
    // removed from the picker — offering an engine that 403s is a broken
    // promise — but they still carry a price row so the SERVER chain can
    // pick them up the day the entitlement returns.
    for (const m of [
      'qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-2.1-pro', 'qwen-image-2.1-turbo',
      'z-image-turbo', 'wan2.7-image-pro', 'wan2.7-image',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });

  it('the video engines in the Creative Studio catalog all have a price row', () => {
    for (const m of [
      'wan3.0-video-prime', 'wan3.0-video', 'happyhorse-1.1-t2v', 'happyhorse-1.1-i2v',
      'happyhorse-1.1-r2v', 'wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-r2v',
      'vidu/viduq3-ad_reference2video', 'vidu/viduq3-mix_reference2video',
      'vidu/viduq3-drama_reference2video', 'vidu/viduq2-pro-fast_img2video',
      'wan2.6-i2v-flash',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });

  it('every rung of the DashScope intra-provider video ladder is priced', () => {
    // These are hardcoded rungs in dashscope.provider.ts — the boot guard
    // only audits *_MODEL env vars, so an unpriced rung logs $0 silently.
    //
    // The list mirrors the ladder EXACTLY as of 2026-11-07: the dead Vidu
    // and wan2.6-*-flash rungs were removed, so they are no longer here.
    for (const m of [
      'wan3.0-video', 'wan2.7-t2v', 'happyhorse-1.1-t2v', 'happyhorse-1.0-t2v',
      'wan2.7-i2v', 'happyhorse-1.1-i2v', 'happyhorse-1.0-i2v',
      'wan2.7-r2v', 'happyhorse-1.1-r2v', 'happyhorse-1.0-r2v',
    ]) {
      expect(isPriced(m)).toBe(true);
    }
  });

  it('wan2.6-t2v / wan2.6-i2v are priced but are NOT ladder rungs', () => {
    // The EU catalog DOES publish a price for both now ($0.10/s 720P,
    // $0.15/s 1080P), so they are priced — but the provider does not speak
    // their payload contract (wan2.6-i2v wants `input.img_url`, not
    // `input.media`; wan2.6-r2v wants `reference_video_urls`), so they
    // stay off the ladder. A rung there would submit a malformed request
    // and then bill the wrong thing.
    expect(isPriced('wan2.6-t2v')).toBe(true);
    expect(isPriced('wan2.6-i2v')).toBe(true);
  });
});
