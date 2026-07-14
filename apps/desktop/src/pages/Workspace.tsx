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
import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
import { EmptyState, SkeletonRow, Badge, cn } from '../components/ui';

/**
 * Premium ambient glow layer — a soft accent radial bloom anchored to a
 * corner, sitting behind content. Token-colored via color-mix so it themes
 * cleanly across dark / light / studio. Decorative only: pointer-events-none,
 * low z, aria-hidden. Reused by list panels and empty states.
 */
function AmbientGlow({
  placement = 'top',
  intensity = 9,
}: { placement?: 'top' | 'corner' | 'center'; intensity?: number }) {
  const pos =
    placement === 'corner'
      ? 'radial-gradient(420px circle at 100% 0%, '
      : placement === 'center'
        ? 'radial-gradient(520px circle at 50% 35%, '
        : 'radial-gradient(560px circle at 50% 0%, ';
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background: `${pos}color-mix(in srgb, var(--color-accent) ${intensity}%, transparent), transparent 70%)`,
      }}
    />
  );
}

/**
 * Shared list-row shell — premium hover / active treatment used across every
 * surface list pane. Active rows get an accent inset rail (logical inline-start
 * so it mirrors under RTL), a token-tinted fill, and a refined type rhythm.
 * Purely presentational: it forwards onClick + children, no logic.
 */
function WorkspaceRow({
  isActive,
  onClick,
  title,
  primary,
  secondary,
  trailing,
}: {
  isActive: boolean;
  onClick: () => void;
  title?: string;
  primary: ReactNode;
  secondary: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 px-4 py-3 text-start transition-[background-color,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset',
      )}
      style={{
        background: isActive
          ? 'color-mix(in srgb, var(--color-surface-hover) 90%, transparent)'
          : 'transparent',
        ['--tw-ring-color' as any]: 'var(--color-accent)',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background =
          'color-mix(in srgb, var(--color-surface-hover) 55%, transparent)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Active inset rail — logical inline-start edge, mirrors under RTL. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1.5 start-0 w-[2px] rounded-full transition-opacity duration-150"
        style={{
          background: 'var(--color-accent)',
          opacity: isActive ? 1 : 0,
        }}
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[13px] font-semibold tracking-tight"
          style={{ color: 'var(--color-fg)' }}
        >
          {primary}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
          {secondary}
        </p>
      </div>
      {trailing}
    </button>
  );
}

/** Wraps a list pane's scrollable body so its ambient glow + content stack
 *  correctly (relative container, glow at z0, content at z10). */
function ListShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <AmbientGlow placement="top" intensity={7} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** Premium empty / loading detail surface — centers content over a soft
 *  ambient accent bloom so an unselected detail pane still feels intentional. */
function DetailStage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-8">
      <AmbientGlow placement="center" intensity={8} />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}

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
          title="No content pieces yet"
          description="Content pieces are long-form deliverables — articles, scripts, threads."
          compact
          primary={<Link to="/pieces" className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}>+ New content piece</Link>}
        />
      </div>
    );
  }

  return (
    <ListShell>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {pieces.map((p) => {
          const isActive = p.id === activeId;
          return (
            <li key={p.id}>
              <WorkspaceRow
                isActive={isActive}
                onClick={() => onPick(p.id)}
                title={p.title || 'Untitled'}
                primary={p.title || 'Untitled'}
                secondary={`${(p as any).status ?? 'draft'} · ${(p as any).type ?? 'post'}`}
                trailing={isActive ? <Badge subtle tone="accent">Open</Badge> : undefined}
              />
            </li>
          );
        })}
      </ul>
    </ListShell>
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
          description="Turn a brief into a full month of on-brand posts."
          compact
          primary={<Link to="/brief" className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold" style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}>+ Generate a month</Link>}
        />
      </div>
    );
  }

  return (
    <ListShell>
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
              <WorkspaceRow
                isActive={isActive}
                onClick={() => onPick(m.month)}
                title={label}
                primary={label}
                secondary={`${m.status} · ${m.postCount} posts`}
                trailing={isActive ? <Badge subtle tone="accent">Open</Badge> : undefined}
              />
            </li>
          );
        })}
      </ul>
    </ListShell>
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
    <ListShell>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <li>
          <WorkspaceRow
            isActive={activeId === 'brief'}
            onClick={() => onPick('brief')}
            title="Brief"
            primary="Brief"
            secondary="Tone · audience · platforms"
            trailing={activeId === 'brief' ? <Badge subtle tone="accent">Open</Badge> : undefined}
          />
        </li>
        {items.map((it) => {
          const slug = `knowledge:${it.id}`;
          const isActive = slug === activeId;
          return (
            <li key={it.id}>
              <WorkspaceRow
                isActive={isActive}
                onClick={() => onPick(slug)}
                title={it.title || 'Untitled'}
                primary={it.title || 'Untitled'}
                secondary={it.type}
                trailing={isActive ? <Badge subtle tone="accent">Open</Badge> : undefined}
              />
            </li>
          );
        })}
      </ul>
    </ListShell>
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
    <ListShell>
      <div className="grid grid-cols-2 gap-2.5 p-3">
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
                'group/asset relative aspect-square overflow-hidden rounded-lg border transition-[transform,box-shadow,border-color] duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
                isActive ? 'ring-2' : 'hover:-translate-y-0.5',
              )}
              style={{
                borderColor: isActive
                  ? 'color-mix(in srgb, var(--color-accent) 55%, transparent)'
                  : 'var(--color-border-subtle)',
                background: 'var(--color-surface)',
                boxShadow: isActive
                  ? '0 8px 24px -12px color-mix(in srgb, var(--color-accent) 45%, transparent)'
                  : '0 1px 2px color-mix(in srgb, var(--color-bg-sunken) 60%, transparent)',
                ['--tw-ring-color' as any]: 'var(--color-accent)',
              }}
              title={a.name || 'Untitled'}
            >
              {isVideo ? (
                <div
                  className="flex h-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{
                    color: 'var(--color-fg-subtle)',
                    background:
                      'radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 70%)',
                  }}
                >
                  video
                </div>
              ) : (
                <img src={thumb} alt={a.name || ''} className="h-full w-full object-cover" loading="lazy" />
              )}
              {/* Hover scrim — subtle bottom gradient that lifts the thumbnail. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 opacity-0 transition-opacity duration-150 group-hover/asset:opacity-100"
                style={{
                  background:
                    'linear-gradient(to top, color-mix(in srgb, var(--color-bg-sunken) 70%, transparent), transparent)',
                }}
              />
            </button>
          );
        })}
      </div>
    </ListShell>
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
    <ListShell>
      <div className="grid grid-cols-1 gap-2.5 p-3">
        {tiles.map((t) => {
          const isActive = t.slug === activeId;
          // 'ai' tile carries a non-numeric 'view' affordance; everything else
          // is a real count we render large + tabular for the stat-card feel.
          const isNumeric = /^\d/.test(t.value);
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => onPick(t.slug)}
              className={cn(
                'group/stat relative overflow-hidden rounded-xl border p-4 text-start transition-[transform,box-shadow,border-color] duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset',
                'hover:-translate-y-0.5',
              )}
              aria-current={isActive ? 'true' : undefined}
              style={{
                background: isActive
                  ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))'
                  : 'var(--color-bg-elevated)',
                borderColor: isActive
                  ? 'color-mix(in srgb, var(--color-accent) 45%, transparent)'
                  : 'var(--color-border-subtle)',
                boxShadow: isActive
                  ? '0 10px 30px -16px color-mix(in srgb, var(--color-accent) 50%, transparent)'
                  : '0 1px 2px color-mix(in srgb, var(--color-bg-sunken) 50%, transparent)',
                ['--tw-ring-color' as any]: 'var(--color-accent)',
              }}
            >
              {/* Decorative depth layer — corner accent bloom behind content. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -end-6 -top-8 h-24 w-24 rounded-full transition-opacity duration-150"
                style={{
                  background:
                    'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 70%)',
                  opacity: isActive ? 0.9 : 0.45,
                }}
              />
              <div className="relative z-10 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: 'var(--color-fg-subtle)' }}
                  >
                    {t.label}
                  </p>
                  <p
                    className={cn(
                      'mt-1.5 truncate font-display font-bold leading-none tracking-tight tabular-nums',
                      isNumeric ? 'text-[26px]' : 'text-[15px]',
                    )}
                    style={{ color: 'var(--color-fg)' }}
                  >
                    {t.value}
                  </p>
                </div>
                {isActive && <Badge subtle tone="accent">Open</Badge>}
              </div>
              <p className="relative z-10 mt-2 line-clamp-1 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                {t.sub}
              </p>
            </button>
          );
        })}
      </div>
    </ListShell>
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
    <ListShell>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {SETTINGS_SECTIONS.map((s) => {
          const isActive = s.slug === activeId;
          return (
            <li key={s.slug}>
              <WorkspaceRow
                isActive={isActive}
                onClick={() => onPick(s.slug)}
                title={s.label}
                primary={s.label}
                secondary={s.sub}
                trailing={isActive ? <Badge subtle tone="accent">Open</Badge> : undefined}
              />
            </li>
          );
        })}
      </ul>
    </ListShell>
  );
}

export default function Workspace() {
  const navigate = useNavigate();
  const { surface, itemId } = useWorkspaceRoute();

  const surfaces = [
    {
      id: 'content',
      label: 'Content',
      description: 'Draft, edit & generate content pieces',
      icon: Layers,
      group: 'Plan',
      list: <ContentList activeId={itemId} onPick={(id) => navigate(`/workspace/content/${id}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <PieceDetail pieceId={id} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={Layers}
              title="Pick a content piece"
              description="Select a row on the left to preview, edit, or generate variants."
              compact
            />
          </DetailStage>
        )
      ),
    },
    {
      id: 'calendar',
      label: 'Calendar',
      description: 'Monthly content calendars per client',
      icon: CalIcon,
      group: 'Plan',
      list: <CalendarList activeId={itemId} onPick={(month) => navigate(`/workspace/calendar/${encodeURIComponent(month)}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <CalendarDetail pieceId={id} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={CalIcon}
              title="Pick a month"
              description="Select a month on the left to preview the calendar grid."
              compact
            />
          </DetailStage>
        )
      ),
    },
    {
      id: 'strategy',
      label: 'Strategy',
      description: 'Briefs & brand knowledge',
      icon: FileText,
      group: 'Plan',
      list: <StrategyList activeId={itemId} onPick={(slug) => navigate(`/workspace/strategy/${encodeURIComponent(slug)}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <StrategyDetail pieceId={decodeURIComponent(id)} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={FileText}
              title="Pick a strategy item"
              description="The brief or any knowledge document on the left."
              compact
            />
          </DetailStage>
        )
      ),
    },
    {
      id: 'studio',
      label: 'Studio',
      description: 'Generate images & video',
      icon: Wand2,
      group: 'Make',
      list: <StudioList activeId={itemId} onPick={(id) => navigate(`/workspace/studio/${id}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <StudioDetail pieceId={id} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={Wand2}
              title="Pick an asset"
              description="Tap a thumbnail on the left to preview the full image or video."
              compact
            />
          </DetailStage>
        )
      ),
    },
    {
      id: 'insights',
      label: 'Insights',
      description: 'Usage, performance & analytics',
      icon: BarChart3,
      group: 'Track',
      list: <InsightsList activeId={itemId} onPick={(slug) => navigate(`/workspace/insights/${slug}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <InsightsDetail pieceId={id} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={BarChart3}
              title="Pick a metric"
              description="Tap a tile on the left for a breakdown."
              compact
            />
          </DetailStage>
        )
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Profile, members, billing & integrations',
      icon: SettingsIcon,
      group: 'Manage',
      list: <SettingsList activeId={itemId} onPick={(slug) => navigate(`/workspace/settings/${slug}`)} />,
      detail: (id: string | undefined) => (
        id ? (
          <Suspense fallback={
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <AmbientGlow placement="center" intensity={6} />
              <div
                className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated))',
                }}
              >
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              </div>
            </div>
          }>
            <SettingsDetail pieceId={id} />
          </Suspense>
        ) : (
          <DetailStage>
            <EmptyState
              icon={SettingsIcon}
              title="Pick a section"
              description="Profile, Members, Billing, or API keys."
              compact
            />
          </DetailStage>
        )
      ),
    },
  ];

  return <WorkspaceShell surfaces={surfaces} activeSurface={surface} activeItemId={itemId} />;
}
