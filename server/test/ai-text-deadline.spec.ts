// Text-generation deadlines: per-attempt timeouts must really cancel the
// request, a caller-supplied timeout must win over the global default, and a
// caller-supplied AbortSignal must stop the WHOLE fallback chain.
//
// Why this matters: the monthly-plan generation sat at 40% for 9–15 minutes
// (2026-10 "it keeps looping"). Each Gemini rung hit GEMINI_TIMEOUT_MS, the
// ladder restarted the full plan on the next model, and the timed-out request
// was never aborted — the model finished in the background and its answer was
// thrown away. Reproduced end to end against a stub; these tests pin the fix.
//
// Run:  npm test -- ai-text-deadline.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://test@127.0.0.1:1/test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_TIMEOUT_MS = '80';
  process.env.GEMINI_TEXT_MODEL = 'gemini-pro-test';
  process.env.GEMINI_FLASH_TEXT_MODEL = 'gemini-flash-test';
  delete process.env.GEMINI_TEXT_LADDER;
  delete process.env.XAI_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
});

// ─── Fake Gemini SDK ─────────────────────────────────────────────
// Per-model latency; records whether each request was handed an abortSignal
// and whether that signal actually fired.
interface Call { model: string; signal?: AbortSignal; abortedAfterMs?: number }
const calls: Call[] = [];
let latency: Record<string, number> = {};

function fakeGenerate({ model, config }: { model: string; config?: { abortSignal?: AbortSignal } }) {
  const call: Call = { model, signal: config?.abortSignal };
  calls.push(call);
  const delay = latency[model] ?? latency.default ?? 0;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({
      text: JSON.stringify({ posts: [{ title: `from ${model}` }] }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {},
    }), delay);
    config?.abortSignal?.addEventListener('abort', () => {
      clearTimeout(t);
      call.abortedAfterMs = Date.now() - started;
      reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    });
  });
}

vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: fakeGenerate }; },
  VideoGenerationReferenceType: {},
}));

const { geminiProvider } = await import('../src/services/providers/gemini.provider.js');
const { aiRouter } = await import('../src/services/providers/ai-router.js');
const { AiCancelledError, isRetryableAiError } = await import('../src/services/providers/errors.js');

beforeEach(() => {
  calls.length = 0;
  latency = {};
});

describe('gemini text: per-attempt timeout', () => {
  it('aborts the in-flight request when an attempt times out, then moves to the next rung', async () => {
    latency = { 'gemini-pro-test': 1_000, default: 5 };
    const res = await geminiProvider.text({ prompt: 'plan', json: true });

    expect(res.model).toBe('gemini-flash-test');
    expect(calls[0].model).toBe('gemini-pro-test');
    expect(calls[0].signal).toBeDefined();
    expect(calls[0].signal!.aborted).toBe(true);
    expect(calls[0].abortedAfterMs).toBeLessThan(500);
  });

  it('honours a per-request timeoutMs so a slow-but-working model is not thrown away', async () => {
    latency = { 'gemini-pro-test': 200, default: 5 };
    const res = await geminiProvider.text({ prompt: 'plan', json: true, timeoutMs: 2_000 });

    expect(res.model).toBe('gemini-pro-test');
    expect(calls.map(c => c.model)).toEqual(['gemini-pro-test']);
  });
});

describe('caller AbortSignal', () => {
  it('stops the whole chain at once instead of walking the remaining rungs', async () => {
    latency = { default: 1_000 };
    const ctl = new AbortController();
    setTimeout(() => ctl.abort('budget used up'), 40);
    const started = Date.now();

    const err = await aiRouter.text({ prompt: 'plan', json: true, timeoutMs: 5_000, signal: ctl.signal }).catch(e => e);

    expect(err).toBeInstanceOf(AiCancelledError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls.map(c => c.model)).toEqual(['gemini-pro-test']);
    expect(calls[0].signal!.aborted).toBe(true);
  });

  it('never calls a provider when the signal is already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort('stopped by user');

    await expect(aiRouter.text({ prompt: 'plan', signal: ctl.signal })).rejects.toBeInstanceOf(AiCancelledError);
    expect(calls).toHaveLength(0);
  });

  it('is never treated as retryable', () => {
    expect(isRetryableAiError(new AiCancelledError('text', 'stopped by user'))).toBe(false);
  });
});
