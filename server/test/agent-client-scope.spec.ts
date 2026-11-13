// Agent tools must not let the model point a write at another org's client.
//
// image_generate, video_generate, image_edit, prompt_improve,
// brand_memory_save, calendar_plan and pieces_generate all take a clientId
// argument from the model. Until 2026-11-13 the creative tools used it
// unchecked (args.clientId || ctx.clientId), so a prompt-injected run in
// org A could create Assets and Brand Memory rows tied to org B's client.

import { describe, it, expect, vi } from 'vitest';
import { scopedClientId } from '../src/agent/tools/client-scope';

function ctxWith(clients: { id: string; orgId: string }[], sessionClientId: string | null = 'c-session') {
  const findFirst = vi.fn(async ({ where }: { where: { id: string; orgId: string } }) =>
    clients.find((c) => c.id === where.id && c.orgId === where.orgId) ?? null);
  return {
    ctx: { orgId: 'org-a', clientId: sessionClientId, prisma: { client: { findFirst } } } as any,
    findFirst,
  };
}

describe('scopedClientId', () => {
  it('uses the session client when the model passes none', async () => {
    const { ctx, findFirst } = ctxWith([]);
    expect(await scopedClientId(ctx, undefined)).toBe('c-session');
    expect(await scopedClientId(ctx, '  ')).toBe('c-session');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('accepts another client of the SAME org', async () => {
    const { ctx } = ctxWith([{ id: 'c-a2', orgId: 'org-a' }]);
    expect(await scopedClientId(ctx, 'c-a2')).toBe('c-a2');
  });

  it("refuses a client that belongs to another org", async () => {
    const { ctx, findFirst } = ctxWith([{ id: 'c-b1', orgId: 'org-b' }]);
    await expect(scopedClientId(ctx, 'c-b1')).rejects.toThrow(/not in this organisation/);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'c-b1', orgId: 'org-a' }, select: { id: true } });
  });

  it('refuses an id that does not exist at all', async () => {
    const { ctx } = ctxWith([]);
    await expect(scopedClientId(ctx, 'nope')).rejects.toThrow();
  });

  it('returns undefined when there is no session client and none passed', async () => {
    const { ctx } = ctxWith([], null);
    expect(await scopedClientId(ctx, undefined)).toBeUndefined();
  });
});
