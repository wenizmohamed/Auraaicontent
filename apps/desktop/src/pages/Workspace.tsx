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
  ArrowRight, Loader2,
} from 'lucide-react';
import { WorkspaceShell, useWorkspaceRoute } from '../components/shell/WorkspaceShell';
import {
  contentPiecesApi, type ContentPieceRecord,
  calendarApi, type CalendarMonthSummary,
} from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { EmptyState, Button, SkeletonRow, Badge, cn } from '../components/ui';

// Detail editor for a single content piece — lazy-loaded so the shell
// itself stays light. Currently renders a simplified read-only view; the
// existing /pieces page is still the editing surface until follow-up.
const PieceDetail = lazy(() => import('./Workspace.PieceDetail'));
const CalendarDetail = lazy(() => import('./Workspace.CalendarDetail'));

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

function PlaceholderSurface({
  title,
  description,
  cta,
  href,
}: {
  title: string;
  description: string;
  cta: string;
  href: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={ArrowRight}
        title={title}
        description={description}
        primary={
          <Button onClick={() => navigate(href)} size="md">{cta}</Button>
        }
      />
    </div>
  );
}

function PlaceholderList({ surfaceLabel }: { surfaceLabel: string }) {
  return (
    <div className="px-4 py-6 text-[12px]" style={{ color: 'var(--color-fg-subtle)' }}>
      <p>{surfaceLabel} list will live here.</p>
      <p className="mt-2">This surface is migrating into the shell. Use the legacy route in the right pane until then.</p>
    </div>
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
      list: <PlaceholderList surfaceLabel="Strategy" />,
      detail: () => (
        <PlaceholderSurface
          title="Strategy surface"
          description="Brief + Knowledge merge into one Strategy tab."
          cta="Open legacy /brief"
          href="/brief"
        />
      ),
    },
    {
      id: 'studio',
      label: 'Studio',
      icon: Wand2,
      list: <PlaceholderList surfaceLabel="Studio" />,
      detail: () => (
        <PlaceholderSurface
          title="Studio surface"
          description="CreativeTools + AIDesignGenerator + Gallery + VisualReferences + DesignTextures + VideoAnalysis unified into one workspace."
          cta="Open legacy /creative"
          href="/creative"
        />
      ),
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: BarChart3,
      list: <PlaceholderList surfaceLabel="Insights" />,
      detail: () => (
        <PlaceholderSurface
          title="Insights surface"
          description="Dashboard + Admin (gated) — sparklines + AI cost meter + activity stream."
          cta="Open legacy /"
          href="/"
        />
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      list: <PlaceholderList surfaceLabel="Settings" />,
      detail: () => (
        <PlaceholderSurface
          title="Settings surface"
          description="Profile + Members + Billing + Onboarding wizard."
          cta="Open legacy /profile"
          href="/profile"
        />
      ),
    },
  ];

  return <WorkspaceShell surfaces={surfaces} activeSurface={surface} activeItemId={itemId} />;
}
