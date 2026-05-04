/**
 * /history — Universal AI generation history.
 *
 * Every image / video / text / research / brand-synthesis / analyze /
 * design call writes one row to /api/history via lib/history.service.ts.
 * This page lets the user scroll back through everything they generated,
 * filter by type / client / status, restore a prompt, or open the asset.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBase } from '../lib/motion';
import { Image as ImageIcon, Video, FileText, Search, Palette, Wand2, Sparkles, History as HistoryIcon, Trash2, Copy, ExternalLink, AlertCircle, Filter } from 'lucide-react';
import { historyApi, type GenerationSummary, type GenerationType } from '../lib/backend-api';
import { EmptyState } from '../components/ui/EmptyState';
import { toast } from 'sonner';

const TYPE_TABS: Array<{ id: GenerationType | 'all'; label: string; icon: any }> = [
  { id: 'all',              label: 'All',          icon: Sparkles },
  { id: 'image',            label: 'Images',       icon: ImageIcon },
  { id: 'video',            label: 'Videos',       icon: Video },
  { id: 'research',         label: 'Research',     icon: Search },
  { id: 'brand_synthesis',  label: 'Synthesis',    icon: Wand2 },
  { id: 'design',           label: 'Design',       icon: Palette },
  { id: 'analyze',          label: 'Analyze',      icon: FileText },
  { id: 'text',             label: 'Text',         icon: FileText },
];

const TYPE_ICON: Record<string, any> = {
  image: ImageIcon, video: Video, text: FileText, research: Search,
  brand_synthesis: Wand2, design: Palette, analyze: FileText,
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function groupByDay(items: GenerationSummary[]): Array<{ day: string; items: GenerationSummary[] }> {
  const buckets = new Map<string, GenerationSummary[]>();
  for (const it of items) {
    const d = new Date(it.createdAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const itemDay = new Date(d);
    itemDay.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - itemDay.getTime()) / (24 * 60 * 60 * 1000));
    let label: string;
    if (diffDays === 0) label = 'Today';
    else if (diffDays === 1) label = 'Yesterday';
    else if (diffDays < 7) label = d.toLocaleDateString(undefined, { weekday: 'long' });
    else label = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(it);
  }
  return Array.from(buckets.entries()).map(([day, items]) => ({ day, items }));
}

export default function History() {
  const [items, setItems] = useState<GenerationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<GenerationType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const [previewing, setPreviewing] = useState<GenerationSummary | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load on filter change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    historyApi
      .list({
        type: activeType === 'all' ? undefined : activeType,
        q: searchDebounced || undefined,
        limit: 60,
      })
      .then(r => {
        if (cancelled) return;
        setItems(r.items);
        setCursor(r.nextCursor);
        setHasMore(r.hasMore);
      })
      .catch(e => !cancelled && toast.error(`Failed to load history: ${e.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [activeType, searchDebounced]);

  // Stats once
  useEffect(() => {
    historyApi.stats().then(setStats).catch(() => {});
  }, [items.length]);

  const loadMore = async () => {
    if (!cursor || !hasMore) return;
    const r = await historyApi.list({
      type: activeType === 'all' ? undefined : activeType,
      q: searchDebounced || undefined,
      limit: 60,
      cursor,
    });
    setItems(prev => [...prev, ...r.items]);
    setCursor(r.nextCursor);
    setHasMore(r.hasMore);
  };

  const handleDelete = async (id: string) => {
    const ok = confirm('Delete this from history? The generation itself stays in storage if you saved it as an asset.');
    if (!ok) return;
    try {
      await historyApi.delete(id);
      setItems(prev => prev.filter(i => i.id !== id));
      if (previewing?.id === id) setPreviewing(null);
      toast.success('Deleted');
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`);
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success('Prompt copied');
  };

  const grouped = useMemo(() => groupByDay(items), [items]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionBase}
      className="mx-auto max-w-[1200px] p-6 lg:p-8 space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl tracking-tight" style={{ color: 'var(--color-fg)' }}>
            History
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-fg-muted)' }}>
            Every prompt you've ever run — images, videos, research, design briefs.
            {stats && stats.total > 0 && (
              <> <span style={{ color: 'var(--color-fg-subtle)' }}>· {stats.total.toLocaleString()} total</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
          <HistoryIcon className="w-3.5 h-3.5" />
          Auto-saved server-side
        </div>
      </div>

      {/* Search + filter row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--color-fg-subtle)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts…"
            aria-label="Search generation prompts"
            className="w-full pl-10 pr-4 py-2.5 rounded-md text-sm focus:outline-none focus:ring-1"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-fg)',
              border: '1px solid var(--color-border-subtle)',
            }}
          />
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex flex-wrap gap-1.5 border-b pb-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {TYPE_TABS.map(t => {
          const TabIcon = t.icon;
          const isActive = activeType === t.id;
          const count = t.id === 'all' ? stats?.total : stats?.byType?.[t.id];
          return (
            <button
              key={t.id}
              onClick={() => setActiveType(t.id)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
              style={{
                background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                color: isActive ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                border: '1px solid',
                borderColor: isActive ? 'var(--color-accent)' : 'transparent',
              }}
              aria-pressed={isActive}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {t.label}
              {count != null && count > 0 && (
                <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg animate-pulse"
              style={{ background: 'var(--color-surface)' }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title={searchDebounced ? `No history matches "${searchDebounced}"` : 'No generations yet'}
          description={searchDebounced
            ? 'Try a different search or switch tabs.'
            : 'Open Creative Tools, Studio, or Research and run a prompt — it lands here automatically.'}
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <section key={group.day}>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-fg-subtle)' }}>
                {group.day}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {group.items.map(item => {
                  const Icon = TYPE_ICON[item.type] || Sparkles;
                  const isFailed = item.status === 'failed';
                  const isVisual = item.type === 'image' || item.type === 'video';
                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => setPreviewing(item)}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className="group relative text-left rounded-lg overflow-hidden transition-shadow"
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                      aria-label={`Open ${item.type} generation: ${item.prompt.slice(0, 60)}`}
                    >
                      {/* Thumbnail / placeholder */}
                      <div
                        className="aspect-square relative flex items-center justify-center"
                        style={{ background: 'var(--color-bg)' }}
                      >
                        {isVisual && item.thumbnailUrl ? (
                          <>
                            {item.type === 'video' ? (
                              <video
                                src={item.thumbnailUrl}
                                muted
                                playsInline
                                preload="metadata"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <img
                                src={item.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                            )}
                          </>
                        ) : (
                          <Icon className="w-8 h-8 opacity-40" style={{ color: 'var(--color-fg-muted)' }} />
                        )}
                        {/* Type pill */}
                        <span
                          className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase"
                          style={{
                            background: 'var(--color-bg)',
                            color: 'var(--color-fg-muted)',
                            border: '1px solid var(--color-border-subtle)',
                          }}
                        >
                          {item.type === 'brand_synthesis' ? 'synth' : item.type}
                        </span>
                        {isFailed && (
                          <span
                            className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-1"
                            style={{ background: 'var(--color-bg)', color: '#ef4444', border: '1px solid currentColor' }}
                          >
                            <AlertCircle className="w-3 h-3" /> failed
                          </span>
                        )}
                      </div>
                      {/* Footer */}
                      <div className="p-3 space-y-1.5">
                        <p
                          className="text-xs leading-snug line-clamp-2"
                          style={{ color: 'var(--color-fg)' }}
                          title={item.prompt}
                        >
                          {item.prompt}
                        </p>
                        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                          <span>{formatRelative(item.createdAt)}</span>
                          {item.provider && <span className="font-mono">{item.provider}</span>}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={loadMore}
                className="px-4 py-2 text-sm rounded-md transition-colors"
                style={{
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-fg-muted)',
                  background: 'var(--color-surface)',
                }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview drawer */}
      <AnimatePresence>
        {previewing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewing(null)}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            role="dialog"
            aria-modal="true"
            aria-label="Generation preview"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={motionBase}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-3xl rounded-xl overflow-hidden max-h-[90vh] flex flex-col"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {/* Preview body */}
              {(previewing.type === 'image' || previewing.type === 'video') && previewing.outputUrl ? (
                <div className="bg-black flex items-center justify-center max-h-[50vh] overflow-hidden">
                  {previewing.type === 'video' ? (
                    <video src={previewing.outputUrl} controls className="max-w-full max-h-[50vh]" />
                  ) : (
                    <img src={previewing.outputUrl} alt={previewing.prompt} className="max-w-full max-h-[50vh] object-contain" />
                  )}
                </div>
              ) : null}
              <div className="p-6 space-y-4 overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase mb-1" style={{ color: 'var(--color-fg-subtle)' }}>
                      {previewing.type} · {previewing.surface || 'unknown surface'} · {formatRelative(previewing.createdAt)}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{previewing.prompt}</p>
                  </div>
                  <button
                    onClick={() => setPreviewing(null)}
                    className="text-xs px-2 py-1"
                    style={{ color: 'var(--color-fg-muted)' }}
                    aria-label="Close preview"
                  >
                    ✕
                  </button>
                </div>

                {previewing.outputText && (
                  <pre
                    className="text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-fg-muted)',
                      border: '1px solid var(--color-border-subtle)',
                      maxHeight: '300px',
                    }}
                  >{previewing.outputText}</pre>
                )}

                {previewing.error && (
                  <div
                    className="text-xs p-3 rounded"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    <strong>Error:</strong> {previewing.error}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                  {previewing.provider && <div><span style={{ color: 'var(--color-fg-subtle)' }}>Provider:</span> <span className="font-mono">{previewing.provider}</span></div>}
                  {previewing.model && <div><span style={{ color: 'var(--color-fg-subtle)' }}>Model:</span> <span className="font-mono">{previewing.model}</span></div>}
                  {previewing.latencyMs != null && <div><span style={{ color: 'var(--color-fg-subtle)' }}>Latency:</span> {previewing.latencyMs}ms</div>}
                  {previewing.client && <div><span style={{ color: 'var(--color-fg-subtle)' }}>Client:</span> {previewing.client.name}</div>}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <button
                    onClick={() => copyPrompt(previewing.prompt)}
                    className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors"
                    style={{
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent)',
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy prompt
                  </button>
                  {previewing.outputUrl && (
                    <a
                      href={previewing.outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors"
                      style={{
                        background: 'var(--color-surface)',
                        color: 'var(--color-fg-muted)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open output
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(previewing.id)}
                    className="ml-auto px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors"
                    style={{
                      background: 'transparent',
                      color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.4)',
                    }}
                    aria-label="Delete from history"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
