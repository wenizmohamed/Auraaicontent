// Narrow `unknown` thrown values to the bits we actually use in catch blocks,
// without sprinkling `as any` across the route layer.

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

export function errStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

export function errStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const s = (err as { statusCode?: unknown }).statusCode;
    if (typeof s === 'number') return s;
  }
  return undefined;
}
