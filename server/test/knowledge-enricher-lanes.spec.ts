import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  retrieveContext: vi.fn(),
  knowledgeItemCount: vi.fn(),
  memoryCount: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryUpdateMany: vi.fn(),
}));

vi.mock('../src/db/prisma.js', () => ({
  db: {
    knowledgeItem: { count: h.knowledgeItemCount },
    memory: { count: h.memoryCount, findMany: h.memoryFindMany, updateMany: h.memoryUpdateMany },
  },
}));

vi.mock('../src/services/retrieval.service.js', () => ({
  retrieveContext: (...args: any[]) => h.retrieveContext(...args),
}));

vi.mock('../src/services/memory.service.js', () => ({
  retrieveMemories: vi.fn(),
}));

vi.mock('../src/lib/enrichment-stats.js', () => ({
  recordGated: vi.fn(),
  recordRan: vi.fn(),
  recordFailed: vi.fn(),
}));

import { enrichWithKnowledge } from '../src/lib/knowledge-enricher.js';

describe('knowledge enricher — per-lane score floors', () => {
  beforeEach(() => {
    h.retrieveContext.mockReset();
    h.knowledgeItemCount.mockReset();
    h.knowledgeItemCount.mockResolvedValue(1);
  });

  it('keeps a LEXICAL hit that is below the cosine floor', async () => {
    // BM25 scores live on a different scale from cosine. A lexical hit of
    // 0.8 is a strong keyword match; filtering it on a 0.55 cosine floor
    // would throw away every hit the lexical lane produces.
    h.retrieveContext.mockResolvedValue([
      { text: 'ADIB Share Covered Card welcome offer details', score: 0.8, knowledgeItemId: 'k1', mode: 'lexical' },
    ]);

    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'share covered card offer');

    expect(out).toContain('[KNOWLEDGE BASE');
    expect(out).toContain('ADIB Share Covered Card welcome offer details');
  });

  it('drops a SEMANTIC hit that is below the cosine floor', async () => {
    h.retrieveContext.mockResolvedValue([
      { text: 'weak semantic match', score: 0.42, knowledgeItemId: 'k1', mode: 'semantic' },
    ]);

    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'share covered card offer');

    expect(out).not.toContain('[KNOWLEDGE BASE');
    expect(out).toBe('WRITE A POST');
  });

  it('keeps a SEMANTIC hit above the cosine floor', async () => {
    h.retrieveContext.mockResolvedValue([
      { text: 'strong semantic match', score: 0.78, knowledgeItemId: 'k1', mode: 'semantic' },
    ]);

    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'share covered card offer');

    expect(out).toContain('strong semantic match');
  });

  it('drops a lexical hit with a zero score', async () => {
    h.retrieveContext.mockResolvedValue([
      { text: 'no keyword match at all', score: 0, knowledgeItemId: 'k1', mode: 'lexical' },
    ]);

    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'share covered card offer');

    expect(out).toBe('WRITE A POST');
  });

  it('leaves the prompt untouched when retrieval fails', async () => {
    h.retrieveContext.mockRejectedValue(new Error('boom'));

    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'q');

    expect(out).toBe('WRITE A POST');
  });

  it('leaves the prompt untouched when skipped', async () => {
    const out = await enrichWithKnowledge('WRITE A POST', 'org1', 'c1', 'q', { skip: true });
    expect(out).toBe('WRITE A POST');
    expect(h.retrieveContext).not.toHaveBeenCalled();
  });
});
