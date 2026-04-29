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
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Link, useParams } from 'react-router-dom';
import { cn } from '../ui/cn';

interface SurfaceDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Pane composition for this surface — list pane + detail pane. */
  list: ReactNode;
  detail: (itemId: string | undefined) => ReactNode;
}

interface WorkspaceShellProps {
  surfaces: SurfaceDef[];
  /** Currently-active surface id (from URL). */
  activeSurface: string;
  /** Optional active item id within the surface (from URL). */
  activeItemId?: string;
}

export function WorkspaceShell({ surfaces, activeSurface, activeItemId }: WorkspaceShellProps) {
  const surface = surfaces.find((s) => s.id === activeSurface) ?? surfaces[0];

  return (
    <div
      className="flex h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-fg)',
      }}
    >
      {/* Left rail — surface switcher */}
      <nav
        aria-label="Workspace surfaces"
        className="flex shrink-0 flex-col items-stretch border-r p-2"
        style={{ width: 56, borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
      >
        {surfaces.map((s) => {
          const isActive = s.id === activeSurface;
          const Icon = s.icon;
          return (
            <Link
              key={s.id}
              to={`/workspace/${s.id}`}
              title={s.label}
              className={cn(
                'mb-1 flex h-10 items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-[color:var(--color-surface-hover)] text-[color:var(--color-fg)]'
                  : 'text-[color:var(--color-fg-subtle)] hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--color-fg)]'
              )}
              aria-current={isActive ? 'page' : undefined}
              aria-label={s.label}
            >
              <Icon size={16} />
            </Link>
          );
        })}
      </nav>

      <PanelGroup direction="horizontal" autoSaveId="radix.workspace.panels" className="flex-1">
        {/* Middle list pane */}
        <Panel defaultSize={32} minSize={20} maxSize={50} className="overflow-hidden">
          <div
            className="flex h-full flex-col border-r"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <h2 className="font-display text-[14px] font-bold tracking-tight">{surface.label}</h2>
            </div>
            <div className="flex-1 overflow-y-auto">{surface.list}</div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-px transition-colors hover:bg-[color:var(--color-accent)]" style={{ background: 'var(--color-border-subtle)' }} />

        {/* Right detail pane */}
        <Panel defaultSize={68} minSize={40} className="overflow-hidden">
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
