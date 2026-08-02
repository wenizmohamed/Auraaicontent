import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Plus, Search, Trash2, X, Loader2, Sparkles, Globe2,
  Wand2, ThumbsUp, AlertTriangle, Repeat, CheckCircle2, Info,
} from 'lucide-react';
import { memoryApi, type MemoryRecord, type MemoryKind } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useToast } from '../lib/toast-context';
import { EmptyState, EmptyStateAction } from '../components/ui/EmptyState';
import { SkeletonRow, SkeletonAnnouncer } from '../components/ui/Skeleton';
import { motionUI } from '../lib/motion';

// Kind metadata — each learning class gets a semantic token colour + glyph so
// the list is scannable at a glance. Tokens (not raw hex) keep it theme-aware.
const KINDS: Record<MemoryKind, { label: string; icon: React.ComponentType<{ className?: string }>; token: string }> = {
  correction: { label: 'Correction', icon: Wand2,        token: 'var(--color-warning)' },
  preference: { label: 'Preference', icon: ThumbsUp,     token: 'var(--color-accent)' },
  pattern:    { label: 'Pattern',    icon: Repeat,       token: 'var(--color-info)' },
  failure:    { label: 'Avoid',      icon: AlertTriangle, token: 'var(--color-danger)' },
  success:    { label: 'Works well', icon: CheckCircle2, token: 'var(--color-success)' },
};
const KIND_ORDER: MemoryKind[] = ['correction', 'preference', 'pattern', 'success', 'failure'];

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function KindBadge({ kind }: { kind: MemoryKind }) {
  const meta = KINDS[kind] || KINDS.preference;
  const Icon = meta.icon;
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-md px-1.5 py-0.5"
      style={{ color: meta.token, background: 'color-mix(in srgb, currentColor 12%, transparent)', border: `1px solid color-mix(in srgb, ${meta.token} 35%, transparent)` }}
    >
      <Icon className="w-2.5 h-2.5" /> {meta.label}
    </span>
  );
}

export default function AILearnings({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedClientId, currentClient, clients } = useClients();
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<MemoryKind | 'all'>('all');
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);

  // Composer state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<MemoryKind>('preference');
  const [draftScope, setDraftScope] = useState<string>('org'); // 'org' | clientId
  const [saving, setSaving] = useState(false);

  // Load the org's learnings (this client's + org-wide when a client is
  // selected; everything when none is). Re-runs when the client changes.
  function reload() {
    setLoading(true);
    memoryApi
      .list(selectedClientId || undefined)
      .then(setItems)
      .catch((err) => toastError(err?.message || 'Failed to load learnings'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    reload();
    setDraftScope(selectedClientId || 'org');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== 'all' && it.kind !== kindFilter) return false;
      if (q && !it.content.toLowerCase().includes(q) && !(it.context || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, kindFilter]);

  const clientName = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name || 'Client' : null);

  async function handleSave() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      await memoryApi.create({
        content,
        kind: draftKind,
        clientId: draftScope === 'org' ? null : draftScope,
      });
      toastSuccess('Learning saved. The AI will apply it from now on');
      setDraft('');
      setComposerOpen(false);
      reload();
    } catch (err: any) {
      toastError(err?.message || 'Failed to save learning');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    if (pendingArchive !== id) {
      setPendingArchive(id);
      setTimeout(() => setPendingArchive((c) => (c === id ? null : c)), 6000);
      return;
    }
    try {
      await memoryApi.archive(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toastSuccess('Learning archived');
    } catch (err: any) {
      toastError(err?.message || 'Archive failed');
    } finally {
      setPendingArchive(null);
    }
  }

  // "Teach the AI" trigger — rendered in the header standalone, or in a tab-local
  // toolbar when embedded (hiding the header alone would drop the only entry point).
  const teachButton = (
    <button
      type="button"
      onClick={() => setComposerOpen((o) => !o)}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
      style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
    >
      <Plus className="w-4 h-4" /> Teach the AI
    </button>
  );

  const body = (
    <>
      {/* Header — hidden in embedded mode (the merged AI Memory page owns it). */}
      {!embedded && (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={motionUI}
        className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Self-learning</p>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-3" style={{ color: 'var(--color-fg)' }}>
            <Brain className="w-6 h-6" style={{ color: 'var(--color-accent)' }} />
            AI Learnings
            {currentClient && <span className="text-sm font-medium" style={{ color: 'var(--color-fg-subtle)' }}>· {currentClient.name} + org-wide</span>}
          </h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--color-fg-muted)' }}>
            What the system has learned from your edits, rejections, and notes. Every learning is
            injected into future AI generations so the same correction never has to be made twice.
          </p>
        </div>
        {teachButton}
      </motion.div>
      )}

      {/* Embedded toolbar — keeps the Teach entry point visible without a header. */}
      {embedded && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm max-w-2xl" style={{ color: 'var(--color-fg-subtle)' }}>
            {currentClient
              ? <>Lessons the AI applies for {currentClient.name}, including org-wide rules.</>
              : 'Lessons the AI applies across every client.'}
          </p>
          {teachButton}
        </div>
      )}

      {/* Composer */}
      <AnimatePresence>
        {composerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-2xl border p-4"
            style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-sm font-bold" style={{ color: 'var(--color-fg)' }}>Teach the AI a lesson</h2>
              <span className="text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>e.g. “Always end captions with a clear CTA”</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Describe the rule, preference, or correction the AI should remember…"
              className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none"
              style={{ background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
            />
            <div className="flex items-center justify-between flex-wrap gap-3 mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Kind */}
                <select
                  value={draftKind}
                  onChange={(e) => setDraftKind(e.target.value as MemoryKind)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer focus:outline-none"
                  style={{ background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
                >
                  {KIND_ORDER.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
                </select>
                {/* Scope */}
                <select
                  value={draftScope}
                  onChange={(e) => setDraftScope(e.target.value)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer focus:outline-none"
                  style={{ background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
                >
                  <option value="org">Org-wide (all clients)</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>Only {c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setComposerOpen(false); setDraft(''); }}
                  className="px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                  style={{ color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={!draft.trim() || saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors"
                  style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                  Save learning
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters + kind stat pills */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setKindFilter('all')}
            className="text-xs font-semibold rounded-full px-3 py-1.5 transition-colors cursor-pointer"
            style={kindFilter === 'all'
              ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }
              : { color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}>
            All · {items.length}
          </button>
          {KIND_ORDER.map((k) => {
            const meta = KINDS[k];
            const active = kindFilter === k;
            return (
              <button key={k} type="button" onClick={() => setKindFilter(active ? 'all' : k)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors cursor-pointer"
                style={active
                  ? { background: 'color-mix(in srgb, ' + meta.token + ' 14%, transparent)', color: meta.token, border: `1px solid ${meta.token}` }
                  : { color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}>
                <meta.icon className="w-3 h-3" /> {meta.label} · {counts[k] || 0}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-fg-subtle)' }} />
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search learnings…"
            className="w-56 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none"
            style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
          />
        </div>
      </div>

      {/* List */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SkeletonAnnouncer label="Loading learnings…" />
          {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} delay={i * 80} />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={Brain}
          title="No learnings yet"
          description="As you edit drafts, reject posts, or leave review notes, the AI records the lesson here and applies it automatically. You can also teach it directly."
          primary={
            <EmptyStateAction onClick={() => setComposerOpen(true)}>
              <Plus className="w-4 h-4" /> Teach the first lesson
            </EmptyStateAction>
          }
        />
      )}

      {!loading && items.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--color-border)' }}>
          <Info className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--color-fg-subtle)' }} />
          <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>No learnings match this filter.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((it) => {
            const isArmed = pendingArchive === it.id;
            const scope = clientName(it.clientId);
            return (
              <motion.div
                key={it.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={motionUI}
                className="relative rounded-2xl border p-4 group transition-colors"
                style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <KindBadge kind={it.kind} />
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5"
                    style={{ color: 'var(--color-fg-subtle)', border: '1px solid var(--color-border)' }}>
                    {scope ? scope : <><Globe2 className="w-2.5 h-2.5" /> Org-wide</>}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>· {it.source}</span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--color-fg-subtle)' }}>{relTime(it.createdAt)}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>{it.content}</p>
                {it.context && (
                  <p className="text-[11px] mt-2 italic" style={{ color: 'var(--color-fg-subtle)' }}>{it.context}</p>
                )}
                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <span className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                    Applied {it.useCount}× {it.weight !== 1 ? `· weight ${it.weight}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleArchive(it.id)}
                    aria-pressed={isArmed}
                    aria-label={isArmed ? 'Confirm archive. Click again within 6s' : 'Archive this learning'}
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg cursor-pointer transition-colors ${isArmed ? 'animate-pulse' : 'opacity-0 group-hover:opacity-100'}`}
                    style={isArmed
                      ? { background: 'var(--color-danger)', color: 'var(--color-fg-on-accent)' }
                      : { color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}
                  >
                    {isArmed ? <X className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                    {isArmed ? 'Confirm' : 'Archive'}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="space-y-6">{body}</div>;
  return <div className="max-w-[1400px] mx-auto p-6 space-y-6">{body}</div>;
}
