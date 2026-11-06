import { describe, it, expect } from 'vitest';
import {
  tokenize,
  bm25Score,
  buildDocs,
  rrfMerge,
} from '../src/services/lexical-retrieval.service.js';

describe('lexical retrieval (BM25 lane)', () => {
  it('drops stopwords and keeps the signal terms', () => {
    const t = tokenize('write a social media caption for our new service launch');
    expect(t).not.toContain('write');
    expect(t).not.toContain('for');
    expect(t).toContain('caption');
    expect(t).toContain('launch');
  });

  it('handles Arabic text', () => {
    const t = tokenize('تصميم فيديو احترافي');
    expect(t.length).toBeGreaterThan(0);
    expect(t.join(' ')).toContain('تصميم');
  });

  it('ranks the chunk that actually contains the query terms first', () => {
    const docs = buildDocs([
      { id: 'a', chunkText: 'Our ceramic coating package protects the paint for five years.', knowledgeItemId: 'k1' },
      { id: 'b', chunkText: 'We are a marketing agency in Dubai working with Gulf brands.', knowledgeItemId: 'k1' },
      { id: 'c', chunkText: 'Ceramic coating is a liquid glass layer applied to a car body.', knowledgeItemId: 'k1' },
    ]);
    const hits = bm25Score(tokenize('ceramic coating package'), docs);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain('ceramic coating package');
  });

  it('skips markup chunks entirely (JS bundles are not content)', () => {
    const docs = buildDocs([
      { id: 'a', chunkText: '<script>window.React={loading:!1}</script><div class="product">price</div>', knowledgeItemId: 'k1' },
      { id: 'b', chunkText: 'The ceramic coating package protects the paint for five years.', knowledgeItemId: 'k1' },
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('b');
  });

  it('gives no score to a chunk with no query terms in common', () => {
    const docs = buildDocs([
      { id: 'a', chunkText: 'Completely unrelated text about refrigeration cycles.', knowledgeItemId: 'k1' },
    ]);
    expect(bm25Score(tokenize('ceramic coating'), docs)).toHaveLength(0);
  });

  it('down-weights generic brand words but does not drop them', () => {
    // One corpus, so IDF is comparable across the two hits.
    const docs = buildDocs([
      { id: 'weak', chunkText: 'brand content marketing', knowledgeItemId: 'k1' },
      { id: 'both', chunkText: 'brand content marketing ceramic coating', knowledgeItemId: 'k1' },
    ]);
    const hits = bm25Score(tokenize('brand ceramic coating'), docs);
    const weak = hits.find(h => h.text === 'brand content marketing');
    const both = hits.find(h => h.text.includes('ceramic coating'));
    expect(weak).toBeDefined();
    expect(both).toBeDefined();
    // The weak terms are down-weighted, not dropped, so the chunk that also
    // carries a distinctive term wins.
    expect(both!.score).toBeGreaterThan(weak!.score);
  });
});

describe('rrfMerge', () => {
  const item = (text: string, score: number) => ({ text, score });

  it('does NOT merge by list position', () => {
    // The regression this guards: keying by index made semantic[0] and
    // lexical[0] collapse into one entry, so the fusion was a coin flip.
    const semantic = [item('SEMANTIC-ONLY', 0.9)];
    const lexical = [item('LEXICAL-ONLY', 12.5)];
    const merged = rrfMerge(semantic, lexical);
    expect(merged).toHaveLength(2);
    expect(merged.map(m => m.text).sort()).toEqual(['LEXICAL-ONLY', 'SEMANTIC-ONLY']);
  });

  it('merges the SAME chunk when both lanes return it', () => {
    const semantic = [item('SAME', 0.9)];
    const lexical = [item('SAME', 12.5)];
    const merged = rrfMerge(semantic, lexical);
    expect(merged).toHaveLength(1);
  });

  it('keeps each hit own score so the per-lane floor still applies', () => {
    const semantic = [item('SAME', 0.9)];
    const lexical = [item('SAME', 12.5)];
    const merged = rrfMerge(semantic, lexical);
    // The semantic score (cosine) is kept, NOT the BM25 score, so the
    // knowledge-enricher applies the cosine floor to it.
    expect(merged[0].score).toBe(0.9);
  });

  it('orders by fused rank, not by raw score', () => {
    const semantic = [item('A', 0.9), item('B', 0.8)];
    const lexical = [item('B', 12.5), item('C', 11.0)];
    const merged = rrfMerge(semantic, lexical);
    // B is in both lanes so it outranks A (semantic only) and C (lexical only).
    expect(merged[0].text).toBe('B');
  });
});
