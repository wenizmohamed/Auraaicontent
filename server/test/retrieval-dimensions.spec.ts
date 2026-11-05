// RAG retrieval correctness (2026-11-05).
//
// The bug this pins: when the Gemini embedding key hit a transient 402, the
// DashScope fallback returned a 1024-dim vector while the stored chunk
// vectors are 3072-dim. cosineSimilarity's length guard returned 0 for every
// chunk, so the "top-K" was simply the first K chunks in arbitrary order —
// a query for "ceramic coating" served CSS boilerplate and the lead-gen pack.
// Two fixes guard it:
//   1. gemini.service.dashscopeEmbed refuses to serve a vector whose length
//      does not match the store (different embedding space).
//   2. retrieval.service skips mismatched chunks and returns [] rather than
//      unranked noise.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/prisma.js', () => ({
  db: {
    knowledgeItem: { findMany: vi.fn() },
  },
}));

vi.mock('../src/services/gemini.service.js', () => ({
  embedText: vi.fn(),
}));

import { db } from '../src/db/prisma.js';
import { embedText } from '../src/services/gemini.service.js';
import { retrieveContext } from '../src/services/retrieval.service.js';

const QUERY_VEC = new Array(3072).fill(0.01);
const OTHER_VEC = new Array(1024).fill(0.02);

function chunkWith(text: string, embedding: number[]) {
  return { id: 'c1', chunkText: text, metadata: { embedding } };
}

describe('retrieval: embedding-dimension guard', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
    vi.mocked(db.knowledgeItem.findMany).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('ranks chunks by cosine similarity when the dimensions match', async () => {
    vi.mocked(embedText).mockResolvedValue(QUERY_VEC);
    const near = QUERY_VEC.slice();
    near[0] = 5; // strongly aligned
    const far = QUERY_VEC.slice();
    far[0] = -5; // opposed
    vi.mocked(db.knowledgeItem.findMany).mockResolvedValue([
      { id: 'i1', chunks: [chunkWith('relevant', near), chunkWith('irrelevant', far)] },
    ] as any);

    const hits = await retrieveContext('org', 'client', 'ceramic coating', 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toBe('relevant');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('returns NO chunks when every stored vector is a different dimension', async () => {
    // This is the exact production failure: a 1024-dim fallback vector
    // against a 3072-dim store.
    vi.mocked(embedText).mockResolvedValue(OTHER_VEC);
    vi.mocked(db.knowledgeItem.findMany).mockResolvedValue([
      { id: 'i1', chunks: [chunkWith('css boilerplate', QUERY_VEC), chunkWith('lead-gen pack', QUERY_VEC)] },
    ] as any);

    const hits = await retrieveContext('org', 'client', 'ceramic coating', 5);
    expect(hits).toEqual([]);
  });

  it('skips mismatched chunks but still ranks the comparable ones', async () => {
    vi.mocked(embedText).mockResolvedValue(QUERY_VEC);
    const near = QUERY_VEC.slice();
    near[0] = 5;
    vi.mocked(db.knowledgeItem.findMany).mockResolvedValue([
      { id: 'i1', chunks: [chunkWith('wrong space', OTHER_VEC), chunkWith('right space', near)] },
    ] as any);

    const hits = await retrieveContext('org', 'client', 'query', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('right space');
  });

  it('returns [] when the client has no embedded chunks at all', async () => {
    vi.mocked(embedText).mockResolvedValue(QUERY_VEC);
    vi.mocked(db.knowledgeItem.findMany).mockResolvedValue([
      { id: 'i1', chunks: [chunkWith('no embedding', undefined as any)] },
    ] as any);

    const hits = await retrieveContext('org', 'client', 'query', 5);
    expect(hits).toEqual([]);
  });
});
