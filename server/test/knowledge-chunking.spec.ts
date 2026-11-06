// Knowledge corpus integrity (2026-11-05).
//
// Two defects this pins:
//
// 1. CHUNK SIZE. The chunker used 800-token (3,200-char) windows. Measured
//    on the prod store with short phrase queries, the TRUE chunk averaged
//    0.561 while IRRELEVANT chunks averaged 0.611 — noise outranked truth,
//    so no threshold could separate them, and the production gauge showed
//    knowledge injecting 0 chunks (lastInjectedAt: null). The same query
//    ranked the true content first at 84% for 200-char windows vs 26% for
//    3,200-char ones.
//
// 2. HONEST STAMPS. `embedKnowledgeItem` stamped `embedded: true` when
//    `chunksCreated > 0` — counting CHUNKS, not EMBEDDINGS. An item whose
//    every chunk failed to embed (a Gemini 429/402 window) was still shown
//    as "ready" while being invisible to RAG. That is how 86% of the prod
//    corpus ended up unsearchable with nothing surfacing it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The worker pulls in the provider chain, which reads config/env at import
// time and requires DATABASE_URL/JWT_SECRET. Stub the module so the test
// runs without a database (the chunking + stamp logic needs neither).
vi.mock('../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test', PORT: 8080,
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'test-secret',
    GEMINI_API_KEY: '', DASHSCOPE_API_KEY: '', XAI_API_KEY: '',
  },
}));

vi.mock('../src/db/prisma.js', () => ({
  db: {
    knowledgeChunk: { create: vi.fn(), deleteMany: vi.fn() },
    knowledgeItem: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('../src/services/gemini.service.js', () => ({
  embedText: vi.fn(),
}));

vi.mock('../src/services/knowledge.service.js', () => ({
  knowledgeService: { getById: vi.fn() },
}));

vi.mock('../src/services/storage.service.js', () => ({
  storageService: { saveFile: vi.fn(), deleteFile: vi.fn() },
}));

import { db } from '../src/db/prisma.js';
import { embedText } from '../src/services/gemini.service.js';
import { knowledgeService } from '../src/services/knowledge.service.js';
import { embedKnowledgeItem } from '../src/workers/embeddings.worker.js';

const ORG = 'org_radix_media';
const ITEM = 'item-1';
const VEC = new Array(3072).fill(0.01);

describe('chunking: granularity is fine enough to retrieve', () => {
  it('splits a long document into chunks of at most 200 tokens (~800 chars)', async () => {
    const longText = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} with some words in it.`).join('\n\n');
    vi.mocked(knowledgeService.getById).mockResolvedValue({
      id: ITEM, clientId: 'c1', title: 'doc', type: 'text/plain',
      textContent: longText, fileUrl: null,
    } as any);
    vi.mocked(embedText).mockResolvedValue(VEC);
    vi.mocked(db.knowledgeChunk.create).mockResolvedValue({} as any);
    vi.mocked(db.knowledgeChunk.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.knowledgeItem.update).mockResolvedValue({} as any);
    vi.mocked(db.knowledgeItem.findUnique).mockResolvedValue({ metadata: {} } as any);

    await embedKnowledgeItem(ORG, ITEM);

    const created = vi.mocked(db.knowledgeChunk.create).mock.calls.map(c => c[0].data.chunkText);
    expect(created.length).toBeGreaterThan(1);
    for (const t of created) {
      // 200-token chunks with a 50-token overlap: the longest window a
      // paragraph split can produce is maxChars + one paragraph.
      expect(t.length).toBeLessThan(4000);
    }
    // And they are far smaller than the old 3,200-char chunks.
    const avg = created.reduce((s, t) => s + t.length, 0) / created.length;
    expect(avg).toBeLessThan(1200);
  });
});

describe('item stamp: reflects embeddings, not chunks', () => {
  beforeEach(() => {
    vi.mocked(db.knowledgeChunk.create).mockResolvedValue({} as any);
    vi.mocked(db.knowledgeChunk.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.knowledgeItem.update).mockResolvedValue({} as any);
    vi.mocked(db.knowledgeItem.findUnique).mockResolvedValue({ metadata: {} } as any);
  });
  afterEach(() => vi.clearAllMocks());

  it('stamps embedded:false when EVERY chunk failed to embed', async () => {
    vi.mocked(knowledgeService.getById).mockResolvedValue({
      id: ITEM, clientId: 'c1', title: 'doc', type: 'text/plain',
      textContent: 'Some content that will not embed because the provider is down.',
      fileUrl: null,
    } as any);
    vi.mocked(embedText).mockRejectedValue(new Error('Gemini rate-limited. Knowledge embedding temporarily unavailable.'));

    await embedKnowledgeItem(ORG, ITEM);

    const stamp = vi.mocked(db.knowledgeItem.update).mock.calls.at(-1)?.[0].data.metadata;
    expect(stamp.embedded).toBe(false);
    expect(stamp.readError).toBeTruthy();
  });

  it('stamps embedded:true with the real embedding count when all chunks embed', async () => {
    vi.mocked(knowledgeService.getById).mockResolvedValue({
      id: ITEM, clientId: 'c1', title: 'doc', type: 'text/plain',
      textContent: 'Short content that embeds fine.',
      fileUrl: null,
    } as any);
    vi.mocked(embedText).mockResolvedValue(VEC);

    await embedKnowledgeItem(ORG, ITEM);

    const stamp = vi.mocked(db.knowledgeItem.update).mock.calls.at(-1)?.[0].data.metadata;
    expect(stamp.embedded).toBe(true);
    expect(stamp.embeddings).toBe(stamp.chunks);
    expect(stamp.readError).toBeNull();
  });
});
