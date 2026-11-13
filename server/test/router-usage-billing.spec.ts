// What the router WRITES to UsageEvent, end to end through routeCall.
//
// The cost math has its own golden tests (metering-cost.spec.ts). This file
// checks the plumbing in between: that a provider's real clip length, its
// image-token split and the thinking tokens hidden in the total all reach
// the row, so the right number is billed. Each case is a 2026-11-13 finding.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://test@127.0.0.1:1/test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
  // Providers are only routed to when "configured". Pin (don't delete: dotenv
  // re-adds absent keys from a developer .env) so only the stubs below run.
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.MINIMAX_API_KEY = 'test-key';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  process.env.XAI_API_KEY = '';
  process.env.VERTEX_API_KEY = '';
  process.env.ANTHROPIC_AUTH_TOKEN = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.MOONSHOT_API_KEY = '';
});

const created: any[] = [];
vi.mock('../src/db/prisma.js', () => ({
  db: { usageEvent: { create: vi.fn(async ({ data }: any) => { created.push(data); return data; }) } },
}));
// Not under test here: budget gate and prompt enrichers pass straight through.
vi.mock('../src/lib/budget.js', () => ({ assertOrgBudget: vi.fn(async () => undefined) }));
vi.mock('../src/lib/brand-kit-enricher.js', () => ({ enrichWithBrandKit: vi.fn(async (r: any) => r) }));
vi.mock('../src/lib/knowledge-enricher.js', () => ({ enrichWithKnowledge: vi.fn(async (r: any) => r) }));
vi.mock('../src/lib/memory-enricher.js', () => ({ enrichWithMemory: vi.fn(async (r: any) => r) }));

const providerResult: { value: any } = { value: null };
function stubProvider(name: string) {
  return {
    name,
    text: vi.fn(async () => providerResult.value),
    image: vi.fn(async () => providerResult.value),
    imageEdit: vi.fn(async () => providerResult.value),
    video: vi.fn(async () => providerResult.value),
    analysis: vi.fn(async () => providerResult.value),
  };
}
for (const [path, exportName, name] of [
  ['../src/services/providers/gemini.provider.js', 'geminiProvider', 'gemini'],
  ['../src/services/providers/vertex.provider.js', 'vertexProvider', 'vertex'],
  ['../src/services/providers/dashscope.provider.js', 'dashscopeProvider', 'dashscope'],
  ['../src/services/providers/minimax.provider.js', 'minimaxProvider', 'minimax'],
  ['../src/services/providers/xai.provider.js', 'xaiProvider', 'xai'],
  ['../src/services/providers/kimi.provider.js', 'kimiProvider', 'moonshot'],
  ['../src/services/providers/moonshot.provider.js', 'moonshotProvider', 'moonshot'],
  ['../src/services/providers/anthropic.provider.js', 'anthropicProvider', 'anthropic'],
] as const) {
  // The router also asks the Anthropic module whether an official key is set.
  vi.doMock(path, () => ({ [exportName]: stubProvider(name), ...(name === 'anthropic' ? { anthropicApiKey: () => undefined } : {}) }));
}

const { aiRouter } = await import('../src/services/providers/ai-router.js');

const meta = { orgId: 'org-test', userId: 'u-test' };

beforeEach(() => {
  created.length = 0;
});

async function lastRow() {
  // persistUsage is fire-and-forget; let the microtask run.
  await new Promise((r) => setTimeout(r, 0));
  return created[created.length - 1];
}

describe('router usage rows', () => {
  it('bills the clip MiniMax actually rendered, not the 8s default', async () => {
    providerResult.value = {
      provider: 'minimax', model: 'MiniMax-H3', output: { url: '/uploads/x.mp4' },
      latencyMs: 1, fallbackUsed: false, durationSeconds: 6,
    };
    await aiRouter.video({ prompt: 'a clip' }, { ...meta, preferredProvider: 'minimax' });
    const row = await lastRow();
    expect(row.metadata.model).toBe('MiniMax-H3');
    expect(row.metadata.durationSeconds).toBe(6);
    expect(row.metadata.durationEstimated).toBe(false);
    expect(row.costUsd).toBeCloseTo(6 * 0.08, 6);
  });

  it('still flags an assumed length when the provider reports none', async () => {
    providerResult.value = {
      provider: 'dashscope', model: 'wan3.0-video-prime', output: { url: '/uploads/y.mp4' },
      latencyMs: 1, fallbackUsed: false,
    };
    await aiRouter.video({ prompt: 'a clip' }, { ...meta, preferredProvider: 'dashscope' });
    const row = await lastRow();
    expect(row.metadata.durationEstimated).toBe(true);
  });

  it('bills Gemini image output at the image rate and text+thinking at the text rate', async () => {
    providerResult.value = {
      provider: 'gemini', model: 'gemini-3-pro-image', output: { base64: 'x' }, latencyMs: 1, fallbackUsed: false,
      promptTokens: 14, completionTokens: 1216, totalTokens: 1400, imageOutputTokens: 1120,
    };
    await aiRouter.image({ prompt: 'a mug' }, { ...meta, preferredProvider: 'gemini' });
    const row = await lastRow();
    expect(row.metadata.completionTokens).toBe(1386); // includes the 170 thinking tokens
    expect(row.metadata.imageOutputTokens).toBe(1120);
    expect(row.costUsd).toBeCloseTo(0.13762, 6);
  });

  it('bills the thinking tokens a text call hides in the total', async () => {
    providerResult.value = {
      provider: 'gemini', model: 'gemini-4-carbon', output: 'blue', latencyMs: 1, fallbackUsed: false,
      promptTokens: 45, completionTokens: 5, totalTokens: 132,
    };
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    try {
      await aiRouter.text({ prompt: 'sky colour?' }, { ...meta, preferredProvider: 'gemini' });
    } finally {
      vi.useRealTimers();
    }
    const row = await lastRow();
    expect(row.metadata.completionTokens).toBe(87);
    expect(row.costUsd).toBeCloseTo(45 * 2 / 1e6 + 87 * 10 / 1e6, 9);
  });
});
