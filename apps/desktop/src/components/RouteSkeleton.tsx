/**
 * Route-level skeleton — matches the shape of an authenticated page so the
 * lazy chunk swap doesn't cause CLS. Token-driven so it themes with
 * dark / light / studio.
 */
export function RouteSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl space-y-6 p-2"
    >
      <span className="sr-only">Loading…</span>

      {/* Header block */}
      <div className="space-y-3">
        <div
          className="h-7 w-1/3 animate-pulse rounded-lg"
          style={{ background: 'var(--color-surface-hover)' }}
        />
        <div
          className="h-4 w-1/2 animate-pulse rounded-md opacity-70"
          style={{ background: 'var(--color-surface-hover)' }}
        />
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border-subtle)',
              animationDelay: `${i * 80}ms`,
            }}
          />
        ))}
      </div>

      {/* Body block */}
      <div
        className="h-[420px] animate-pulse rounded-2xl border"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border-subtle)',
        }}
      />
    </div>
  );
}

/** Minimal fallback for top-level shell (login / invite / connection) — no chrome. */
export function ShellSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--color-bg)' }}
    >
      <span className="sr-only">Loading…</span>
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: 'var(--color-accent)', borderRightColor: 'var(--color-accent)' }}
      />
    </div>
  );
}
