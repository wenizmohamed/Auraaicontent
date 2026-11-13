import type { ToolContext } from '../tool-types.js';

// The model can pass any clientId it likes. A tool that writes an Asset, a
// Memory or a CalendarMonth with that id ties this org's work to another
// org's client, and every later brand-kit or memory lookup for that client
// pulls it in. The tenant guard cannot catch it, because orgId is still set.
//
// So a clientId the model supplies is checked against the run's org before
// any tool uses it. The session's own clientId was already checked when the
// run started (routes/agent.ts) or by client_switch.
export async function scopedClientId(ctx: ToolContext, requested?: string | null): Promise<string | undefined> {
  const id = typeof requested === 'string' ? requested.trim() : '';
  if (!id || id === ctx.clientId) return ctx.clientId || undefined;
  const found = await ctx.prisma.client.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!found) throw new Error(`Client ${id} is not in this organisation. Use client_switch to list the clients you can work on.`);
  return found.id;
}
