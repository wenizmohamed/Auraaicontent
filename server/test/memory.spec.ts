// Experiential-memory loop — proves the capture → store → retrieve → inject
// path actually runs, end to end, WITHOUT a database. The prod DB + Gemini are
// replaced with deterministic in-memory fakes so we exercise the REAL
// recordMemory / retrieveMemories / enrichWithMemory logic (cosine scoring,
// tenant OR-scoping, weight, minScore, topK, the cheap zero-count gate, the
// injected-block format, and the retrieval-health counters).
//
// Why this matters: every other check so far was `tsc` (compiles) — this is the
// first time a memory is written and read back. tsc can't catch a broken cosine,
// a tenant leak in the OR filter, a wrong injected-block shape, or a stats
// counter that never increments.
//
// Run:  npm test -- memory.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Deterministic embedding fake ────────────────────────────────
// Bag-of-words vector: shared tokens → high cosine, disjoint → ~0. Real enough
// to validate minScore filtering and ranking without calling Gemini.
const DIM = 64;
function fakeEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const tok of text.toLowerCase().match(/[a-z؀-ۿ]+/g) ?? []) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

// ─── In-memory Prisma fake (only the Memory + knowledgeItem surface used) ──
interface Row { [k: string]: any }
const store: Row[] = [];
let idSeq = 0;

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.clientId !== undefined && row.clientId !== where.clientId) return false;
  if (Array.isArray(where.OR)) {
    const ok = where.OR.some((c: any) => {
      if ('clientId' in c) return row.clientId === c.clientId;
      return matches(row, c);
    });
    if (!ok) return false;
  }
  if (Array.isArray(where.AND)) {
    for (const and of where.AND) {
      const ok = (and.OR as any[]).some((c) => {
        if ('expiresAt' in c) {
          if (c.expiresAt === null) return row.expiresAt == null;
          if (c.expiresAt?.gt) return row.expiresAt != null && row.expiresAt > c.expiresAt.gt;
        }
        return false;
      });
      if (!ok) return false;
    }
  }
  return true;
}

const dbFake = {
  memory: {
    create: vi.fn(async ({ data }: any) => {
      const row: Row = {
        id: `mem_${++idSeq}`,
        status: 'active',
        useCount: 0,
        lastUsedAt: null,
        weight: 1,
        clientId: null,
        userId: null,
        context: null,
        expiresAt: null,
        ...data,
      };
      store.push(row);
      return { id: row.id };
    }),
    findMany: vi.fn(async ({ where, take }: any) => {
      const out = store.filter((r) => matches(r, where));
      return (take ? out.slice(0, take) : out).map((r) => ({ ...r }));
    }),
    count: vi.fn(async ({ where }: any) => store.filter((r) => matches(r, where)).length),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  // memory-enricher also calls db.memory.count; knowledgeItem unused here.
};

vi.mock('../src/db/prisma.js', () => ({ db: dbFake, systemDb: dbFake }));
vi.mock('../src/services/gemini.service.js', () => ({
  embedText: vi.fn(async (t: string) => fakeEmbed(t)),
}));

beforeEach(() => {
  store.length = 0;
  idSeq = 0;
});

describe('memory loop — record → retrieve', () => {
  it('writes a row and reads it back on a relevant query', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    const id = await recordMemory({
      orgId: 'org1', clientId: 'cliA', kind: 'preference', source: 'explicit',
      content: 'Always include a clear call to action in every caption',
    });
    expect(id).toBeTruthy();
    expect(store).toHaveLength(1);
    expect(Array.isArray(store[0].embedding)).toBe(true); // embedding cached

    const hits = await retrieveMemories('org1', 'cliA', 'write a caption with a call to action', 6, 0.3);
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain('call to action');
    expect(hits[0].score).toBeGreaterThan(0.3);
  });

  it('does NOT leak another client\'s client-scoped learning', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    await recordMemory({ orgId: 'org1', clientId: 'cliA', kind: 'correction', source: 'rejection', content: 'tone must be formal arabic' });
    await recordMemory({ orgId: 'org1', clientId: 'cliB', kind: 'correction', source: 'rejection', content: 'tone must be formal arabic' });

    const hits = await retrieveMemories('org1', 'cliA', 'what tone should the formal arabic copy use', 6, 0.3);
    expect(hits).toHaveLength(1); // only cliA's row, never cliB's
  });

  it('surfaces org-wide (clientId=null) learnings to any client', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    await recordMemory({ orgId: 'org1', clientId: null, kind: 'pattern', source: 'consolidation', content: 'avoid emoji spam in headlines' });
    const hits = await retrieveMemories('org1', 'cliZ', 'should headlines use lots of emoji', 6, 0.3);
    expect(hits).toHaveLength(1);
  });

  it('never returns another ORG\'s learnings', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    await recordMemory({ orgId: 'orgX', clientId: null, kind: 'preference', source: 'explicit', content: 'always include a call to action' });
    const hits = await retrieveMemories('orgY', null, 'include a call to action please', 6, 0.3);
    expect(hits).toHaveLength(0);
  });

  it('weight scales score (cosine * weight); minScore floor filters', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    await recordMemory({ orgId: 'o', clientId: null, kind: 'preference', source: 'explicit', content: 'use vibrant brand colors', weight: 2 });
    const hi = await retrieveMemories('o', null, 'vibrant brand colors', 6, 0.0);
    expect(hi[0].score).toBeGreaterThan(1); // cosine(~1) * weight(2)

    // A floor above the achievable score yields nothing.
    const none = await retrieveMemories('o', null, 'completely unrelated quantum topic', 6, 0.5);
    expect(none).toHaveLength(0);
  });

  it('excludes expired (TTL) learnings', async () => {
    const { recordMemory, retrieveMemories } = await import('../src/services/memory.service.js');
    await recordMemory({ orgId: 'o', clientId: null, kind: 'preference', source: 'explicit', content: 'seasonal ramadan greeting tone', expiresAt: new Date(Date.now() - 1000) });
    const hits = await retrieveMemories('o', null, 'ramadan greeting tone', 6, 0.0);
    expect(hits).toHaveLength(0);
  });
});

describe('memory enricher — gating, injection, health counters', () => {
  it('cheap-gates (no retrieval) when the org has zero memories', async () => {
    const { enrichWithMemory } = await import('../src/lib/memory-enricher.js');
    const { getEnrichmentHealth } = await import('../src/lib/enrichment-stats.js');
    const before = getEnrichmentHealth().find((s) => s.type === 'memory')!.ran;
    const out = await enrichWithMemory('write a post', 'emptyOrg', null, 'write a post');
    expect(out).toBe('write a post'); // unchanged
    const after = getEnrichmentHealth().find((s) => s.type === 'memory')!.ran;
    expect(after).toBe(before); // never ran a retrieval round-trip
  });

  it('injects the learned-feedback block and records an injection', async () => {
    const { recordMemory } = await import('../src/services/memory.service.js');
    const { enrichWithMemory } = await import('../src/lib/memory-enricher.js');
    const { getEnrichmentHealth } = await import('../src/lib/enrichment-stats.js');
    await recordMemory({ orgId: 'org1', clientId: 'cliA', kind: 'correction', source: 'rejection', content: 'say affordable not cheap' });

    const injBefore = getEnrichmentHealth().find((s) => s.type === 'memory')!.injected;
    const prompt = 'always say affordable not cheap pricing';
    const out = await enrichWithMemory(prompt, 'org1', 'cliA', prompt);
    expect(out).toContain('[LEARNED FROM PAST FEEDBACK');
    expect(out).toContain('[correction]');
    expect(out).toContain('say affordable');
    expect(out).toContain(prompt); // original prompt preserved AFTER the block
    expect(out.indexOf('[LEARNED FROM PAST FEEDBACK')).toBeLessThan(out.indexOf(prompt));

    const injAfter = getEnrichmentHealth().find((s) => s.type === 'memory')!.injected;
    expect(injAfter).toBe(injBefore + 1);
  });

  it('skip flag short-circuits', async () => {
    const { enrichWithMemory } = await import('../src/lib/memory-enricher.js');
    const out = await enrichWithMemory('hello', 'org1', 'cliA', 'hello', { skip: true });
    expect(out).toBe('hello');
  });
});
