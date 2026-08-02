// Agent action tools (web_research, post_schedule) -- schema + contract tests.
//
// No database, no network: prisma, the AI router and the source verifier are
// mocked before the tools are imported (same pattern as
// agent-tools-read.spec.ts). Pins the contracts that matter to the loop:
//   * both input_schemas are well formed (object type, typed properties, any
//     `required` entries actually exist in properties)
//   * post_schedule refuses a past scheduledAt via the pure
//     parseFutureScheduleTime helper AND through the handler, without ever
//     touching the database
//   * failure modes return { error } objects instead of throwing
//   * post_schedule keeps every query org-scoped and proves a supplied
//     platformConnectionId is in-org before writing it
//   * web_research drops loopback/LAN source URLs before verification (SSRF)
//
// Run:  npx vitest run test/agent-tools-action.spec.ts

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/prisma.js', () => ({ db: {}, systemDb: {} }));

const aiText = vi.fn();
vi.mock('../src/services/providers/ai-router.js', () => ({ aiRouter: { text: aiText } }));

// Pass-through verifier: marks everything verified, fetches nothing.
vi.mock('../src/services/source-verify.service.js', () => ({
  verifySources: vi.fn(async (sources: Array<Record<string, unknown>>) =>
    sources.map((s) => ({ ...s, verified: true }))),
}));

const { tool: webResearch } = await import('../src/agent/tools/web_research.js');
const { tool: postSchedule, parseFutureScheduleTime } = await import('../src/agent/tools/post_schedule.js');

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

describe('web_research schema', () => {
  it('has the right name, a description and a handler', () => {
    expect(webResearch.name).toBe('web_research');
    expect(webResearch.description.length).toBeGreaterThan(20);
    expect(typeof webResearch.handler).toBe('function');
  });

  it('has a well-formed input_schema requiring only query', () => {
    assertWellFormedSchema(webResearch.input_schema);
    expect(Object.keys(webResearch.input_schema.properties).sort()).toEqual(
      ['depth', 'maxSources', 'query'],
    );
    expect(webResearch.input_schema.required).toEqual(['query']);
    expect((webResearch.input_schema.properties.depth as { enum: string[] }).enum).toEqual(
      ['quick', 'deep'],
    );
    expect((webResearch.input_schema.properties.maxSources as { type: string }).type).toBe('number');
  });
});

describe('post_schedule schema', () => {
  it('has the right name, a description and a handler', () => {
    expect(postSchedule.name).toBe('post_schedule');
    expect(postSchedule.description.length).toBeGreaterThan(20);
    expect(typeof postSchedule.handler).toBe('function');
  });

  it('has a well-formed input_schema requiring postId and scheduledAt', () => {
    assertWellFormedSchema(postSchedule.input_schema);
    expect(Object.keys(postSchedule.input_schema.properties).sort()).toEqual(
      ['platformConnectionId', 'postId', 'scheduledAt'],
    );
    expect(postSchedule.input_schema.required).toEqual(['postId', 'scheduledAt']);
  });
});

describe('parseFutureScheduleTime (pure)', () => {
  const now = new Date('2026-08-02T12:00:00Z');

  it('rejects a missing or empty value', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      const res = parseFutureScheduleTime(bad, now);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/scheduledAt/);
    }
  });

  it('rejects an unparseable datetime', () => {
    const res = parseFutureScheduleTime('tomorrow-ish', now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not a valid ISO datetime/);
  });

  it('rejects a past datetime with a clear message', () => {
    const res = parseFutureScheduleTime('2026-08-01T09:00:00Z', now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/in the past/);
  });

  it('rejects exactly-now (strictly future only)', () => {
    const res = parseFutureScheduleTime('2026-08-02T12:00:00Z', now);
    expect(res.ok).toBe(false);
  });

  it('accepts a future datetime and returns the parsed Date', () => {
    const res = parseFutureScheduleTime('2026-08-15T09:00:00Z', now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.date.toISOString()).toBe('2026-08-15T09:00:00.000Z');
  });
});

describe('post_schedule handler contract', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  it('rejects a past scheduledAt without touching the database', async () => {
    // prisma is an empty object: any query would TypeError, so a passing
    // test proves the refusal happens before any DB access.
    const result = await postSchedule.handler(
      { postId: 'p-1', scheduledAt: '2020-01-01T00:00:00Z' },
      makeCtx({}) as never,
    );
    expect(result.scheduled).toBe(false);
    expect(result.error).toMatch(/in the past/);
  });

  it('returns an error object when the post is not in the org', async () => {
    const prisma = { calendarPost: { findUnique: vi.fn(async () => null) } };
    const result = await postSchedule.handler(
      { postId: 'p-ghost', scheduledAt: future },
      makeCtx(prisma) as never,
    );
    expect(result.scheduled).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(prisma.calendarPost.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
  });

  it('refuses a platformConnectionId that is not in the org', async () => {
    const prisma = {
      calendarPost: {
        findUnique: vi.fn(async () => ({
          id: 'p-1', title: 'T', platform: 'instagram',
          calendarMonth: { clientId: 'c-1' },
        })),
        update: vi.fn(),
      },
      platformConnection: { findFirst: vi.fn(async () => null) },
    };
    const result = await postSchedule.handler(
      { postId: 'p-1', scheduledAt: future, platformConnectionId: 'conn-foreign' },
      makeCtx(prisma, 'c-1') as never,
    );
    expect(result.scheduled).toBe(false);
    expect(result.error).toMatch(/connection not found/i);
    expect(prisma.platformConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
    expect(prisma.calendarPost.update).not.toHaveBeenCalled();
  });

  it('refuses to schedule another client\'s post when the session is pinned', async () => {
    const prisma = {
      calendarPost: {
        findUnique: vi.fn(async () => ({
          id: 'p-1', title: 'T', platform: 'instagram',
          calendarMonth: { clientId: 'c-other' },
        })),
        update: vi.fn(),
      },
    };
    const result = await postSchedule.handler(
      { postId: 'p-1', scheduledAt: future },
      makeCtx(prisma, 'c-1') as never,
    );
    expect(result.scheduled).toBe(false);
    expect(result.error).toMatch(/different client/i);
    expect(prisma.calendarPost.update).not.toHaveBeenCalled();
  });

  it('schedules: sets scheduledAt, status "scheduled", clears scheduleError, org-scoped update', async () => {
    const when = new Date(future);
    const prisma = {
      calendarPost: {
        findUnique: vi.fn(async () => ({
          id: 'p-1', title: 'Launch teaser', platform: 'instagram',
          calendarMonth: { clientId: 'c-1' },
        })),
        update: vi.fn(async () => ({
          id: 'p-1', status: 'scheduled', scheduledAt: when, platformConnectionId: 'conn-1',
        })),
      },
      platformConnection: { findFirst: vi.fn(async () => ({ id: 'conn-1' })) },
    };
    const ctx = makeCtx(prisma, 'c-1');
    const result = await postSchedule.handler(
      { postId: 'p-1', scheduledAt: future, platformConnectionId: 'conn-1' },
      ctx as never,
    );
    expect(result.error).toBeUndefined();
    expect(result.scheduled).toBe(true);
    expect(result.status).toBe('scheduled');
    expect(result.scheduledAt).toBe(when.toISOString());
    expect(result.platformConnectionId).toBe('conn-1');
    expect(prisma.calendarPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p-1', orgId: 'org-1' }),
        data: expect.objectContaining({
          status: 'scheduled',
          scheduleError: null,
          platformConnectionId: 'conn-1',
        }),
      }),
    );
    expect(ctx.emit).toHaveBeenCalled();
  });

  it('wraps a thrown Prisma error into { error } instead of rethrowing', async () => {
    const prisma = {
      calendarPost: { findUnique: vi.fn(async () => { throw new Error('P1001 cannot reach database'); }) },
    };
    const result = await postSchedule.handler(
      { postId: 'p-1', scheduledAt: future },
      makeCtx(prisma) as never,
    );
    expect(result.scheduled).toBe(false);
    expect(result.error).toMatch(/Post schedule failed/);
  });
});

describe('web_research handler contract', () => {
  it('returns an error object for an empty query without calling the provider', async () => {
    aiText.mockClear();
    const result = await webResearch.handler({ query: '   ' }, makeCtx({}) as never);
    expect(result.error).toMatch(/query is required/i);
    expect(result.findings).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(aiText).not.toHaveBeenCalled();
  });

  it('degrades to an { error } object when the provider fails', async () => {
    aiText.mockRejectedValueOnce(new Error('AllProvidersFailedError: everything down'));
    const result = await webResearch.handler({ query: 'ramadan campaigns 2027' }, makeCtx({}) as never);
    expect(result.error).toMatch(/Research provider failed/);
    expect(result.findings).toEqual([]);
  });

  it('returns findings + sources and drops non-public URLs before verification', async () => {
    aiText.mockResolvedValueOnce({
      output: {
        summary: 'A summary.',
        keyPoints: ['Point one', 'Point two', 42, ''],
        sources: [
          { title: 'Good', url: 'https://example.com/report', snippet: 'ok' },
          { title: 'Loopback probe', url: 'http://127.0.0.1:6379/info' },
          { title: 'LAN probe', url: 'http://192.168.1.10/admin' },
          { title: 'Not a url', url: 'ftp://example.com/x' },
        ],
      },
      provider: 'gemini', model: 'test', latencyMs: 5,
    });
    const result = await webResearch.handler({ query: 'uae f&b trends' }, makeCtx({}) as never);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe('A summary.');
    expect(result.findings).toEqual(['Point one', 'Point two']);
    expect(result.sources.map((s) => s.url)).toEqual(['https://example.com/report']);
    expect(result.sources[0].verified).toBe(true);
    // Metered call carries org attribution.
    expect(aiText).toHaveBeenCalledWith(
      expect.objectContaining({ json: true }),
      expect.objectContaining({ orgId: 'org-1', userId: 'user-1' }),
    );
  });

  it('notes when nothing came back instead of erroring', async () => {
    aiText.mockResolvedValueOnce({ output: {}, provider: 'gemini', model: 'test', latencyMs: 5 });
    const result = await webResearch.handler({ query: 'obscure niche topic' }, makeCtx({}) as never);
    expect(result.error).toBeUndefined();
    expect(result.findings).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.note).toMatch(/No grounded findings/);
  });
});
