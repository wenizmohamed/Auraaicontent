/**
 * NudgeBanner — opt-in, dismissable, not nagging. Phase 9 proactive
 * nudge pattern. Persists dismissal per nudge id in localStorage.
 *
 * Usage:
 *   <NudgeBanner
 *     id="dashboard.no-visuals"
 *     icon={Sparkles}
 *     title="3 posts have no visual yet"
 *     description="Generate AI images for the upcoming week's posts."
 *     primaryLabel="Generate"
 *     onPrimary={() => navigate('/creative?action=batch')}
 *   />
 */
import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  /** Stable id for dismissal persistence. */
  id: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  title: string;
  description?: string;
  primaryLabel: string;
  onPrimary: () => void;
  /** Override copy on the dismiss button (sr-only). */
  dismissLabel?: string;
}

const STORAGE_KEY = 'radix.nudges.dismissed';

function isDismissed(id: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return !!(JSON.parse(raw) as Record<string, boolean>)[id];
  } catch { return false; }
}

function markDismissed(id: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const dismissed = raw ? JSON.parse(raw) : {};
    dismissed[id] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
  } catch { /* ignore */ }
}

export function NudgeBanner({
  id,
  icon: Icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  dismissLabel = 'Dismiss',
}: Props) {
  const [hidden, setHidden] = useState(() => isDismissed(id));
  if (hidden) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{
        background: 'var(--color-accent-subtle)',
        borderColor: 'var(--color-accent)',
        color: 'var(--color-fg)',
      }}
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
        aria-hidden
      >
        <Icon size={14} />
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        {description && (
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onPrimary}
        className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer"
        style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
      >
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={() => { markDismissed(id); setHidden(true); }}
        aria-label={dismissLabel}
        className="rounded-md p-1 transition-colors hover:bg-[color:var(--color-surface-hover)] cursor-pointer"
      >
        <X size={14} style={{ color: 'var(--color-fg-subtle)' }} />
      </button>
    </div>
  );
}
