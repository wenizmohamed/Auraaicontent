/**
 * Sparkline — inline tiny area chart for stat cards. Stripe Dashboard
 * pattern. Uses recharts (already installed). Token-driven stroke + fill
 * so it themes with dark / light / studio.
 */
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useId } from 'react';

interface SparklineProps {
  /** Numeric series. Sparkline normalises x by index. */
  data: number[];
  /** Stroke + fill base color. Defaults to --color-accent. */
  color?: string;
  /** Hide tooltip on hover. Default: shown. */
  hideTooltip?: boolean;
  /** Height in px. Default: 36. */
  height?: number;
  /** Trend tint — 'up' green, 'down' red, 'neutral' accent. */
  trend?: 'up' | 'down' | 'neutral';
}

const TREND_COLOR: Record<NonNullable<SparklineProps['trend']>, string> = {
  up:      'var(--color-success)',
  down:    'var(--color-danger)',
  neutral: 'var(--color-accent)',
};

export function Sparkline({
  data,
  color,
  hideTooltip = false,
  height = 36,
  trend = 'neutral',
}: SparklineProps) {
  const id = useId().replace(/:/g, '');
  const stroke = color ?? TREND_COLOR[trend];

  if (!data || data.length < 2) {
    return <div style={{ height }} aria-hidden />;
  }

  const series = data.map((value, i) => ({ i, value }));

  return (
    <div style={{ width: '100%', height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {!hideTooltip && (
            <Tooltip
              cursor={false}
              contentStyle={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                color: 'var(--color-fg)',
                fontSize: 11,
                padding: '4px 8px',
              }}
              labelFormatter={() => ''}
              formatter={(v: number) => [v.toLocaleString(), '']}
              separator=""
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#spark-${id})`}
            isAnimationActive
            animationDuration={400}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
