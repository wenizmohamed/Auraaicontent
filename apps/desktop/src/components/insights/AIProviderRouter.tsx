/**
 * AIProviderRouter — radial orbital visualization of the Gemini → Grok → Kimi
 * fallback chain. Live telemetry pulses on the most-active provider so the
 * viewer can see the router's actual behavior, not just static labels.
 *
 * Editorial constraints: pure SVG, no Three.js, framer-motion only.
 * Reduced-motion: orbit rotation is paused, pulse animation collapses to a
 * static ring so the layout still reads as a chain diagram.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { AiStats } from '../../lib/backend-api';

interface Props {
  providers: AiStats['providers'];
  /** Overall radius of the orbital diagram. */
  size?: number;
}

const PROVIDER_LABELS: Record<string, { label: string; tier: 'primary' | 'fallback' | 'tertiary' }> = {
  gemini:    { label: 'Gemini',  tier: 'primary' },
  google:    { label: 'Gemini',  tier: 'primary' },
  grok:      { label: 'Grok',    tier: 'fallback' },
  xai:       { label: 'Grok',    tier: 'fallback' },
  kimi:      { label: 'Kimi',    tier: 'tertiary' },
  moonshot:  { label: 'Kimi',    tier: 'tertiary' },
};

export function AIProviderRouter({ providers, size = 280 }: Props) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Pick top 3 by call volume; default to gemini/grok/kimi if telemetry empty.
  const ordered = useMemo<AiStats['providers']>(() => {
    const sorted = [...providers].sort((a, b) => b.calls - a.calls).slice(0, 3);
    if (sorted.length === 0) {
      const placeholder = (provider: string): AiStats['providers'][number] => ({
        provider,
        calls: 0,
        errors: 0,
        successRate: 100,
        avgLatencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        fallbacks: 0,
        tasks: {},
      });
      return [placeholder('gemini'), placeholder('grok'), placeholder('kimi')];
    }
    return sorted;
  }, [providers]);

  const cx = size / 2;
  const cy = size / 2;
  const orbitR = size * 0.34;
  const nodeR = size * 0.06;
  const totalCalls = ordered.reduce((s, p) => s + p.calls, 0) || 1;
  const mostActive = ordered.reduce((max, p) => (p.calls > max.calls ? p : max), ordered[0]);

  return (
    <div className="flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="AI provider routing diagram">
        {/* Orbit ring */}
        <circle
          cx={cx}
          cy={cy}
          r={orbitR}
          fill="none"
          strokeWidth={1}
          style={{ stroke: 'var(--color-border-subtle)' }}
          strokeDasharray="2 4"
        />

        {/* Slow rotation group (pauses under reduced-motion) */}
        <motion.g
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          style={{ originX: '50%', originY: '50%', transformBox: 'fill-box' as any, transformOrigin: `${cx}px ${cy}px` }}
        >
          {ordered.map((p, i) => {
            const angle = (i / ordered.length) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(angle) * orbitR;
            const y = cy + Math.sin(angle) * orbitR;
            const meta = PROVIDER_LABELS[p.provider.toLowerCase()] || { label: p.provider, tier: 'tertiary' as const };
            const isActive = p.provider === mostActive.provider && p.calls > 0;
            const callShare = p.calls / totalCalls;
            return (
              <g key={p.provider}>
                {/* Spoke from center to node */}
                <line
                  x1={cx} y1={cy} x2={x} y2={y}
                  strokeWidth={1}
                  style={{
                    stroke: isActive ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                    opacity: isActive ? 0.6 : 0.4,
                  }}
                />
                {/* Node halo (only on active provider) */}
                {isActive && !reduceMotion && (
                  <motion.circle
                    cx={x} cy={y}
                    r={nodeR + 4}
                    fill="none"
                    strokeWidth={1}
                    style={{ stroke: 'var(--color-accent)' }}
                    animate={{ r: [nodeR + 2, nodeR + 10, nodeR + 2], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                {/* Node */}
                <circle
                  cx={x} cy={y} r={nodeR}
                  style={{
                    fill: 'var(--color-bg-elevated)',
                    stroke: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                    strokeWidth: 1.5,
                  }}
                />
                {/* Counter-rotate the label so it stays upright */}
                <motion.g
                  animate={reduceMotion ? undefined : { rotate: -360 }}
                  transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
                  style={{ transformOrigin: `${x}px ${y}px` }}
                >
                  <text
                    x={x} y={y - nodeR - 6}
                    textAnchor="middle"
                    style={{
                      fill: 'var(--color-fg)',
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                    }}
                  >
                    {meta.label}
                  </text>
                  <text
                    x={x} y={y + nodeR + 14}
                    textAnchor="middle"
                    style={{
                      fill: 'var(--color-fg-subtle)',
                      fontSize: 9,
                      fontFamily: 'monospace',
                    }}
                  >
                    {p.calls === 0 ? 'idle' : `${p.calls} · ${Math.round(callShare * 100)}%`}
                  </text>
                </motion.g>
              </g>
            );
          })}
        </motion.g>

        {/* Center hub */}
        <circle
          cx={cx} cy={cy} r={nodeR + 4}
          style={{
            fill: 'var(--color-bg-elevated)',
            stroke: 'var(--color-accent)',
            strokeWidth: 1.5,
          }}
        />
        <text
          x={cx} y={cy + 3}
          textAnchor="middle"
          style={{
            fill: 'var(--color-fg)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          ROUTER
        </text>
      </svg>
      <p className="mt-2 text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
        Fallback chain ·{' '}
        <span style={{ color: 'var(--color-fg-muted)', fontFamily: 'monospace' }}>
          {totalCalls.toLocaleString()} routed calls
        </span>
      </p>
    </div>
  );
}

export default AIProviderRouter;
