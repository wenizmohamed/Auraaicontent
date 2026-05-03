/**
 * Workspace — the new IA. Single page hosting the WorkspaceShell with all
 * 6 surfaces. URL pattern: /workspace/:surface/:itemId?
 *
 * This is the demo migration of one surface (Content) into the shell. The
 * other 5 (Calendar / Strategy / Studio / Insights / Settings) currently
 * render placeholder list-and-detail panes that link out to the existing
 * top-level routes; they migrate one-by-one in follow-up commits without
 * any big-bang refactor risk.
 */
import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar as CalIcon, Layers, FileText, Wand2, BarChart3, Settings as SettingsIcon,
  Loader2,
} from 'lucide-react';
import { WorkspaceShell, useWorkspaceRoute } from '../components/shell/WorkspaceShell';
import {
  contentPiecesApi, type ContentPieceRecord,
  calendarApi, type CalendarMonthSummary,
  knowledgeApi, type KnowledgeItemRecord,
  galleryApi, type GalleryAsset,
  dashboardApi, type DashboardStats,
} from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { EmptyState, Button, SkeletonRow, Badge, cn } from '../components/ui';

// Detail editor for a single content piece — lazy-loaded so the shell
// itself stays light. Currently renders a simplified read-only view; the
// existing /pieces page is still the editing surface until follow-up.
const PieceDetail = lazy(() => import('./Workspace.PieceDetail'));
const CalendarDetail = lazy(() => import('./Workspace.CalendarDetail'));
const StrategyDetail = lazy(() => import('./Workspace.StrategyDetail'));
const StudioDetail   = lazy(() => import('./Workspace.StudioDetail'));
const InsightsDetail = lazy(() => import('./Workspace.InsightsDetail'));
const SettingsDetail = lazy(() => import('./Workspace.SettingsDetail'));

function ContentList({ activeId, onPick }: { activeId?: string; onPick: (id: string) => void }) {
  const { selectedClientId } = useClients();
  const [pieces, setPieces] = useState<ContentPieceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedClientId) return;
    setLoading(true);
    contentPiecesApi.list(selectedClientId)
      .then((rows) => setPieces(rows))
      .catch(() => setPieces([]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} delay={i * 60} />
        ))}
      </div>
    );
  }

  if (pieces.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Layers}
          title="No content pieces"
          description="Open the legacy pieces editor to create one."
          compact
        />
      </div>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
      {pieces.map((p) => {
        const isActive = p.id === activeId;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)]'
                  : 'hover:bg-[color:var(--color-surface-hover)]/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
                  {p.title || 'Untitled'}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {(p as any).status ?? 'draft'} · {(p as any).type ?? 'post'}
                </p>
              </div>
              {isActive && <Badge subtle tone="accent">Open</Badge>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CalendarList({ activeId, onPick }: { activeId?: string; onPick: (month: string) => void }) {
  const { selectedClientId } = useClients();
  const [months, setMonths] = useState<CalendarMonthSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedClientId) return;
    setLoading(true);
    calendarApi.listMonths(selectedClientId)
      .then((rows) => setMonths(rows))
      .catch(() => setMonths([]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} delay={i * 60} />
        ))}
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={CalIcon}
          title="No calendar months"
          description="Generate a month from the legacy /calendar editor."
          compact
        />
      </div>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
      {months.map((m) => {
        const isActive = m.month === activeId;
        const label = (() => {
          const [y, mo] = m.month.split('-').map((n) => parseInt(n, 10));
          const d = new Date(y || new Date().getFullYear(), (mo || 1) - 1, 1);
          return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        })();
        return (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick(m.month)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)]'
                  : 'hover:bg-[color:var(--color-surface-hover)]/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
                  {label}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {m.status} · {m.postCount} posts
                </p>
              </div>
              {isActive && <Badge subtle tone="accent">Open</Badge>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StrategyList({ activeId, onPick }: { activeId?: string; onPick: (slug: string) => void }) {
  const { selectedClientId } = useClients();
  const [items, setItems] = useState<KnowledgeItemRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedClientId) return;
    setLoading(true);
    knowledgeApi.list(selectedClientId)
      .then((rows) => setItems(rows))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} delay={i * 60} />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <li>
        <button
          type="button"
          onClick={() => onPick('brief')}
          className={cn(
            'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
            activeId === 'brief'
              ? 'bg-[color:var(--color-surface-hover)]'
              : 'hover:bg-[color:var(--color-surface-hover)]/60'
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
              Brief
            </p>
            <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
              Tone · audience · platforms
            </p>
          </div>
          {activeId === 'brief' && <Badge subtle tone="accent">Open</Badge>}
        </button>
      </li>
      {items.map((it) => {
        const slug = `knowledge:${it.id}`;
        const isActive = slug === activeId;
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onPick(slug)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)]'
                  : 'hover:bg-[color:var(--color-surface-hover)]/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
                  {it.title || 'Untitled'}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {it.type}
                </p>
              </div>
              {isActive && <Badge subtle tone="accent">Open</Badge>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StudioList({ activeId, onPick }: { activeId?: string; onPick: (id: string) => void }) {
  const { selectedClientId } = useClients();
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    galleryApi.list(selectedClientId ? { clientId: selectedClientId, take: 60 } : { take: 60 })
      .then((rows) => setAssets(rows))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-md"
            style={{ background: 'var(--color-surface)', animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Wand2}
          title="No assets yet"
          description="Generate one in the Creative tools."
          compact
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {assets.map((a) => {
        const isActive = a.id === activeId;
        const isVideo = a.mimeType?.startsWith('video/');
        const thumb = a.thumbUrl || a.fileUrl;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a.id)}
            className={cn(
              'relative aspect-square overflow-hidden rounded-md border transition-colors',
              isActive ? 'ring-2' : '',
            )}
            style={{
              borderColor: 'var(--color-border-subtle)',
              background: 'var(--color-surface)',
              ...(isActive ? { ['--tw-ring-color' as any]: 'var(--color-accent)' } : {}),
            }}
            title={a.name || 'Untitled'}
          >
            {isVideo ? (
              <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>
                video
              </div>
            ) : (
              <img src={thumb} alt={a.name || ''} className="h-full w-full object-cover" loading="lazy" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function InsightsList({ activeId, onPick }: { activeId?: string; onPick: (slug: string) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardApi.stats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const tiles: { slug: string; label: string; value: string; sub: string }[] = stats ? [
    { slug: 'clients',   label: 'Clients',   value: String(stats.clients.total),         sub: `${stats.clients.withBrief} with brief` },
    { slug: 'posts',     label: 'Posts',     value: String(stats.content.totalPosts),    sub: `${stats.content.totalMonths} months` },
    { slug: 'ai',        label: 'AI usage',  value: 'view',                              sub: 'providers + tasks' },
    { slug: 'knowledge', label: 'Knowledge', value: String(stats.knowledge.totalItems),  sub: `${stats.knowledge.totalChunks} chunks` },
  ] : [];

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} delay={i * 60} />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
      {tiles.map((t) => {
        const isActive = t.slug === activeId;
        return (
          <li key={t.slug}>
            <button
              type="button"
              onClick={() => onPick(t.slug)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)]'
                  : 'hover:bg-[color:var(--color-surface-hover)]/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
                  {t.label}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {t.sub}
                </p>
              </div>
              <span className="font-mono text-[14px] tabular-nums" style={{ color: 'var(--color-fg)' }}>{t.value}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const SETTINGS_SECTIONS: { slug: string; label: string; sub: string }[] = [
  { slug: 'profile',      label: 'Profile',      sub: 'Name, email, role' },
  { slug: 'members',      label: 'Members',      sub: 'Org memberships' },
  { slug: 'billing',      label: 'Billing',      sub: 'Plan + Stripe portal' },
  { slug: 'api-keys',     label: 'API keys',     sub: 'External integrations' },
  { slug: 'integrations', label: 'Integrations', sub: 'Connect Instagram / TikTok / LinkedIn' },
];

function SettingsList({ activeId, onPick }: { activeId?: string; onPick: (slug: string) => void }) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
      {SETTINGS_SECTIONS.map((s) => {
        const isActive = s.slug === activeId;
        return (
          <li key={s.slug}>
            <button
              type="button"
              onClick={() => onPick(s.slug)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)]'
                  : 'hover:bg-[color:var(--color-surface-hover)]/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
                  {s.label}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {s.sub}
                </p>
              </div>
              {isActive && <Badge subtle tone="accent">Open</Badge>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function Workspace() {
  const navigate = useNavigate();
  const { surface, itemId } = useWorkspaceRoute();

  const surfaces = [
    {
      id: 'content',
      label: 'Content',
      icon: Layers,
      group: 'Plan',
      list: <ContentList activeId={itemId} onPick={(id) => navigate(`/workspace/content/${id}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <PieceDetail pieceId={id} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={Layers}
              title="Pick a content piece"
              description="Select a row on the left to preview, edit, or generate variants."
              compact
            />
          </div>
        )
      ),
    },
    {
      id: 'calendar',
      label: 'Calendar',
      icon: CalIcon,
      group: 'Plan',
      list: <CalendarList activeId={itemId} onPick={(month) => navigate(`/workspace/calendar/${encodeURIComponent(month)}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <CalendarDetail pieceId={id} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={CalIcon}
              title="Pick a month"
              description="Select a month on the left to preview the calendar grid."
              compact
            />
          </div>
        )
      ),
    },
    {
      id: 'strategy',
      label: 'Strategy',
      icon: FileText,
      group: 'Plan',
      list: <StrategyList activeId={itemId} onPick={(slug) => navigate(`/workspace/strategy/${encodeURIComponent(slug)}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <StrategyDetail pieceId={decodeURIComponent(id)} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={FileText}
              title="Pick a strategy item"
              description="The brief or any knowledge document on the left."
              compact
            />
          </div>
        )
      ),
    },
    {
      id: 'studio',
      label: 'Studio',
      icon: Wand2,
      group: 'Make',
      list: <StudioList activeId={itemId} onPick={(id) => navigate(`/workspace/studio/${id}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <StudioDetail pieceId={id} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={Wand2}
              title="Pick an asset"
              description="Tap a thumbnail on the left to preview the full image or video."
              compact
            />
          </div>
        )
      ),
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: BarChart3,
      group: 'Track',
      list: <InsightsList activeId={itemId} onPick={(slug) => navigate(`/workspace/insights/${slug}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <InsightsDetail pieceId={id} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={BarChart3}
              title="Pick a metric"
              description="Tap a tile on the left for a breakdown."
              compact
            />
          </div>
        )
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      group: 'Manage',
      list: <SettingsList activeId={itemId} onPick={(slug) => navigate(`/workspace/settings/${slug}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          }>
            <SettingsDetail pieceId={id} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={SettingsIcon}
              title="Pick a section"
              description="Profile, Members, Billing, or API keys."
              compact
            />
          </div>
        )
      ),
    },
  ];

  return <WorkspaceShell surfaces={surfaces} activeSurface={surface} activeItemId={itemId} />;
}
