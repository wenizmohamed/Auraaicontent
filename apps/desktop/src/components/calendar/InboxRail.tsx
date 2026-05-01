/**
 * InboxRail — unscheduled-drafts side panel for the calendar surface.
 *
 * Lists content pieces with no `scheduledFor` and makes each one draggable
 * via @dnd-kit. The day cells in ContentCalendar become drop targets
 * (see useDayDroppable hook below). On drop the piece is patched to the
 * dropped day; we toast and emit a callback so the parent can refetch.
 *
 * Designed as a 280px right rail; collapses to a top-of-page horizontal
 * scroller below lg.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { useDraggable, useDroppable, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { Inbox, GripVertical, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { contentPiecesApi, type ContentPieceRecord } from '../../lib/backend-api';
import { motionUI } from '../../lib/motion';

interface InboxRailProps {
  clientId: string | null;
  /** Optional callback invoked after a successful drop, so the parent can refetch. */
  onDrop?: (pieceId: string, dayIso: string) => void;
}

export function InboxRail({ clientId, onDrop }: InboxRailProps) {
  const [drafts, setDrafts] = useState<ContentPieceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId) { setDrafts([]); return; }
    let cancelled = false;
    setLoading(true);
    contentPiecesApi.list(clientId)
      .then(rows => {
        if (cancelled) return;
        setDrafts(rows.filter(r => !r.scheduledFor));
      })
      .catch(() => { if (!cancelled) setDrafts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <aside
      className="hidden lg:flex w-[280px] flex-shrink-0 flex-col rounded-2xl border overflow-hidden"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-subtle)',
      }}
      aria-label="Unscheduled drafts"
    >
      <header
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5" style={{ color: 'var(--color-accent)' }} />
          <h3 className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>
            Unscheduled
          </h3>
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-fg-subtle)' }}>
          {loading ? '…' : drafts.length}
        </span>
      </header>
      <ul className="flex-1 overflow-auto p-2 space-y-1.5">
        {loading ? (
          <li className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--color-accent)' }} />
          </li>
        ) : drafts.length === 0 ? (
          <li className="px-2 py-6 text-center">
            <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
              All drafts scheduled. Generate or drop more here.
            </p>
          </li>
        ) : (
          drafts.map(d => <DraftCard key={d.id} piece={d} />)
        )}
      </ul>
      <footer
        className="border-t px-3 py-2"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <p className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
          Drag onto a day to schedule.
        </p>
      </footer>
    </aside>
  );
}

function DraftCard({ piece }: { piece: ContentPieceRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: piece.id,
    data: { piece },
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    background: 'var(--color-surface)',
    borderColor: 'var(--color-border-subtle)',
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group flex cursor-grab items-start gap-2 rounded-lg border px-2 py-1.5 active:cursor-grabbing"
    >
      <GripVertical className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-fg-subtle)' }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
          >
            {(piece as any).platform || 'post'}
          </span>
        </div>
        <p
          className="mt-0.5 line-clamp-2 text-[11px] leading-snug"
          style={{ color: 'var(--color-fg)' }}
        >
          {(piece as any).caption || (piece as any).brief || '(no caption)'}
        </p>
      </div>
    </li>
  );
}

/**
 * Hook for day-cell consumers — wraps useDroppable with the day's Date,
 * exposing the over-state for visual feedback.
 */
export function useDayDroppable(dayDate: Date) {
  const id = `day-${dayDate.toISOString().slice(0, 10)}`;
  const { isOver, setNodeRef } = useDroppable({ id, data: { dayDate } });
  return { setNodeRef, isOver, dropTargetId: id };
}

/**
 * Provider that wires the actual update mutation. Wrap the calendar +
 * inbox rail in this so drag-end fires the patch.
 */
export function CalendarDndProvider({ onDrop, children }: { onDrop?: (pieceId: string, dayIso: string) => void; children: React.ReactNode }) {
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);

  function handleDragEnd(e: DragEndEvent) {
    const pieceId = String(e.active.id);
    const dayDate = (e.over?.data?.current as any)?.dayDate as Date | undefined;
    if (!dayDate) return;
    const iso = dayDate.toISOString();
    contentPiecesApi.update(pieceId, { scheduledFor: iso } as any)
      .then(() => {
        toast.success(`Scheduled for ${dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
        onDropRef.current?.(pieceId, iso);
      })
      .catch((err: any) => toast.error(err?.message || 'Schedule failed'));
  }

  return <DndContext onDragEnd={handleDragEnd}>{children}</DndContext>;
}

export default InboxRail;
