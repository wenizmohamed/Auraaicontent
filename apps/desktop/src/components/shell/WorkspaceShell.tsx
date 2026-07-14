/**
 * WorkspaceShell — three-pane Linear/Notion/Height-style layout.
 *
 *   ┌─────────┬───────────┬─────────────────────────────┐
 *   │   nav   │   list    │   detail                    │
 *   │ (rail)  │  (queue)  │   (editor / preview)        │
 *   └─────────┴───────────┴─────────────────────────────┘
 *
 * Phase 3 of the state-of-the-art interface plan. This is the ONE
 * primitive that flattens the 28-route IA into 6 top-level surfaces:
 *
 *   1. Calendar  → ContentCalendar
 *   2. Content   → ContentReview + ContentPieces
 *   3. Strategy  → BriefInput + Knowledge
 *   4. Studio    → CreativeTools + AIDesignGenerator + Gallery + ...
 *   5. Insights  → Dashboard + Admin
 *   6. Settings  → Profile + Members + Billing + Onboarding
 *
 * Surface routes live at /workspace/<surface>/<:itemId?>. The old top-level
 * routes (/calendar, /clients, etc.) stay intact — they redirect into the
 * shell as we migrate each surface, so the cutover is incremental, not
 * a big-bang refactor.
 *
 * Panel widths persist per-user in localStorage via react-resizable-panels'
 * autoSaveId. URL is the source of truth for which surface + which item
 * is open in the right pane.
 */
import { useMemo, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Link, useParams } from 'react-router-dom';
import { cn } from '../ui/cn';

export interface SurfaceDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Pane composition for this surface — list pane + detail pane. */
  list: ReactNode;
  detail: (itemId: string | undefined) => ReactNode;
  /** Optional grouping label — surfaces that share the same group render under
   *  one section header in the rail. Surfaces with no group fall under "Other". */
  group?: string;
  /** One-line description shown under the surface title in the list-pane header. */
  description?: string;
  /** Optional badge: a number renders as a count pill, 'dot' renders a single
   *  accent dot, anything else is ignored. */
  badge?: number | 'dot';
}

interface WorkspaceShellProps {
  surfaces: SurfaceDef[];
  /** Currently-active surface id (from URL). */
  activeSurface: string;
  /** Optional active item id within the surface (from URL). */
  activeItemId?: string;
}

/** Stable grouping order — surfaces are rendered in this group order. */
const GROUP_ORDER = ['Plan', 'Make', 'Track', 'Manage', 'Other'];

export function WorkspaceShell({ surfaces, activeSurface, activeItemId }: WorkspaceShellProps) {
  const surface = surfaces.find((s) => s.id === activeSurface) ?? surfaces[0];

  /** Pre-bucket surfaces by group, preserving authoring order within each group. */
  const grouped = useMemo(() => {
    const buckets: Record<string, SurfaceDef[]> = {};
    for (const s of surfaces) {
      const g = s.group ?? 'Other';
      (buckets[g] ??= []).push(s);
    }
    return GROUP_ORDER
      .filter((g) => buckets[g]?.length)
      .map((g) => ({ name: g, items: buckets[g] }))
      .concat(
        Object.entries(buckets)
          .filter(([g]) => !GROUP_ORDER.includes(g))
          .map(([name, items]) => ({ name, items })),
      );
  }, [surfaces]);

  const showHeaders = grouped.length > 1;

  return (
    <div
      className="flex h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-fg)',
      }}
    >
      {/* Left rail — labeled, grouped surface navigator. Icon + label so each
          surface is legible at a glance (icon-only was cryptic); left-aligned
          group headers, active row gets an accent inset rail. */}
      <nav
        aria-label="Workspace surfaces"
        className="flex shrink-0 flex-col items-stretch overflow-y-auto border-r px-2 py-3"
        style={{ width: 200, borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
      >
        {grouped.map((g, gi) => (
          <div key={g.name} className={gi > 0 ? 'mt-4' : undefined}>
            {showHeaders && (
              <p
                className="mb-1 px-2 text-[9px] font-bold uppercase tracking-[0.12em]"
                style={{ color: 'var(--color-fg-subtle)' }}
              >
                {g.name}
              </p>
            )}
            {g.items.map((s) => {
              const isActive = s.id === activeSurface;
              const Icon = s.icon;
              const badgeLabel = typeof s.badge === 'number' ? String(s.badge) : s.badge === 'dot' ? '' : null;
              return (
                <Link
                  key={s.id}
                  to={`/workspace/${s.id}`}
                  title={s.description || s.label}
                  className={cn(
                    'relative mb-0.5 flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-2 transition-colors',
                    isActive
                      ? 'bg-[color:var(--color-surface-hover)] text-[color:var(--color-fg)]'
                      : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--color-fg)]'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={typeof s.badge === 'number' && s.badge > 0 ? `${s.label} (${s.badge} unread)` : s.label}
                >
                  {/* active inset rail */}
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[2px] rounded-full transition-opacity"
                    style={{ background: 'var(--color-accent)', opacity: isActive ? 1 : 0 }}
                  />
                  <Icon size={16} className="shrink-0" />
                  <span className="flex-1 truncate text-[13px] font-medium">{s.label}</span>
                  {badgeLabel != null && (
                    s.badge === 'dot' ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--color-accent)' }} aria-hidden />
                    ) : (
                      <span
                        className="flex min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums leading-[14px]"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
                        aria-hidden
                      >
                        {(s.badge as number) > 99 ? '99+' : badgeLabel}
                      </span>
                    )
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <PanelGroup direction="horizontal" autoSaveId="radix.workspace.panels" className="flex-1">
        {/* Middle list pane — hairline border on the right edge handled by the
            resize handle itself so we don't draw a competing 1px line. */}
        <Panel defaultSize={32} minSize={15} maxSize={60} className="overflow-hidden">
          <div className="flex h-full flex-col">
            <div
              className="flex items-center gap-2.5 border-b px-4 py-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                aria-hidden
              >
                <surface.icon size={15} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-[14px] font-bold leading-tight tracking-tight">{surface.label}</h2>
                {surface.description && (
                  <p className="truncate text-[11px] leading-tight" style={{ color: 'var(--color-fg-subtle)' }}>{surface.description}</p>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">{surface.list}</div>
          </div>
        </Panel>

        {/*
         * Resize handle — was 1px wide which is essentially un-grabbable.
         * Now: 6px hit zone (col-resize cursor on hover) wrapping a 1px
         * visible hairline. The hit zone shows a subtle accent fill on
         * hover/drag so the user gets visual confirmation that they
         * can drag here.
         */}
        <PanelResizeHandle
          className="group relative flex w-1.5 cursor-col-resize items-stretch justify-center transition-colors data-[resize-handle-active]:bg-[color:var(--color-accent-subtle)] hover:bg-[color:var(--color-accent-subtle)]"
          aria-label="Resize panels"
        >
          <span
            aria-hidden
            className="pointer-events-none my-2 block w-px transition-colors group-hover:bg-[color:var(--color-accent)]"
            style={{ background: 'var(--color-border-subtle)' }}
          />
          {/* Tiny grab dot — surfaces only on hover/active so it doesn't add visual noise at rest. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex h-6 w-1.5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-data-[resize-handle-active]:opacity-100"
          >
            <span className="block h-3 w-[2px] rounded-full" style={{ background: 'var(--color-accent)' }} />
          </span>
        </PanelResizeHandle>

        {/* Right detail pane */}
        <Panel defaultSize={68} minSize={30} className="overflow-hidden">
          <div className="h-full overflow-y-auto">
            {surface.detail(activeItemId)}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

/** Hook to extract { surface, itemId } from /workspace/:surface/:itemId? */
export function useWorkspaceRoute() {
  const { surface, itemId } = useParams<{ surface: string; itemId?: string }>();
  return { surface: surface ?? 'content', itemId };
}
