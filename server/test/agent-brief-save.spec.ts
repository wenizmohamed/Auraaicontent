// brief_save + agent scope rules -- contract tests.
//
// No database, no network (same pattern as agent-tools-action.spec.ts). Pins
// the behaviour behind the 2026-10-10 agent fix:
//   * brief_save creates a brief through briefService.upsert with the NOT NULL
//     columns filled, and scopes every query to the org
//   * a partial edit of an existing brief UPDATES in place and writes only the
//     fields passed (an upsert rejected partial edits for missing columns)
//   * a new brief without objective/audience/tone is refused with an
//     actionable message instead of saving an empty row
//   * the registry exposes brief_save and video_generate
//   * the system prompt keeps the scope and honesty rules
//
// Run:  npx vitest run test/agent-brief-save.spec.ts

import { describe, expect, it, vi } from 'vitest';

// The tool registry pulls in config/env.ts, which insists on these. Nothing
// connects: prisma is mocked below.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
  process.env.JWT_SECRET ||= 'test-secret-for-agent-brief-save-spec';
});

vi.mock('../src/db/prisma.js', () => ({ db: {}, systemDb: {} }));
vi.mock('../src/services/providers/ai-router.js', () => ({ aiRouter: {} }));
vi.mock('../src/services/history.service.js', () => ({ historyService: { record: vi.fn() } }));

const upsert = vi.fn(async (_orgId: string, _clientId: string, _data: unknown, _month: string) => ({ id: 'brief-new' }));
vi.mock('../src/services/brief.service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/brief.service.js')>('../src/services/brief.service.js');
  return { ...actual, briefService: { ...actual.briefService, upsert } };
});

const { tool: briefSave } = await import('../src/agent/tools/brief_save.js');
const { TOOL_BY_NAME } = await import('../src/agent/tools/index.js');
const { SYSTEM } = await import('../src/agent/system-prompt.js');

function makeCtx(prisma: unknown, clientId: string | null = 'client-1') {
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

function makePrisma(existing: { id: string } | null) {
  return {
    client: { findUnique: vi.fn(async () => ({ id: 'client-1', name: 'Test Cafe' })) },
    clientBrief: {
      findFirst: vi.fn(async () => existing),
      update: vi.fn(async () => ({ id: existing?.id ?? 'x' })),
    },
  };
}

describe('brief_save', () => {
  it('creates a month brief with required columns filled and org-scoped lookups', async () => {
    upsert.mockClear();
    const prisma = makePrisma(null);
    const out = await briefSave.handler(
      { month: '2026-11', objective: 'Drive footfall', audience: 'Young professionals', tone: 'Calm', channels: ['Instagram', ' '] },
      makeCtx(prisma),
    );
    expect(out.created).toBe(true);
    expect(out.month).toBe('2026-11');
    expect(prisma.client.findUnique).toHaveBeenCalledWith({ where: { id: 'client-1', orgId: 'org-1' } });
    expect(prisma.clientBrief.findFirst.mock.calls[0][0].where).toMatchObject({ clientId: 'client-1', orgId: 'org-1', month: '2026-11' });
    const [orgId, clientId, data, month] = upsert.mock.calls[0];
    expect([orgId, clientId, month]).toEqual(['org-1', 'client-1', '2026-11']);
    expect(data).toMatchObject({
      objective: 'Drive footfall', audience: 'Young professionals', tone: 'Calm',
      channels: ['Instagram'], brandDo: '', brandDont: '', products: [], pillars: [], campaignMoments: [], approvers: [],
    });
  });

  it('updates an existing brief in place with only the fields passed', async () => {
    upsert.mockClear();
    const prisma = makePrisma({ id: 'brief-1' });
    const out = await briefSave.handler({ month: 'November 2026', tone: 'Playful' }, makeCtx(prisma));
    expect(out.created).toBe(false);
    expect(out.fieldsSaved).toEqual(['tone']);
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.clientBrief.update).toHaveBeenCalledWith({ where: { id: 'brief-1', orgId: 'org-1' }, data: { tone: 'Playful' } });
  });

  it('refuses a new brief that lacks objective, audience or tone', async () => {
    upsert.mockClear();
    await expect(briefSave.handler({ tone: 'Calm' }, makeCtx(makePrisma(null)))).rejects.toThrow(/objective, audience/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses when there is no client and when the month is not a month', async () => {
    await expect(briefSave.handler({ tone: 'Calm' }, makeCtx(makePrisma(null), null))).rejects.toThrow(/needs a client/);
    await expect(briefSave.handler({ month: 'next month', tone: 'Calm' }, makeCtx(makePrisma(null)))).rejects.toThrow(/YYYY-MM/);
  });
});

describe('agent registry + scope rules', () => {
  it('exposes the tools a brief or video request needs', () => {
    expect(TOOL_BY_NAME.brief_save).toBeDefined();
    expect(TOOL_BY_NAME.video_generate).toBeDefined();
    expect(TOOL_BY_NAME.video_generate.input_schema.required).toEqual(['prompt']);
  });

  it('keeps the do-what-was-asked and no-false-success rules in the prompt', () => {
    expect(SYSTEM).toMatch(/Do exactly what the user asked/);
    expect(SYSTEM).toMatch(/A brief\s+request is NOT a request for posts/);
    expect(SYSTEM).toMatch(/Never generate a month of posts unless the user asked/);
    expect(SYSTEM).toMatch(/Only report as created, saved, generated or scheduled what a tool result/);
    expect(SYSTEM).not.toMatch(/[–—]/);
  });
});
