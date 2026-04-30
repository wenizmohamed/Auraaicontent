/**
 * Workspace.CalendarDetail — read-only month preview for the workspace
 * shell's right pane. Shows the day grid + post-per-cell counts; full
 * editing surface stays at /calendar.
 *
 * Lifts the day-cell math from pages/ContentCalendar.tsx (firstDayOffset +
 * daysInMonth) but renders a stripped-down preview — no drag, no density
 * toggle, no archive controls. Tap "Open editor" to deep-link out.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import { calendarApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { Badge, Button, EmptyState, Separator } from '../components/ui';

function parseMonthLabel(month: string): { date: Date; label: string } {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y || new Date().getFullYear(), (m || 1) - 1, 1);
  const label = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return { date, label };
}

export default function CalendarDetail({ pieceId: monthSlug }: { pieceId: string }) {
  const navigate = useNavigate();
  const { selectedClientId } = useClients();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    calendarApi.getMonth(selectedClientId, decodeURIComponent(monthSlug))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthSlug, selectedClientId]);

  const { date, label } = useMemo(() => parseMonthLabel(monthSlug), [monthSlug]);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOffset = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const postsByDay = useMemo(() => {
    const map: Record<number, any[]> = {};
    if (data?.posts?.length) {
      for (const p of data.posts) {
        const raw = p.date || p.suggestedDate;
        if (!raw) continue;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) continue;
        const day = d.getDate();
        (map[day] ||= []).push(p);
      }
    }
    return map;
  }, [data]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={ExternalLink}
          title="Month not found"
          description="It may have been archived, or it belongs to a different client."
          compact
        />
      </div>
    );
  }

  const totalPosts = data?.posts?.length ?? 0;
  const status = data?.status ?? 'draft';

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {label}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge subtle tone="accent">{status}</Badge>
            <Badge subtle>{totalPosts} posts</Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => navigate(`/calendar?month=${encodeURIComponent(monthSlug)}`)}
        >
          Open editor
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-7 gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-1 py-1 text-center">{d}</div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-1 rounded-xl border p-2"
        style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
      >
        {Array.from({ length: firstDayOffset }).map((_, i) => (
          <div key={`pad-${i}`} className="aspect-square" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const posts = postsByDay[day] ?? [];
          return (
            <div
              key={day}
              className="aspect-square rounded-md p-1.5 text-[11px] transition-colors"
              style={{
                background: posts.length ? 'var(--color-surface)' : 'transparent',
                borderColor: 'var(--color-border-subtle)',
                border: '1px solid',
                color: 'var(--color-fg-muted)',
              }}
            >
              <div className="flex items-start justify-between">
                <span className="font-semibold" style={{ color: 'var(--color-fg)' }}>{day}</span>
                {posts.length > 0 && (
                  <span
                    className="rounded-full px-1 text-[9px] font-bold"
                    style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                  >
                    {posts.length}
                  </span>
                )}
              </div>
              {posts.slice(0, 2).map((p, idx) => (
                <div
                  key={idx}
                  className="mt-0.5 line-clamp-1 text-[9px] leading-tight"
                  style={{ color: 'var(--color-fg-subtle)' }}
                >
                  {p.platform || p.type || 'post'}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
