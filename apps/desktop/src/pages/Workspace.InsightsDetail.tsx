/**
 * Workspace.InsightsDetail — drill-down for a metric tile.
 *
 * Slug → view:
 *   "clients"   → totals + breakdown of clients with/without brief
 *   "posts"     → byStatus + byPlatform breakdowns from /api/dashboard/stats
 *   "ai"        → per-provider + per-task tables from /api/dashboard/ai-stats
 *   "knowledge" → totalItems + totalChunks + a note about embedding coverage
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, BarChart3 } from 'lucide-react';
import { dashboardApi, type DashboardStats, type AiStats } from '../lib/backend-api';
import { Badge, Button, EmptyState, Separator } from '../components/ui';

export default function InsightsDetail({ pieceId: slug }: { pieceId: string }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [ai, setAi] = useState<AiStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      dashboardApi.stats().catch(() => null),
      dashboardApi.aiStats().catch(() => null),
    ]).then(([s, a]) => {
      if (cancelled) return;
      setStats(s); setAi(a);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  const Header = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {title}
          </h1>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>{subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => navigate('/')}
        >
          Open dashboard
        </Button>
      </div>
      <Separator />
    </>
  );

  const Pair = ({ k, v }: { k: string; v: string | number }) => (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>{k}</dt>
      <dd className="font-mono" style={{ color: 'var(--color-fg)' }}>{v}</dd>
    </div>
  );

  if (slug === 'clients' && stats) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Header title="Clients" subtitle="Total accounts in this workspace and brief completion." />
        <dl>
          <Pair k="Total" v={stats.clients.total} />
          <Pair k="With brief" v={stats.clients.withBrief} />
          <Pair k="Brief coverage" v={`${Math.round((stats.clients.withBrief / Math.max(1, stats.clients.total)) * 100)}%`} />
        </dl>
      </div>
    );
  }

  if (slug === 'posts' && stats) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Header title="Posts" subtitle="Generated content across all months." />
        <dl>
          <Pair k="Total months" v={stats.content.totalMonths} />
          <Pair k="Total posts" v={stats.content.totalPosts} />
        </dl>
        <h2 className="mt-4 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>By status</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.content.byStatus).map(([k, v]) => (
            <Badge key={k} subtle tone={k === 'approved' ? 'accent' : k === 'changes_requested' ? 'info' : undefined}>
              {k}: {v}
            </Badge>
          ))}
        </div>
        <h2 className="mt-4 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>By platform</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.content.byPlatform).map(([k, v]) => (
            <Badge key={k} subtle>{k}: {v}</Badge>
          ))}
        </div>
      </div>
    );
  }

  if (slug === 'ai' && ai) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Header title="AI usage" subtitle="Calls, tokens, fallbacks, and per-provider stats." />
        <dl>
          <Pair k="Total calls" v={ai.totalCalls} />
          <Pair k="Total tokens" v={ai.totalTokens.toLocaleString()} />
          <Pair k="Errors" v={ai.totalErrors} />
          <Pair k="Fallbacks" v={ai.totalFallbacks} />
        </dl>
        <h2 className="mt-4 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>Providers</h2>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left" style={{ color: 'var(--color-fg-subtle)' }}>
              <th className="py-1.5">Provider</th><th>Calls</th><th>Errors</th><th>Avg ms</th>
            </tr>
          </thead>
          <tbody>
            {ai.providers.map((p) => (
              <tr key={p.provider} className="border-t" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg)' }}>
                <td className="py-1.5">{p.provider}</td>
                <td className="font-mono">{p.calls}</td>
                <td className="font-mono">{p.errors}</td>
                <td className="font-mono">{Math.round(p.avgLatencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (slug === 'knowledge' && stats) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Header title="Knowledge" subtitle="RAG corpus health across all clients." />
        <dl>
          <Pair k="Items" v={stats.knowledge.totalItems} />
          <Pair k="Chunks" v={stats.knowledge.totalChunks} />
          <Pair k="Avg chunks/item" v={(stats.knowledge.totalChunks / Math.max(1, stats.knowledge.totalItems)).toFixed(1)} />
        </dl>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={BarChart3}
        title="No data"
        description="The dashboard endpoints returned nothing for this metric."
        compact
      />
    </div>
  );
}
