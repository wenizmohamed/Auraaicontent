import { describe, it, expect, vi, beforeEach } from 'vitest';

// AURA is the brain (Weni 2026-11-14): on Auto it understands the prompt and
// assigns the right model from EVERY model the user could pick for that feature.

const router = vi.hoisted(() => ({
  text: vi.fn(),
  available: new Set(['gemini', 'dashscope', 'byteplus', 'minimax', 'xai', 'vertex']),
}));

vi.mock('../src/services/providers/ai-router.js', () => ({
  aiRouter: { text: router.text },
  canRoute: (p: string) => router.available.has(p),
}));

const { directEngine, candidatesFor, clearEngineDirectorCache } = await import('../src/services/engine-director.service.js');
const { CREATIVE_CATALOG } = await import('../src/services/creative-catalog.generated.js');

const all = () => true;
const ids = (list: { id: string }[]) => list.map((e) => e.id);
// Every model the user can pick, except Grok (manual only, Weni 2026-11-14).
const catalogIds = (section: keyof typeof CREATIVE_CATALOG) => [...new Set(CREATIVE_CATALOG[section].map((e) => e.model!))].filter((id) => !/grok/i.test(id));

beforeEach(() => {
  router.text.mockReset();
  router.available = new Set(['gemini', 'dashscope', 'byteplus', 'minimax', 'xai', 'vertex']);
  clearEngineDirectorCache();
});

describe('AURA chooses from every model the user can pick', () => {
  it('offers the whole catalog for each feature when nothing limits it', () => {
    expect(ids(candidatesFor({ mode: 'text-to-image', prompt: 'x' }, all)).sort()).toEqual(catalogIds('text-to-image').sort());
    expect(ids(candidatesFor({ mode: 'image-edit', prompt: 'x' }, all)).sort()).toEqual(catalogIds('image-edit').sort());
    expect(ids(candidatesFor({ mode: 'text-to-video', prompt: 'x' }, all)).sort()).toEqual(catalogIds('text-to-video').sort());
    expect(ids(candidatesFor({ mode: 'image-to-video', prompt: 'x' }, all)).sort()).toEqual(catalogIds('image-to-video').sort());
    expect(catalogIds('text-to-image').length).toBeGreaterThanOrEqual(12);
    expect(catalogIds('text-to-video').length).toBeGreaterThanOrEqual(12);
  });

  it('never offers Grok on Auto; it stays a manual pick', () => {
    for (const mode of ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'] as const) {
      expect(ids(candidatesFor({ mode, prompt: 'x' }, all)).some((id) => /grok/i.test(id))).toBe(false);
    }
    expect(Object.values(CREATIVE_CATALOG).flat().some((e) => /grok/i.test(e.model || ''))).toBe(true);
  });

  it('attached references switch to the reference-video list', () => {
    expect(ids(candidatesFor({ mode: 'image-to-video', prompt: 'x', hasRefs: true }, all)).sort()).toEqual(catalogIds('reference-video').sort());
  });

  it('an end frame keeps only Wan 3.0 and the Seedance 2.x family', () => {
    const end = ids(candidatesFor({ mode: 'image-to-video', prompt: 'x', hasEndFrame: true }, all));
    expect(end.length).toBeGreaterThan(0);
    expect(end.every((id) => /^(wan3\.0-video|dreamina-seedance-2-)/.test(id))).toBe(true);
  });

  it('clip length, 1080p and 4K drop the models that cannot render them', () => {
    const long = candidatesFor({ mode: 'text-to-video', prompt: 'x', durationSeconds: 20 }, all);
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((c) => (c.entry.maxSeconds ?? 0) >= 20)).toBe(true);
    expect(candidatesFor({ mode: 'text-to-video', prompt: 'x', resolution: '1080p' }, all).every((c) => c.entry.supports1080 !== false)).toBe(true);
    expect(candidatesFor({ mode: 'text-to-image', prompt: 'x', imageSize: '4K' }, all).every((c) => !c.entry.maxSize || c.entry.maxSize === '4K')).toBe(true);
  });

  it('skips providers that cannot take a call right now', () => {
    const list = ids(candidatesFor({ mode: 'text-to-video', prompt: 'x' }, (p) => p !== 'byteplus'));
    expect(list.some((id) => id.includes('seedance'))).toBe(false);
    expect(list).toContain('wan3.0-video-prime');
  });
});

describe('directEngine', () => {
  it("uses AURA's pick from the list, keeps its brief, and cleans the reason", async () => {
    router.text.mockResolvedValue({ output: {
      brief: { subject: 'padel match', shots: 4, sound: 'needed' }, complexity: 'complex',
      engine: 'dreamina-seedance-2-5-260628', reason: 'Four timed shots — with sound.',
    } });
    const pick = await directEngine({ mode: 'text-to-video', prompt: '[00:00] a [00:03] b [00:06] c [00:09] d' });
    expect(pick).toMatchObject({ provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', complexity: 'complex', decidedBy: 'aura' });
    expect(pick.brief).toMatchObject({ shots: 4 });
    expect(pick.reason).not.toMatch(/[‒-―]/);
    // AURA sees every model for the feature, each with its price.
    const sent = router.text.mock.calls[0][0].prompt as string;
    for (const id of catalogIds('text-to-video')) expect(sent).toContain(`id: ${id}`);
    expect(sent).toMatch(/cost: \$0\.231\/s/);
  });

  it('an answer that is not on the list falls back to the rules', async () => {
    router.text.mockResolvedValue({ output: { engine: 'made-up-model', complexity: 'simple', reason: 'x' } });
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'FPV drone dive chasing a drift car' });
    expect(pick.decidedBy).toBe('rules');
    expect(pick.provider).not.toBe('xai');
  });

  it('an error or timeout falls back to the rules within the same limits', async () => {
    router.text.mockRejectedValue(new Error('timeout'));
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'a calm lake at dawn', durationSeconds: 25 });
    expect(pick.decidedBy).toBe('rules');
    const fit = candidatesFor({ mode: 'text-to-video', prompt: 'x', durationSeconds: 25 }, all).map((c) => c.id);
    expect(fit).toContain(pick.model);
  });

  it('when only one model fits, it is used without asking', async () => {
    router.available = new Set(['minimax']);
    const pick = await directEngine({ mode: 'image-to-video', prompt: 'x', hasRefs: true });
    expect(pick.decidedBy).toBe('only');
    expect(router.text).not.toHaveBeenCalled();
  });

  it('the same prompt and limits reuse the decision, so a regenerate keeps its model', async () => {
    router.text.mockResolvedValue({ output: { engine: 'qwen-image-3.0-pro', complexity: 'standard', reason: 'Exact menu text.' } });
    const a = await directEngine({ mode: 'text-to-image', prompt: 'Menu board with "Latte 18 AED"' });
    const b = await directEngine({ mode: 'text-to-image', prompt: 'Menu board with "Latte 18 AED"' });
    expect(a.model).toBe('qwen-image-3.0-pro');
    expect(b).toEqual(a);
    expect(router.text).toHaveBeenCalledTimes(1);
  });

  it('identical requests that start together share one AURA decision', async () => {
    let release: (v: unknown) => void = () => {};
    router.text.mockReturnValue(new Promise((r) => { release = r; }));
    const input = { mode: 'text-to-image' as const, prompt: 'Three variations of a red apple' };
    const all3 = Promise.all([directEngine(input), directEngine(input), directEngine(input)]);
    release({ output: { engine: 'qwen-image-3.0-pro', complexity: 'simple', reason: 'Simple still.' } });
    const picks = await all3;
    expect(router.text).toHaveBeenCalledTimes(1);
    expect(new Set(picks.map((p) => p.model)).size).toBe(1);
  });

  it('accepts a JSON string reply as well as an object', async () => {
    router.text.mockResolvedValue({ output: JSON.stringify({ engine: 'MiniMax-H3', complexity: 'standard', reason: 'A presenter speaks to camera.' }) });
    const pick = await directEngine({ mode: 'text-to-video', prompt: 'A presenter explains the new menu to camera' });
    expect(pick).toMatchObject({ provider: 'minimax', model: 'MiniMax-H3', decidedBy: 'aura' });
  });
});
