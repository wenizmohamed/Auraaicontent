import { describe, it, expect, vi, beforeEach } from 'vitest';

// AURA's engine director (Weni 2026-11-14): on Auto, AURA reads the whole prompt,
// judges its complexity and picks the engine; Grok is never offered on Auto.

const router = vi.hoisted(() => ({
  text: vi.fn(),
  available: new Set(['gemini', 'dashscope', 'byteplus', 'minimax', 'xai', 'vertex']),
}));

vi.mock('../src/services/providers/ai-router.js', () => ({
  aiRouter: { text: router.text },
  canRoute: (p: string) => router.available.has(p),
}));

const { directEngine, candidatesFor, clearEngineDirectorCache, AUTO_ENGINES } = await import('../src/services/engine-director.service.js');

const all = () => true;
const ids = (list: { id: string }[]) => list.map((e) => e.id);

beforeEach(() => {
  router.text.mockReset();
  router.available = new Set(['gemini', 'dashscope', 'byteplus', 'minimax', 'xai', 'vertex']);
  clearEngineDirectorCache();
});

describe('engine limits (decided in code, before AURA is asked)', () => {
  it('never offers Grok on Auto, for any task', () => {
    for (const mode of ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'] as const) {
      expect(ids(candidatesFor({ mode, prompt: 'x' }, all)).some((id) => /grok/i.test(id))).toBe(false);
    }
    expect(AUTO_ENGINES.some((e) => e.provider === 'xai')).toBe(false);
  });

  it('reference images and an end frame leave only engines that honour them', () => {
    const refs = ids(candidatesFor({ mode: 'image-to-video', prompt: 'x', hasRefs: true }, all));
    expect(refs).toEqual(expect.arrayContaining(['wan3.0-video-prime', 'dreamina-seedance-2-5-260628']));
    expect(refs).not.toContain('dreamina-seedance-2-0-mini-260615');
    expect(refs).not.toContain('MiniMax-H3');
    const end = ids(candidatesFor({ mode: 'image-to-video', prompt: 'x', hasEndFrame: true }, all));
    expect(end).not.toContain('MiniMax-H3');
    expect(end).not.toContain('gemini-omni-1.2-flash');
  });

  it('clips over 15s leave only the 30s engines, and 1080p drops the 720p-only ones', () => {
    expect(ids(candidatesFor({ mode: 'text-to-video', prompt: 'x', durationSeconds: 20 }, all)).sort())
      .toEqual(['dreamina-seedance-2-5-260628', 'wan3.0-video-prime']);
    const hd = ids(candidatesFor({ mode: 'text-to-video', prompt: 'x', resolution: '1080p' }, all));
    expect(hd).not.toContain('dreamina-seedance-2-0-mini-260615');
    expect(hd).not.toContain('gemini-omni-1.2-flash');
  });

  it('4K stills only go to engines that render 4K; the 4K-only engine stays out otherwise', () => {
    const k4 = ids(candidatesFor({ mode: 'text-to-image', prompt: 'x', imageSize: '4K' }, all));
    expect(k4.sort()).toEqual(['gemini-3-pro-image', 'gemini-nano-banana-2.1', 'seedream-5-0-260128']);
    expect(ids(candidatesFor({ mode: 'text-to-image', prompt: 'x', imageSize: '2K' }, all))).not.toContain('seedream-5-0-260128');
  });

  it('skips providers that cannot take a call right now', () => {
    const list = ids(candidatesFor({ mode: 'text-to-video', prompt: 'x' }, (p) => p !== 'byteplus'));
    expect(list.some((id) => id.includes('seedance'))).toBe(false);
    expect(list).toContain('wan3.0-video-prime');
  });
});

describe('directEngine', () => {
  it("uses AURA's pick when it is on the list, with complexity and a clean reason", async () => {
    router.text.mockResolvedValue({ output: { engine: 'dreamina-seedance-2-5-260628', complexity: 'complex', reason: 'Four timed beats — several shots with sound.' } });
    const pick = await directEngine({ mode: 'text-to-video', prompt: '[00:00] a [00:03] b [00:06] c' });
    expect(pick).toMatchObject({ provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', name: 'Seedance 2.5', complexity: 'complex', decidedBy: 'aura' });
    expect(pick.reason).not.toMatch(/[‒-―]/);
    // The director is told the price of every engine it may choose.
    const sent = router.text.mock.calls[0][0].prompt as string;
    expect(sent).toMatch(/\$0\.231 per second/);
    expect(sent).not.toMatch(/grok/i);
  });

  it('a pick that is not on the list (Grok, or an invented id) falls back to the rules, never Grok', async () => {
    router.text.mockResolvedValue({ output: { engine: 'grok-imagine-video-1.5', complexity: 'simple', reason: 'fast' } });
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'FPV drone dive chasing a drift car' });
    expect(pick.decidedBy).toBe('rules');
    expect(pick.provider).not.toBe('xai');
  });

  it('a director error or timeout falls back to the rules within the same limits', async () => {
    router.text.mockRejectedValue(new Error('timeout'));
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'a calm lake at dawn', durationSeconds: 25 });
    expect(pick.decidedBy).toBe('rules');
    expect(['wan3.0-video-prime', 'dreamina-seedance-2-5-260628']).toContain(pick.model);
  });

  it('when only one engine fits, it is used without asking', async () => {
    router.available = new Set(['dashscope']);
    const pick = await directEngine({ mode: 'image-to-video', prompt: 'x', hasRefs: true });
    expect(pick).toMatchObject({ model: 'wan3.0-video-prime', decidedBy: 'only' });
    expect(router.text).not.toHaveBeenCalled();
  });

  it('the same prompt and limits reuse the decision, so a regenerate keeps its engine', async () => {
    router.text.mockResolvedValue({ output: { engine: 'qwen-image-3.0-pro', complexity: 'standard', reason: 'Exact menu text.' } });
    const a = await directEngine({ mode: 'text-to-image', prompt: 'Menu board with "Latte 18 AED"' });
    const b = await directEngine({ mode: 'text-to-image', prompt: 'Menu board with "Latte 18 AED"' });
    expect(a.model).toBe('qwen-image-3.0-pro');
    expect(b).toEqual(a);
    expect(router.text).toHaveBeenCalledTimes(1);
  });

  it('accepts a JSON string reply as well as an object', async () => {
    router.text.mockResolvedValue({ output: JSON.stringify({ engine: 'MiniMax-H3', complexity: 'standard', reason: 'A presenter speaks to camera.' }) });
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'A presenter explains the new menu to camera' });
    expect(pick).toMatchObject({ provider: 'minimax', model: 'MiniMax-H3', decidedBy: 'aura' });
  });
});
