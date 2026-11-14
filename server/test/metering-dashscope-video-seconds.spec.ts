import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 2026-11-14 metering audit H1: Alibaba video returned no durationSeconds, so
// the router billed the caller's raw number (or an 8s guess) instead of the
// length the engine rendered after clamping to its range.

vi.hoisted(() => {
  process.env.DASHSCOPE_API_KEY = 'test-key';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost:5432/z';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789-0123456789-0123456789';
});

vi.mock('../src/services/storage.service.js', () => ({
  storageService: { saveFile: vi.fn(async () => ({ fileUrl: '/uploads/clip.mp4' })) },
}));

const sent: Array<Record<string, any>> = [];
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  if (url.includes('video-synthesis')) {
    sent.push(JSON.parse(init?.body || '{}'));
    return new Response(JSON.stringify({ output: { task_id: 't1' } }), { status: 200 });
  }
  if (url.includes('/tasks/t1')) {
    return new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/v.mp4' } }), { status: 200 });
  }
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
});

const { dashscopeProvider } = await import('../src/services/providers/dashscope.provider.js');
const { computeCostUsd } = await import('../src/lib/ai-pricing.js');

async function render(req: Record<string, unknown>) {
  const p = dashscopeProvider.video({ prompt: 'A calm lake at dawn', ...req } as any);
  await vi.advanceTimersByTimeAsync(6000);
  return p;
}

beforeEach(() => { sent.length = 0; vi.useFakeTimers(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Alibaba video bills the seconds it rendered', () => {
  it('no length given: the engine renders its 5s default and that is what is billed', async () => {
    const r = await render({ model: 'wan3.0-video-prime' });
    expect(sent[0].parameters.duration).toBe(5);
    expect(r.durationSeconds).toBe(5);
    expect(computeCostUsd('wan3.0-video-prime', 0, 0, 1, r.durationSeconds)).toBeCloseTo(0.635995, 6);
  });

  it('a request past the engine maximum is billed at the clamped length', async () => {
    const r = await render({ model: 'happyhorse-1.1-t2v', durationSeconds: 30 });
    expect(sent[0].parameters.duration).toBe(15);
    expect(r.durationSeconds).toBe(15);
  });
});
