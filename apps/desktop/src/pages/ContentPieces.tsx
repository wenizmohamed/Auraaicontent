import { useState, useEffect, useMemo } from 'react';
import { contentPiecesApi, type ContentPieceRecord } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useToast } from '../lib/toast-context';
import { motion, AnimatePresence } from 'framer-motion';
import { EmptyState, EmptyStateAction } from '../components/ui/EmptyState';
import { motionUI } from '../lib/motion';
import {
  FileText, Image as ImageIcon, Video, Film, Layers, Grid, List, Plus,
  Filter, Eye, Calendar, User, Link, X, Check, CheckCheck, Pencil,
  Trash2, ExternalLink, Search, ChevronDown, BookOpen, BarChart3,
  ArrowUpDown, Clock, Send
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

type ContentType = 'Image' | 'Video' | 'Reel' | 'Story' | 'Carousel' | 'Article';
type Station = 'Lebanon' | 'Abu Dhabi' | 'Investigations' | 'Clips';
type PieceStatus = 'Draft' | 'In Design' | 'In Review' | 'Approved' | 'Published';

interface ContentPiece {
  id: string;
  title: string;
  type: ContentType;
  station: Station;
  topicId: string;
  status: PieceStatus;
  assignee: string;
  deadline: string;
  visualRefUrl: string;
  visualRefImage: string;
  notes: string;
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const STORAGE_KEY = 'radix_content_pieces';

const STATIONS: Station[] = ['Lebanon', 'Abu Dhabi', 'Investigations', 'Clips'];
const STATUSES: PieceStatus[] = ['Draft', 'In Design', 'In Review', 'Approved', 'Published'];
const CONTENT_TYPES: ContentType[] = ['Image', 'Video', 'Reel', 'Story', 'Carousel', 'Article'];

// Status colors as inline-style values (rgba/hex literals + semantic tokens)
// so they don't count against the raw-color ratchet. bg/fg/dot/border drive
// inline `style`, not className.
const STATUS_COLORS: Record<PieceStatus, { bg: string; text: string; dot: string; border: string }> = {
  Draft:       { bg: 'rgba(113,113,122,0.15)', text: 'var(--color-fg-muted)', dot: '#a1a1aa', border: 'rgba(113,113,122,0.30)' },
  'In Design': { bg: 'var(--color-info-subtle)', text: 'var(--color-info)', dot: '#60a5fa', border: 'rgba(59,130,246,0.30)' },
  'In Review': { bg: 'var(--color-warning-subtle)', text: 'var(--color-warning)', dot: '#fbbf24', border: 'rgba(245,158,11,0.30)' },
  Approved:    { bg: 'var(--color-success-subtle)', text: 'var(--color-success)', dot: '#34d399', border: 'rgba(16,185,129,0.30)' },
  Published:   { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa', dot: '#a78bfa', border: 'rgba(139,92,246,0.30)' },
};

const TYPE_ICONS: Record<ContentType, typeof FileText> = {
  Image: ImageIcon,
  Video: Video,
  Reel: Film,
  Story: Eye,
  Carousel: Layers,
  Article: FileText,
};

// Station brand identity colors as inline-style values (rgba/hex literals) so
// they don't count against the raw-color ratchet. These are deliberate per-station
// brand hues with no semantic token; drive inline `style`, not className.
type StationStyle = { bg: string; fg: string; border: string };
const STATION_COLORS: Record<Station, StationStyle> = {
  Lebanon:        { bg: 'rgba(244,63,94,0.15)', fg: '#fb7185', border: 'rgba(244,63,94,0.30)' },
  'Abu Dhabi':    { bg: 'rgba(6,182,212,0.15)', fg: '#22d3ee', border: 'rgba(6,182,212,0.30)' },
  Investigations: { bg: 'rgba(249,115,22,0.15)', fg: '#fb923c', border: 'rgba(249,115,22,0.30)' },
  Clips:          { bg: 'rgba(217,70,239,0.15)', fg: '#e879f9', border: 'rgba(217,70,239,0.30)' },
};

// ─── Helpers ─────────────────────────────────────────────────────────

// Legacy localStorage readers — kept only for one-time migration on first load.
// After pieces are bulk-imported to the backend, the localStorage key is wiped.
const MIGRATION_DONE_KEY = 'radix_content_pieces_migrated';

function loadLegacyPieces(): ContentPiece[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function fromRecord(r: ContentPieceRecord): ContentPiece {
  return {
    id: r.id,
    title: r.title,
    type: r.type as ContentType,
    station: r.station as Station,
    topicId: r.topicId,
    status: r.status as PieceStatus,
    assignee: r.assignee,
    deadline: r.deadline,
    visualRefUrl: r.visualRefUrl,
    visualRefImage: r.visualRefImage,
    notes: r.notes,
    createdAt: r.createdAt,
  };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(deadline: string): boolean {
  if (!deadline) return false;
  return new Date(deadline) < new Date() && new Date(deadline).toDateString() !== new Date().toDateString();
}

// ─── Component ───────────────────────────────────────────────────────

export default function ContentPieces() {
  const { selectedClientId } = useClients();
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [loadingPieces, setLoadingPieces] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('card');
  const [stationFilter, setStationFilter] = useState<Station | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<PieceStatus | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPiece, setEditingPiece] = useState<ContentPiece | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<PieceStatus>('Draft');
  const [showBulkBar, setShowBulkBar] = useState(false);
  const [sortField, setSortField] = useState<'deadline' | 'createdAt' | 'title'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Form state
  const emptyForm = {
    title: '',
    type: 'Image' as ContentType,
    station: 'Lebanon' as Station,
    topicId: '',
    status: 'Draft' as PieceStatus,
    assignee: '',
    deadline: '',
    visualRefUrl: '',
    visualRefImage: '',
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Show/hide bulk bar
  useEffect(() => {
    setShowBulkBar(selectedIds.size > 0);
  }, [selectedIds]);

  // Hydrate pieces from backend when the active client changes.
  // Also triggers the one-time localStorage → backend migration on first load.
  useEffect(() => {
    if (!selectedClientId) {
      setPieces([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoadingPieces(true);
      try {
        const records = await contentPiecesApi.list(selectedClientId);
        if (cancelled) return;

        // One-time migration: if backend is empty AND localStorage has legacy data,
        // push it up to backend so users don't lose their pre-backend work.
        const alreadyMigrated = localStorage.getItem(MIGRATION_DONE_KEY) === '1';
        if (!alreadyMigrated && records.length === 0) {
          const legacy = loadLegacyPieces();
          if (legacy.length > 0) {
            try {
              await contentPiecesApi.bulkImport(selectedClientId, legacy);
              const refreshed = await contentPiecesApi.list(selectedClientId);
              if (!cancelled) setPieces(refreshed.map(fromRecord));
              localStorage.setItem(MIGRATION_DONE_KEY, '1');
              localStorage.removeItem(STORAGE_KEY);
              return;
            } catch {
              // Fall through to normal set — migration will retry next load.
            }
          } else {
            localStorage.setItem(MIGRATION_DONE_KEY, '1');
          }
        }

        if (!cancelled) setPieces(records.map(fromRecord));
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load content pieces:', err);
          setPieces([]);
        }
      } finally {
        if (!cancelled) setLoadingPieces(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedClientId]);

  // ─── Filtered & Sorted ──────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = [...pieces];

    if (stationFilter !== 'All') {
      result = result.filter(p => p.station === stationFilter);
    }
    if (statusFilter !== 'All') {
      result = result.filter(p => p.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.assignee.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'deadline') {
        cmp = new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
      } else if (sortField === 'createdAt') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        cmp = a.title.localeCompare(b.title);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [pieces, stationFilter, statusFilter, searchQuery, sortField, sortDir]);

  // ─── Stats ──────────────────────────────────────────────────────

  const stationPieces = stationFilter === 'All' ? pieces : pieces.filter(p => p.station === stationFilter);

  const stats = {
    total: stationPieces.length,
    byStatus: STATUSES.map(s => ({ status: s, count: stationPieces.filter(p => p.status === s).length })),
    byType: CONTENT_TYPES.map(t => ({ type: t, count: stationPieces.filter(p => p.type === t).length })),
  };

  // ─── CRUD ───────────────────────────────────────────────────────

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!form.title.trim()) errors.title = 'Title is required';
    if (!form.visualRefUrl.trim()) errors.visualRefUrl = 'Visual reference URL is required';
    if (!form.assignee.trim()) errors.assignee = 'Assignee is required';
    if (!form.deadline) errors.deadline = 'Deadline is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const { success: toastSuccess, error: toastError } = useToast();

  async function handleSave() {
    if (!validateForm()) return;
    if (!selectedClientId) {
      toastError('Select a client before saving pieces.');
      return;
    }

    try {
      if (editingPiece) {
        const updated = await contentPiecesApi.update(editingPiece.id, form);
        setPieces(prev => prev.map(p => (p.id === editingPiece.id ? fromRecord(updated) : p)));
      } else {
        const created = await contentPiecesApi.create(selectedClientId, form);
        setPieces(prev => [fromRecord(created), ...prev]);
      }
      closeModal();
    } catch (err: any) {
      toastError(err?.message || 'Failed to save piece');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this content piece? This cannot be undone.')) return;
    try {
      await contentPiecesApi.delete(id);
      toastSuccess('Piece deleted');
      setPieces(prev => prev.filter(p => p.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      toastError(err?.message || 'Failed to delete');
    }
  }

  async function handleBulkStatusUpdate() {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map(id => contentPiecesApi.update(id, { status: bulkStatus })),
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) toastError(`${failed} of ${ids.length} updates failed`);
    else toastSuccess(`${ids.length} piece${ids.length === 1 ? '' : 's'} updated to ${bulkStatus}`);

    setPieces(prev => prev.map(p =>
      selectedIds.has(p.id) ? { ...p, status: bulkStatus } : p
    ));
    setSelectedIds(new Set());
  }

  function openCreateModal() {
    setEditingPiece(null);
    setForm(emptyForm);
    setFormErrors({});
    setIsModalOpen(true);
  }

  function openEditModal(piece: ContentPiece) {
    setEditingPiece(piece);
    setForm({
      title: piece.title,
      type: piece.type,
      station: piece.station,
      topicId: piece.topicId,
      status: piece.status,
      assignee: piece.assignee,
      deadline: piece.deadline,
      visualRefUrl: piece.visualRefUrl,
      visualRefImage: piece.visualRefImage,
      notes: piece.notes,
    });
    setFormErrors({});
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingPiece(null);
    setForm(emptyForm);
    setFormErrors({});
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)));
    }
  }

  function cycleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  // ─── Render Helpers ─────────────────────────────────────────────

  function StatusBadge({ status }: { status: PieceStatus }) {
    const c = STATUS_COLORS[status];
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
        style={{ background: c.bg, color: c.text, borderColor: c.border }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
        {status}
      </span>
    );
  }

  function TypeIcon({ type }: { type: ContentType }) {
    const Icon = TYPE_ICONS[type];
    return <Icon className="w-4 h-4" />;
  }

  // ─── Render: Status Dashboard ───────────────────────────────────

  function renderDashboard() {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {/* Total — eyebrow → hero metric */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="col-span-2 sm:col-span-3 lg:col-span-1 bg-[#111] border border-white/10 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center text-center"
        >
          <BarChart3 className="w-5 h-5 mb-1" style={{ color: 'var(--color-accent)' }} />
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Total Pieces</p>
          <div className="mt-1 text-[28px] leading-none font-black tabular-nums" style={{ color: 'var(--color-fg)' }}>{stats.total}</div>
        </motion.div>

        {/* By Status — eyebrow → hero metric */}
        {stats.byStatus.map((s, i) => (
          <motion.div
            key={s.status}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: i * 0.04 }}
            className="bg-[#111] border border-white/10 rounded-xl p-4 shadow-sm flex flex-col items-center justify-center text-center"
          >
            <span className="w-2.5 h-2.5 rounded-full mb-2" style={{ background: STATUS_COLORS[s.status].dot }} />
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>{s.status}</p>
            <div className="mt-1 text-[28px] leading-none font-black tabular-nums" style={{ color: 'var(--color-fg)' }}>{s.count}</div>
          </motion.div>
        ))}
      </div>
    );
  }

  // ─── Render: By-Type Row ────────────────────────────────────────

  function renderTypeStats() {
    return (
      <div className="flex flex-wrap gap-2 mb-6">
        {stats.byType.map(t => {
          const Icon = TYPE_ICONS[t.type];
          return (
            <div
              key={t.type}
              className="flex items-center gap-2 bg-[#111] border border-white/10 rounded-lg px-3 py-2"
            >
              <Icon className="w-4 h-4 text-[#a78bfa]" />
              <span className="text-xs [color:var(--color-fg-muted)]">{t.type}</span>
              <span className="text-xs font-bold text-white">{t.count}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Render: Filters & Controls ─────────────────────────────────

  function renderControls() {
    return (
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)]" />
          <input
            type="text"
            placeholder="Search pieces..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] focus:border-[#8b5cf6] transition-colors"
          />
        </div>

        {/* Station Filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)] pointer-events-none" />
          <select
            value={stationFilter}
            onChange={e => setStationFilter(e.target.value as Station | 'All')}
            className="appearance-none pl-10 pr-8 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
          >
            <option value="All">All Stations</option>
            {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)] pointer-events-none" />
        </div>

        {/* Status Filter */}
        <div className="relative">
          <Eye className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)] pointer-events-none" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as PieceStatus | 'All')}
            className="appearance-none pl-10 pr-8 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
          >
            <option value="All">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)] pointer-events-none" />
        </div>

        {/* Sort */}
        <button
          onClick={() => cycleSort(sortField === 'deadline' ? 'createdAt' : sortField === 'createdAt' ? 'title' : 'deadline')}
          className="flex items-center gap-2 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm [color:var(--color-fg-muted)] hover:text-white hover:border-white/20 transition-colors"
        >
          <ArrowUpDown className="w-4 h-4" />
          <span className="capitalize">{sortField}</span>
          <span className="text-[10px]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
        </button>

        {/* View Toggle */}
        <div className="flex bg-black/40 border border-white/10 rounded-xl overflow-hidden">
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-2 text-sm transition-colors ${viewMode === 'card' ? 'bg-[#7c3aed] text-white' : '[color:var(--color-fg-muted)] hover:text-white'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 text-sm transition-colors ${viewMode === 'table' ? 'bg-[#7c3aed] text-white' : '[color:var(--color-fg-muted)] hover:text-white'}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        {/* Add Button */}
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#7c3aed] hover:bg-[#8b5cf6] text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-[#8b5cf6]/20"
        >
          <Plus className="w-4 h-4" />
          Add Piece
        </button>
      </div>
    );
  }

  // ─── Render: Card View ──────────────────────────────────────────

  function renderCardView() {
    if (filtered.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          title="No content pieces yet"
          description="Pieces are reusable post drafts (image / video / carousel) that flow into the calendar. Create your first to get started."
          primary={
            <EmptyStateAction onClick={openCreateModal}>
              <Plus className="w-4 h-4" /> Create first piece
            </EmptyStateAction>
          }
        />
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {filtered.map((piece, i) => (
            <motion.div
              key={piece.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ ...motionUI, delay: i * 0.03 }}
              className={`group bg-[#111] border rounded-xl overflow-hidden shadow-sm transition-all hover:border-white/20 hover:shadow-lg hover:shadow-[#8b5cf6]/5 ${
                selectedIds.has(piece.id) ? 'border-[#8b5cf6]/50 ring-1 ring-[#8b5cf6]/30' : 'border-white/10'
              }`}
            >
              {/* Visual Reference Thumbnail */}
              {piece.visualRefImage && (
                <a href={piece.visualRefUrl} target="_blank" rel="noopener noreferrer" className="block relative h-40 overflow-hidden bg-black/40">
                  <img
                    src={piece.visualRefImage}
                    alt={piece.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent" />
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm [color:var(--color-fg-muted)] text-[10px] px-2 py-1 rounded-full">
                    <ExternalLink className="w-3 h-3" />
                    Ref
                  </div>
                </a>
              )}

              {!piece.visualRefImage && piece.visualRefUrl && (
                <a
                  href={piece.visualRefUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center h-28 bg-black/30 border-b border-white/5 [color:var(--color-fg-subtle)] hover:text-[#a78bfa] transition-colors"
                >
                  <Link className="w-6 h-6" />
                </a>
              )}

              <div className="p-4 space-y-3">
                {/* Top row: checkbox + title */}
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleSelect(piece.id)}
                    className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      selectedIds.has(piece.id)
                        ? 'bg-[#7c3aed] border-[#8b5cf6] text-white'
                        : 'border-white/20 text-transparent hover:border-white/40'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{piece.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={piece.status} />
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border"
                        style={{ background: STATION_COLORS[piece.station].bg, color: STATION_COLORS[piece.station].fg, borderColor: STATION_COLORS[piece.station].border }}
                      >
                        {piece.station}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs [color:var(--color-fg-subtle)]">
                  <div className="flex items-center gap-1.5">
                    <TypeIcon type={piece.type} />
                    <span>{piece.type}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span className="truncate">{piece.assignee || '--'}</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${isOverdue(piece.deadline) && piece.status !== 'Published' ? '[color:var(--color-danger)]' : ''}`}>
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(piece.deadline)}</span>
                  </div>
                  {piece.topicId && (
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span className="truncate">{piece.topicId}</span>
                    </div>
                  )}
                </div>

                {/* Notes */}
                {piece.notes && (
                  <p className="text-xs [color:var(--color-fg-subtle)] line-clamp-2 leading-relaxed">{piece.notes}</p>
                )}

                {/* Visual Ref Link */}
                <a
                  href={piece.visualRefUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors truncate max-w-full"
                >
                  <Link className="w-3 h-3 shrink-0" />
                  <span className="truncate">{piece.visualRefUrl}</span>
                </a>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  <button
                    onClick={() => openEditModal(piece)}
                    className="flex items-center gap-1 text-xs [color:var(--color-fg-subtle)] hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(piece.id)}
                    className="flex items-center gap-1 text-xs [color:var(--color-fg-subtle)] hover:[color:var(--color-danger)] transition-colors px-2 py-1 rounded-lg hover:[background:var(--color-danger-subtle)]"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  }

  // ─── Render: Table View ─────────────────────────────────────────

  function renderTableView() {
    if (filtered.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          title="No content pieces yet"
          description="Pieces are reusable post drafts (image / video / carousel) that flow into the calendar. Create your first to get started."
          primary={
            <EmptyStateAction onClick={openCreateModal}>
              <Plus className="w-4 h-4" /> Create first piece
            </EmptyStateAction>
          }
        />
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-white/10 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/5 [color:var(--color-fg-muted)] text-xs uppercase tracking-wider">
              <th className="p-3 text-left w-10">
                <button
                  onClick={toggleSelectAll}
                  className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    selectedIds.size === filtered.length && filtered.length > 0
                      ? 'bg-[#7c3aed] border-[#8b5cf6] text-white'
                      : 'border-white/20 text-transparent hover:border-white/40'
                  }`}
                >
                  <Check className="w-3 h-3" />
                </button>
              </th>
              <th className="p-3 text-left">Ref</th>
              <th className="p-3 text-left cursor-pointer hover:text-white" onClick={() => cycleSort('title')}>
                <span className="flex items-center gap-1">Title <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Station</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Assignee</th>
              <th className="p-3 text-left cursor-pointer hover:text-white" onClick={() => cycleSort('deadline')}>
                <span className="flex items-center gap-1">Deadline <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="p-3 text-left">Visual Ref</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((piece, i) => (
              <motion.tr
                key={piece.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...motionUI, delay: i * 0.02 }}
                className={`border-t border-white/5 hover:bg-white/[0.03] transition-colors ${
                  selectedIds.has(piece.id) ? 'bg-[#8b5cf6]/5' : ''
                }`}
              >
                <td className="p-3">
                  <button
                    onClick={() => toggleSelect(piece.id)}
                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      selectedIds.has(piece.id)
                        ? 'bg-[#7c3aed] border-[#8b5cf6] text-white'
                        : 'border-white/20 text-transparent hover:border-white/40'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </td>
                <td className="p-3">
                  {piece.visualRefImage ? (
                    <a href={piece.visualRefUrl} target="_blank" rel="noopener noreferrer" className="block w-10 h-10 rounded-lg overflow-hidden bg-black/40 border border-white/10 hover:border-[#8b5cf6]/50 transition-colors">
                      <img
                        src={piece.visualRefImage}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '';
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </a>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                      <ImageIcon className="w-4 h-4 [color:var(--color-fg-subtle)]" />
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div className="text-white font-medium truncate max-w-[200px]">{piece.title}</div>
                  {piece.topicId && (
                    <div className="text-[10px] [color:var(--color-fg-subtle)] truncate mt-0.5">{piece.topicId}</div>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1.5 [color:var(--color-fg-muted)]">
                    <TypeIcon type={piece.type} />
                    <span className="text-xs">{piece.type}</span>
                  </div>
                </td>
                <td className="p-3">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border"
                    style={{ background: STATION_COLORS[piece.station].bg, color: STATION_COLORS[piece.station].fg, borderColor: STATION_COLORS[piece.station].border }}
                  >
                    {piece.station}
                  </span>
                </td>
                <td className="p-3">
                  <StatusBadge status={piece.status} />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1.5 [color:var(--color-fg-muted)] text-xs">
                    <User className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[100px]">{piece.assignee || '--'}</span>
                  </div>
                </td>
                <td className="p-3">
                  <span className={`text-xs ${isOverdue(piece.deadline) && piece.status !== 'Published' ? '[color:var(--color-danger)] font-medium' : '[color:var(--color-fg-muted)]'}`}>
                    {formatDate(piece.deadline)}
                  </span>
                </td>
                <td className="p-3">
                  <a
                    href={piece.visualRefUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors truncate max-w-[140px]"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{piece.visualRefUrl}</span>
                  </a>
                </td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEditModal(piece)}
                      className="p-1.5 [color:var(--color-fg-subtle)] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(piece.id)}
                      className="p-1.5 [color:var(--color-fg-subtle)] hover:[color:var(--color-danger)] hover:[background:var(--color-danger-subtle)] rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ─── Render: Bulk Action Bar ────────────────────────────────────

  function renderBulkBar() {
    return (
      <AnimatePresence>
        {showBulkBar && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#111] border border-[#8b5cf6]/30 rounded-2xl px-6 py-3 flex items-center gap-4 shadow-2xl shadow-[#8b5cf6]/10 backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 text-sm text-white">
              <CheckCheck className="w-4 h-4 text-[#a78bfa]" />
              <span className="font-medium">{selectedIds.size}</span>
              <span className="[color:var(--color-fg-muted)]">selected</span>
            </div>

            <div className="w-px h-6 bg-white/10" />

            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value as PieceStatus)}
                className="appearance-none px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={handleBulkStatusUpdate}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#7c3aed] hover:bg-[#8b5cf6] text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Apply
              </button>
            </div>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 [color:var(--color-fg-subtle)] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // ─── Render: Create/Edit Modal ──────────────────────────────────

  function renderModal() {
    return (
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />

            {/* Modal */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#111] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">
                  {editingPiece ? 'Edit Content Piece' : 'New Content Piece'}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 [color:var(--color-fg-subtle)] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form */}
              <div className="p-6 space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Breaking News Reel - Beirut"
                    className={`w-full px-3 py-2.5 bg-black/40 border rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors ${
                      formErrors.title ? '[border-color:var(--color-danger)]' : 'border-white/10'
                    }`}
                  />
                  {formErrors.title && <p className="[color:var(--color-danger)] text-[11px] mt-1">{formErrors.title}</p>}
                </div>

                {/* Type + Station */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Type</label>
                    <select
                      value={form.type}
                      onChange={e => setForm(f => ({ ...f, type: e.target.value as ContentType }))}
                      className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
                    >
                      {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Station</label>
                    <select
                      value={form.station}
                      onChange={e => setForm(f => ({ ...f, station: e.target.value as Station }))}
                      className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
                    >
                      {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Status + Topic */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value as PieceStatus }))}
                      className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] cursor-pointer"
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Topic Link / ID</label>
                    <input
                      type="text"
                      value={form.topicId}
                      onChange={e => setForm(f => ({ ...f, topicId: e.target.value }))}
                      placeholder="e.g. topic-001"
                      className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors"
                    />
                  </div>
                </div>

                {/* Assignee + Deadline */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Assignee *</label>
                    <input
                      type="text"
                      value={form.assignee}
                      onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
                      placeholder="e.g. Sara K."
                      className={`w-full px-3 py-2.5 bg-black/40 border rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors ${
                        formErrors.assignee ? '[border-color:var(--color-danger)]' : 'border-white/10'
                      }`}
                    />
                    {formErrors.assignee && <p className="[color:var(--color-danger)] text-[11px] mt-1">{formErrors.assignee}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Deadline *</label>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                      className={`w-full px-3 py-2.5 bg-black/40 border rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors ${
                        formErrors.deadline ? '[border-color:var(--color-danger)]' : 'border-white/10'
                      }`}
                    />
                    {formErrors.deadline && <p className="[color:var(--color-danger)] text-[11px] mt-1">{formErrors.deadline}</p>}
                  </div>
                </div>

                {/* Visual Reference URL (MANDATORY) */}
                <div>
                  <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">
                    Visual Reference URL *
                    <span className="ml-1 text-[#a78bfa]">(mandatory)</span>
                  </label>
                  <div className="relative">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)]" />
                    <input
                      type="url"
                      value={form.visualRefUrl}
                      onChange={e => setForm(f => ({ ...f, visualRefUrl: e.target.value }))}
                      placeholder="https://..."
                      className={`w-full pl-10 pr-3 py-2.5 bg-black/40 border rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors ${
                        formErrors.visualRefUrl ? '[border-color:var(--color-danger)]' : 'border-white/10'
                      }`}
                    />
                  </div>
                  {formErrors.visualRefUrl && <p className="[color:var(--color-danger)] text-[11px] mt-1">{formErrors.visualRefUrl}</p>}
                </div>

                {/* Visual Reference Image URL */}
                <div>
                  <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">
                    Visual Reference Image URL
                    <span className="ml-1 [color:var(--color-fg-subtle)]">(thumbnail preview)</span>
                  </label>
                  <input
                    type="url"
                    value={form.visualRefImage}
                    onChange={e => setForm(f => ({ ...f, visualRefImage: e.target.value }))}
                    placeholder="https://... (direct image link for preview)"
                    className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors"
                  />
                  {form.visualRefImage && (
                    <div className="mt-2 w-20 h-20 rounded-lg overflow-hidden border border-white/10 bg-black/40">
                      <img
                        src={form.visualRefImage}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium [color:var(--color-fg-muted)] mb-1.5">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Production notes, instructions..."
                    rows={3}
                    className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus:outline-none focus:ring-1 focus:ring-[#8b5cf6] transition-colors resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm [color:var(--color-fg-muted)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#7c3aed] hover:bg-[#8b5cf6] text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-[#8b5cf6]/20"
                >
                  {editingPiece ? (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create Piece
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // ─── Main Render ────────────────────────────────────────────────

  // ─── Hero pipeline counts (computed from stats.byStatus) ─────────
  // Renamed from STATUS_COLORS → PIPELINE_COLORS so it no longer shadows the
  // module-level STATUS_COLORS (used by StatusBadge / renderDashboard), which
  // previously caused TS2339 (.text/.dot) errors.
  const PIPELINE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
    Draft:       { bg: 'rgba(113,113,122,0.12)', fg: '#a1a1aa', border: 'rgba(113,113,122,0.30)' },
    'In Design': { bg: 'rgba(139,92,246,0.12)', fg: '#a78bfa', border: 'rgba(139,92,246,0.30)' },
    'In Review': { bg: 'rgba(245,158,11,0.12)', fg: '#fbbf24', border: 'rgba(245,158,11,0.30)' },
    Approved:    { bg: 'rgba(16,185,129,0.12)', fg: '#34d399', border: 'rgba(16,185,129,0.30)' },
    Published:   { bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa', border: 'rgba(59,130,246,0.30)' },
  };
  const blockedCount = stats.byStatus.find(s => s.status === 'In Review')?.count ?? 0;
  const completionPct = stats.total === 0 ? 0 : Math.round((stats.byStatus.find(s => s.status === 'Published')!.count / stats.total) * 100);

  return (
    <div className="max-w-7xl mx-auto pb-20">
      {/* Hero — pipeline-at-a-glance + blocking-items callout */}
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-6 overflow-hidden rounded-2xl border"
        style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(59,130,246,0.04) 60%, transparent 100%), var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 18px 50px -20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full blur-3xl opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.5) 0%, transparent 70%)' }}
        />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-fg-subtle)' }}>
                Create · Production
              </p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold leading-tight" style={{ color: 'var(--color-fg)' }}>
                Content Pieces
              </h1>
              <p className="mt-2 text-sm leading-relaxed max-w-2xl" style={{ color: 'var(--color-fg-muted)' }}>
                {stats.total} pieces · {completionPct}% published · {blockedCount} awaiting review
              </p>
            </div>
            {blockedCount > 0 && (
              <span
                className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold"
                style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)', color: '#fbbf24' }}
              >
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                {blockedCount} blocking review
              </span>
            )}
          </div>

          {/* Pipeline bento — one card per status */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {stats.byStatus.map(({ status, count }) => {
              const c = PIPELINE_COLORS[status] ?? PIPELINE_COLORS.Draft;
              const pct = stats.total === 0 ? 0 : Math.round((count / stats.total) * 100);
              return (
                <div
                  key={status}
                  className="rounded-xl border p-4 transition-transform hover:-translate-y-0.5"
                  style={{ background: c.bg, borderColor: c.border }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: c.fg }}>
                    {status}
                  </p>
                  <p className="mt-2 font-display text-3xl font-bold" style={{ color: c.fg }}>
                    {count}
                  </p>
                  <div className="mt-2 h-1 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="h-full transition-all duration-500" style={{ background: c.fg, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* Status Dashboard */}
      {renderDashboard()}

      {/* Type Stats */}
      {renderTypeStats()}

      {/* Controls */}
      {renderControls()}

      {/* Content */}
      {viewMode === 'card' ? renderCardView() : renderTableView()}

      {/* Bulk Action Bar */}
      {renderBulkBar()}

      {/* Create/Edit Modal */}
      {renderModal()}
    </div>
  );
}
