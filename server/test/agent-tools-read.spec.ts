// Agent read tools (calendar_read, asset_search) -- schema + contract tests.
//
// No database: the prisma module is mocked before the tools are imported
// (calendar_read pulls normalizeMonth from brief.service, whose module chain
// reaches db/prisma). Handler behavior is exercised with in-memory fakes so
// we pin the contracts that matter to the loop:
//   * input_schema is well formed (object type, typed properties, any
//     `required` entries actually exist in properties)
//   * tool names and handlers exist and match the file's purpose
//   * failure modes return { error } objects instead of throwing, so a bad
//     lookup never burns an agent iteration on a raw Prisma exception
//   * calendar_read bridges both month formats ("July 2026" vs "2026-07")
//
// Run:  npx vitest run test/agent-tools-read.spec.ts

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/prisma.js', () => ({ db: {}, systemDb: {} }));

const { tool: calendarRead } = await import('../src/agent/tools/calendar_read.js');
const { tool: assetSearch } = await import('../src/agent/tools/asset_search.js');

// Minimal ToolContext fake; prisma is swapped per test.
function makeCtx(prisma: unknown, clientId: string | null = null) {
  return {
    sessionUid: 'sess-uid',
    sessionId: 'sess-id',
    orgId: 'org-1',
    userId: 'user-1',
    clientId,
    prisma: prisma as never,
    emit: vi.fn(async () => undefined),
    signal: new AbortController().signal,
  };
}

function assertWellFormedSchema(schema: {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}) {
  expect(schema.type).toBe('object');
  expect(schema.additionalProperties).toBe(false);
  const propNames = Object.keys(schema.properties);
  expect(propNames.length).toBeGreaterThan(0);
  for (const name of propNames) {
    const prop = schema.properties[name] as Record<string, unknown>;
    expect(typeof prop, `property ${name} must be an object`).toBe('object');
    expect(typeof prop.type, `property ${name} must declare a type`).toBe('string');
  }
  for (const req of schema.required ?? []) {
    expect(propNames, `required field ${req} must exist in properties`).toContain(req);
  }
}

describe('calendar_read schema', () => {
  it('has the right name, a description and a handler', () => {
    expect(calendarRead.name).toBe('calendar_read');
    expect(calendarRead.description.length).toBeGreaterThan(20);
    expect(typeof calendarRead.handler).toBe('function');
  });

  it('has a well-formed input_schema with all-optional typed inputs', () => {
    assertWellFormedSchema(calendarRead.input_schema);
    expect(Object.keys(calendarRead.input_schema.properties).sort()).toEqual(
      ['clientId', 'limit', 'month', 'status'],
    );
    // Every input is optional: clientId falls back to the session client.
    expect(calendarRead.input_schema.required ?? []).toEqual([]);
    expect((calendarRead.input_schema.properties.limit as { type: string }).type).toBe('number');
    expect((calendarRead.input_schema.properties.month as { type: string }).type).toBe('string');
  });
});

describe('asset_search schema', () => {
  it('has the right name, a description and a handler', () => {
    expect(assetSearch.name).toBe('asset_search');
    expect(assetSearch.description.length).toBeGreaterThan(20);
    expect(typeof assetSearch.handler).toBe('function');
  });

  it('has a well-formed input_schema with all-optional typed inputs', () => {
    assertWellFormedSchema(assetSearch.input_schema);
    expect(Object.keys(assetSearch.input_schema.properties).sort()).toEqual(
      ['clientId', 'limit', 'query', 'tags'],
    );
    expect(assetSearch.input_schema.required ?? []).toEqual([]);
    expect((assetSearch.input_schema.properties.tags as { type: string }).type).toBe('array');
  });
});

describe('calendar_read handler contract', () => {
  it('returns an error object (does not throw) when no client is resolvable', async () => {
    const result = await calendarRead.handler({}, makeCtx({}) as never);
    expect(result.error).toMatch(/clientId/i);
  });

  it('returns an error object when the client is not in the org', async () => {
    const prisma = { client: { findUnique: vi.fn(async () => null) } };
    const result = await calendarRead.handler({ clientId: 'c-ghost' }, makeCtx(prisma) as never);
    expect(result.error).toMatch(/not found/i);
    expect(prisma.client.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
  });

  it('bridges month formats: stored "July 2026" matches requested "2026-07"', async () => {
    const prisma = {
      client: { findUnique: vi.fn(async () => ({ id: 'c-1', name: 'Acme' })) },
      calendarMonth: {
        findMany: vi.fn(async () => [
          { id: 'cm-1', month: 'July 2026', status: 'approved', _count: { posts: 2 } },
        ]),
      },
      calendarPost: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async () => [
          {
            id: 'p-1', date: '2026-07-03', platform: 'instagram', format: 'reel',
            title: 'Launch teaser', caption: 'x'.repeat(400), status: 'draft',
            hashtags: ['#launch', '#uae'], _count: { assets: 1 },
          },
          {
            id: 'p-2', date: '2026-07-10', platform: 'linkedin', format: 'static',
            title: 'Founder note', caption: 'short one', status: 'approved',
            hashtags: null, _count: { assets: 0 },
          },
        ]),
      },
    };
    const result = await calendarRead.handler({ month: '2026-07' }, makeCtx(prisma, 'c-1') as never);
    expect(result.error).toBeUndefined();
    expect(result.month).toBe('2026-07');
    expect(result.totalPosts).toBe(2);
    expect(result.posts).toHaveLength(2);
    const [p1, p2] = result.posts!;
    expect(p1.id).toBe('p-1');
    expect(p1.caption.length).toBeLessThan(400); // truncated for payload size
    expect(p1.hasAsset).toBe(true);
    expect(p1.hashtags).toEqual(['#launch', '#uae']);
    expect(p2.hasAsset).toBe(false);
    expect(p2.hashtags).toEqual([]);
    // Post query stayed org-scoped.
    expect(prisma.calendarPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', calendarMonthId: 'cm-1' }) }),
    );
  });

  it('returns available months plus an error when the month does not exist', async () => {
    const prisma = {
      client: { findUnique: vi.fn(async () => ({ id: 'c-1', name: 'Acme' })) },
      calendarMonth: {
        findMany: vi.fn(async () => [
          { id: 'cm-1', month: '2026-06', status: 'draft', _count: { posts: 5 } },
        ]),
      },
    };
    const result = await calendarRead.handler({ month: 'December 2030' }, makeCtx(prisma, 'c-1') as never);
    expect(result.error).toMatch(/not found/i);
    expect(result.months).toHaveLength(1);
    expect(result.months![0].monthKey).toBe('2026-06');
  });

  it('wraps a thrown Prisma error into { error } instead of rethrowing', async () => {
    const prisma = {
      client: { findUnique: vi.fn(async () => { throw new Error('P1001 cannot reach database'); }) },
    };
    const result = await calendarRead.handler({ clientId: 'c-1' }, makeCtx(prisma) as never);
    expect(result.error).toMatch(/Calendar read failed/);
  });
});

describe('asset_search handler contract', () => {
  const rows = [
    {
      id: 'a-1', name: 'Ramadan hero banner', fileUrl: 'https://x/a1.png', thumbUrl: 'https://x/a1_t.png',
      mimeType: 'image/png', tags: ['ramadan', 'banner'], createdAt: new Date('2026-07-01T00:00:00Z'),
    },
    {
      id: 'a-2', name: 'Logo pack', fileUrl: 'https://x/a2.zip', thumbUrl: null,
      mimeType: 'application/zip', tags: 'logo, brand', createdAt: new Date('2026-06-01T00:00:00Z'),
    },
    {
      id: 'a-3', name: 'Product flat lay', fileUrl: 'https://x/a3.jpg', thumbUrl: 'https://x/a3_t.jpg',
      mimeType: 'image/jpeg', tags: null, createdAt: new Date('2026-05-01T00:00:00Z'),
    },
  ];

  function assetPrisma(data = rows) {
    return {
      client: { findUnique: vi.fn(async () => ({ id: 'c-1', name: 'Acme' })) },
      asset: { findMany: vi.fn(async () => data) },
    };
  }

  it('returns an error object when no client is resolvable', async () => {
    const result = await assetSearch.handler({}, makeCtx({}) as never);
    expect(result.error).toMatch(/clientId/i);
    expect(result.assets).toEqual([]);
  });

  it('empty query returns most recent assets with normalized tags', async () => {
    const prisma = assetPrisma();
    const result = await assetSearch.handler({}, makeCtx(prisma, 'c-1') as never);
    expect(result.error).toBeUndefined();
    expect(result.total).toBe(3);
    expect(result.assets.map((a) => a.id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(result.assets[1].tags).toEqual(['logo', 'brand']); // comma-string Json normalized
    expect(result.assets[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', clientId: 'c-1' }) }),
    );
  });

  it('query matches names and tags, case-insensitive', async () => {
    const byName = await assetSearch.handler({ query: 'LOGO' }, makeCtx(assetPrisma(), 'c-1') as never);
    expect(byName.assets.map((a) => a.id)).toEqual(['a-2']);
    const byTag = await assetSearch.handler({ query: 'ramadan' }, makeCtx(assetPrisma(), 'c-1') as never);
    expect(byTag.assets.map((a) => a.id)).toEqual(['a-1']);
  });

  it('tags filter keeps assets carrying at least one wanted tag', async () => {
    const result = await assetSearch.handler({ tags: ['banner', 'nope'] }, makeCtx(assetPrisma(), 'c-1') as never);
    expect(result.assets.map((a) => a.id)).toEqual(['a-1']);
  });

  it('no matches returns an empty list with a note, not an error', async () => {
    const result = await assetSearch.handler({ query: 'zzz-none' }, makeCtx(assetPrisma(), 'c-1') as never);
    expect(result.error).toBeUndefined();
    expect(result.assets).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.note).toMatch(/No assets matched/);
  });

  it('respects the limit cap', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `a-${i}`, name: `Asset ${i}`, fileUrl: `https://x/${i}.png`, thumbUrl: null,
      mimeType: 'image/png', tags: [], createdAt: new Date(2026, 0, 1 + i),
    }));
    const result = await assetSearch.handler({ limit: 500 }, makeCtx(assetPrisma(many), 'c-1') as never);
    expect(result.assets.length).toBe(50); // cap
    expect(result.total).toBe(60);
  });

  it('wraps a thrown Prisma error into { error } instead of rethrowing', async () => {
    const prisma = {
      client: { findUnique: vi.fn(async () => ({ id: 'c-1', name: 'Acme' })) },
      asset: { findMany: vi.fn(async () => { throw new Error('P2021 table missing'); }) },
    };
    const result = await assetSearch.handler({}, makeCtx(prisma, 'c-1') as never);
    expect(result.error).toMatch(/Asset search failed/);
  });
});
