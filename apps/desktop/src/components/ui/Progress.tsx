/**
 * Progress — token-driven horizontal progress bar. ARIA progressbar
 * semantics. Animated value transitions.
 *
 * Usage:
 *   <Progress value={47} max={100} label="Generating posts" />
 */
interface ProgressProps {
  value: number;
  max?: number;
  /** Accessible label. Rendered as sr-only if showLabel is false. */
  label?: string;
  showLabel?: boolean;
  /** Token to tint the fill. Default: --color-accent. */
  tone?: 'accent' | 'success' | 'danger' | 'info';
  /** Height in px. */
  height?: number;
}

const TONE: Record<NonNullable<ProgressProps['tone']>, string> = {
  accent:  'var(--color-accent)',
  success: 'var(--color-success)',
  danger:  'var(--color-danger)',
  info:    'var(--color-info)',
};

export function Progress({ value, max = 100, label, showLabel = false, tone = 'accent', height = 6 }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full">
      {showLabel && label && (
        <div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="relative w-full overflow-hidden rounded-full"
        style={{ height: `${height}px`, background: 'var(--color-surface-active)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: TONE[tone],
            transition: 'width var(--dur-base) var(--ease-out-expo)',
          }}
        />
      </div>
    </div>
  );
}
