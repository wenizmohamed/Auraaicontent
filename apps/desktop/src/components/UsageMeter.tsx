// Always-on compact usage meter — sidebar footer. Shows the org's
// month-to-date AI spend + call count, polling every 30s. Clicking it
// opens the billing/usage detail. Org-scoped (mirrors the dashboard rule:
// org-wide, never current-client only).
//
// Tokens only: every color here is a semantic CSS var from index.css
// (no hex, no isDark branching) so it tracks every theme automatically
// and never trips the raw-color audit.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { usageApi } from '../lib/backend-api';
import { usePricingVisibility } from '../lib/use-pricing-visibility';

interface Props { collapsed: boolean }

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

export default function UsageMeter({ collapsed }: Props) {
  // Spend is owner/admin/accounting only. Gate BEFORE the query so we never
  // even ask for the numbers (the endpoint 403s for everyone else anyway).
  const canSeePricing = usePricingVisibility();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['usage', 'org'],
    queryFn: () => usageApi.currentOrg(),
    refetchInterval: 30_000,
    staleTime: 0,
    enabled: canSeePricing,
  });

  if (!canSeePricing) return null;

  // Loading skeleton — keep the same footprint so the footer doesn't jump.
  if (isLoading) {
    return (
      <div
        className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl`}
        style={{ color: 'var(--color-fg-muted)' }}
      >
        <Gauge size={16} className="shrink-0 animate-pulse" />
        {!collapsed && (
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: 'var(--color-surface-hover)' }} />
            <div className="h-2 w-1/2 rounded animate-pulse" style={{ background: 'var(--color-surface-hover)' }} />
          </div>
        )}
      </div>
    );
  }

  // No data / error — render nothing rather than a broken card.
  if (isError || !data) return null;

  const { costUsd, calls } = data.monthToDate;

  return (
    <Link
      to="/settings/billing"
      title={collapsed ? `${fmtUsd(costUsd)} this month · ${calls} calls` : undefined}
      className={`flex items-center w-full ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl transition-colors duration-200 cursor-pointer`}
      style={{ color: 'var(--color-fg-muted)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Gauge size={16} className="shrink-0" style={{ color: 'var(--color-accent)' }} />
      {!collapsed && (
        <div className="flex-1 min-w-0 text-left">
          <div
            className="text-[12px] font-semibold tabular-nums truncate"
            style={{ color: 'var(--color-fg)' }}
          >
            {fmtUsd(costUsd)} <span className="font-normal" style={{ color: 'var(--color-fg-muted)' }}>· {calls.toLocaleString()} calls</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-fg-muted)' }}>
            This month
          </div>
        </div>
      )}
    </Link>
  );
}
