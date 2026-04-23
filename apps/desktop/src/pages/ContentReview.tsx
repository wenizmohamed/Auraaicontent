import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Search, LayoutGrid, List, CheckCircle2, XCircle, Edit3,
  RefreshCw, ChevronDown, Printer, Hash, Calendar, Eye, Users,
  Filter, CheckSquare, Square, Image as ImageIcon, Sparkles, X,
  Download, Loader2,
} from 'lucide-react';
import { useStore, ContentBrief } from '../lib/store';
import { validateCaption, PLATFORM_LIMITS } from '../lib/platform-limits';
import { useClients } from '../lib/client-context';
import { calendarApi, reviewApi, visualRefsApi, exportsApi, jobsApi } from '../lib/backend-api';
import { ContentStatus, STATUS_LABEL, STATUS_COLOR, normalizeStatus } from '../lib/status-enum';
import VisualRefGrid from '../components/VisualRefGrid';

// ─── Types ──────────────────────────────────────────────────────

interface GeneratedPiece {
  id: string;
  briefId: string;
  platform: string;
  format: string;
  creativeCopy: string;
  keyMessage: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualReference: string;
  visualRefImages: { imageUrl: string; sourceUrl: string; description: string }[];
  targetAudience: string;
  campaignTheme: string;
  suggestedDate: string;
  charCount: number;
  charLimit: number;
  charStatus: 'good' | 'warning' | 'over';
  status: ContentStatus;
}

// ─── Constants ──────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  tiktok: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  linkedin: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  x: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  facebook: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  threads: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  snapchat: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
};

const PLATFORM_DOT_COLORS: Record<string, string> = {
  instagram: 'bg-pink-400',
  tiktok: 'bg-slate-400',
  linkedin: 'bg-blue-400',
  x: 'bg-sky-400',
  facebook: 'bg-indigo-400',
  threads: 'bg-slate-400',
  snapchat: 'bg-yellow-400',
};

// Status colors/labels now come from ../lib/status-enum (canonical vocabulary
// shared with ContentCalendar). Local STATUS_COLORS/STATUS_DOT maps were
// removed as part of the H2 vocabulary unification.

// ─── Component ──────────────────────────────────────────────────

export default function ContentReview() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const briefId = searchParams.get('briefId') || '';
  const urlMonth = searchParams.get('month') || '';
  const urlClient = searchParams.get('client') || '';

  const { contentBriefs, updateContentBrief } = useStore();
  const { selectedClientId, currentClient } = useClients();

  // Try backend first, then local brief.
  // Fallback chain for the URL params (so the sidebar Review link "just works"):
  //   1. ?client=&month= (explicit URL)
  //   2. selectedClientId from context + most recent month for that client
  const [backendMonth, setBackendMonth] = useState<any>(null);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);

  useEffect(() => {
    const cId = urlClient || selectedClientId;
    if (cId && urlMonth) {
      calendarApi.getMonth(cId, decodeURIComponent(urlMonth))
        .then(setBackendMonth)
        .catch(() => setBackendMonth(null));
      return;
    }
    // No explicit month — fetch the list of all months for this client and pick the most recent.
    // Works for arbitrary month names (timestamp-named, freeform, calendar-style).
    if (cId && !urlMonth && !autoLoadAttempted) {
      setAutoLoadAttempted(true);
      (async () => {
        try {
          const months = await calendarApi.listMonths(cId);
          if (months.length > 0) {
            const latest = months[0].month;
            const data = await calendarApi.getMonth(cId, latest);
            setBackendMonth(data);
          }
        } catch { /* ignore */ }
      })();
    }
  }, [urlClient, urlMonth, selectedClientId, autoLoadAttempted]);

  // Map a backend CalendarPost asset link to a visualRefImages entry
  const mapAssetsToVisualRefs = (post: any) => {
    const links = post?.assets || [];
    return links.map((link: any) => {
      const a = link.asset || link;
      return {
        imageUrl: a.thumbUrl || a.fileUrl || '',
        sourceUrl: a.fileUrl || '',
        description: a.name || post.referenceQuery || '',
      };
    }).filter((r: any) => r.imageUrl);
  };

  // Find brief — prefer backend, fall back to local
  const brief: ContentBrief | undefined = backendMonth
    ? {
        id: backendMonth.id,
        clientId: urlClient || selectedClientId || '',
        month: backendMonth.month,
        campaigns: [],
        occasions: [],
        platforms: [],
        pieceCount: backendMonth.posts?.length || 0,
        toneNotes: '',
        status: backendMonth.status,
        pieces: (backendMonth.posts || []).map((p: any) => ({
          ...p,
          // Keep `visualRefs` and `assets` straight from the backend for VisualRefGrid.
          // visualRefImages is the legacy local-store shape — derive it from assets so
          // any code path that still reads it gets a non-empty array.
          suggestedDate: p.date,
          creativeCopy: p.visualDirection || '',
          visualReference: p.referenceQuery || '',
          visualRefImages: mapAssetsToVisualRefs(p),
          hashtags: p.hashtags || [],
          charCount: (p.caption || '').length,
          charLimit: 2200,
          charStatus: 'good' as const,
          status: normalizeStatus(p.status),
        })),
        createdAt: backendMonth.createdAt,
      }
    : contentBriefs.find(b => b.id === briefId);
  const client = currentClient;

  // Local state
  const [pieces, setPieces] = useState<GeneratedPiece[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editCreativeCopy, setEditCreativeCopy] = useState('');
  const [loadingRefs, setLoadingRefs] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Sync pieces from brief.
  // Include backendMonth.posts so re-fetching the same month (same id)
  // still refreshes visualRefs/assets in the Review grid.
  // Normalize status at the boundary so legacy tokens from the local zustand
  // store ('generated', 'edited') are mapped to canonical ContentStatus.
  useEffect(() => {
    if (brief?.pieces) {
      const normalized = (brief.pieces as any[]).map(p => ({
        ...p,
        status: normalizeStatus(p.status),
      })) as GeneratedPiece[];
      setPieces(normalized);
    }
  }, [brief?.id, backendMonth?.posts]);

  // Visual reference auto-fetch removed — Unsplash Source API is dead
  // References come from backend asset system (Commit 12)

  // Persist piece changes to store
  const updatePieces = useCallback((updater: (prev: GeneratedPiece[]) => GeneratedPiece[]) => {
    setPieces(prev => {
      const next = updater(prev);
      if (brief) {
        updateContentBrief(brief.id, { pieces: next });
      }
      return next;
    });
  }, [brief, updateContentBrief]);

  // ─── Derived data ───────────────────────────────────────────

  const platforms = useMemo(() => {
    const set = new Set(pieces.map(p => p.platform.toLowerCase()));
    return Array.from(set).sort();
  }, [pieces]);

  const campaigns = useMemo(() => {
    const set = new Set(pieces.map(p => p.campaignTheme).filter(Boolean));
    return Array.from(set).sort();
  }, [pieces]);

  const filteredPieces = useMemo(() => {
    return pieces.filter(p => {
      if (platformFilter !== 'all' && p.platform.toLowerCase() !== platformFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (campaignFilter !== 'all' && p.campaignTheme !== campaignFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.caption.toLowerCase().includes(q) ||
          p.creativeCopy.toLowerCase().includes(q) ||
          p.hashtags.some(h => h.toLowerCase().includes(q)) ||
          p.platform.toLowerCase().includes(q) ||
          p.campaignTheme.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [pieces, platformFilter, statusFilter, campaignFilter, searchQuery]);

  const stats = useMemo(() => ({
    total: pieces.length,
    draft: pieces.filter(p => p.status === 'draft').length,
    in_review: pieces.filter(p => p.status === 'in_review').length,
    approved: pieces.filter(p => p.status === 'approved').length,
    changes_requested: pieces.filter(p => p.status === 'changes_requested').length,
    published: pieces.filter(p => p.status === 'published').length,
    rejected: pieces.filter(p => p.status === 'rejected').length,
  }), [pieces]);

  // ─── Actions ────────────────────────────────────────────────

  const handleStatusChange = async (id: string, status: GeneratedPiece['status']) => {
    updatePieces(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    // Persist to backend
    try { await calendarApi.updatePost(id, { status }); } catch {}
  };

  const handleStartEdit = (piece: GeneratedPiece) => {
    setEditingId(piece.id);
    setEditCaption(piece.caption);
    setEditCreativeCopy(piece.creativeCopy);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const validation = validateCaption(editCaption, pieces.find(p => p.id === editingId)?.platform || 'Instagram');
    updatePieces(prev => prev.map(p =>
      p.id === editingId
        ? {
            ...p,
            caption: editCaption,
            creativeCopy: editCreativeCopy,
            charCount: validation.length,
            charLimit: validation.max,
            charStatus: validation.status,
            status: 'changes_requested' as const,
          }
        : p
    ));
    // Persist to backend
    try {
      await calendarApi.updatePost(editingId, {
        caption: editCaption,
        visualDirection: editCreativeCopy,
        status: 'changes_requested',
      });
    } catch (err: any) {
      console.error('Failed to save edit to backend:', err);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditCaption('');
    setEditCreativeCopy('');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPieces.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPieces.map(p => p.id)));
    }
  };

  const bulkAction = async (status: GeneratedPiece['status']) => {
    const ids = [...selectedIds];
    updatePieces(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, status } : p));
    setSelectedIds(new Set());
    // Persist each to backend
    await Promise.allSettled(ids.map(id => calendarApi.updatePost(id, { status })));
  };

  const handleExport = () => {
    window.print();
  };

  const handleRegenerate = (id: string) => {
    handleStatusChange(id, 'draft');
  };

  const handleExportPptx = async () => {
    const cId = urlClient || selectedClientId || '';
    const month = brief?.month;
    if (!cId || !month) return;
    setExporting(true);
    setExportDone(null);
    try {
      const { jobId } = await exportsApi.trigger(cId, month);
      let attempts = 0;
      while (attempts < 40) {
        await new Promise(r => setTimeout(r, 2000));
        const job = await jobsApi.get(jobId);
        if (job.status === 'completed') {
          const downloadUrl = exportsApi.downloadUrl(job.result?.fileUrl);
          setExportDone(downloadUrl);
          setExporting(false);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        if (job.status === 'failed') {
          console.error('Export failed:', job.error);
          break;
        }
        attempts++;
      }
    } catch (err) {
      console.error('Export PPTX failed:', err);
    }
    setExporting(false);
  };

  // ─── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when editing or when an input/textarea is focused
      if (editingId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'j': {
          e.preventDefault();
          setFocusedIndex(prev => {
            const next = Math.min(prev + 1, filteredPieces.length - 1);
            cardRefs.current.get(next)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return next;
          });
          break;
        }
        case 'k': {
          e.preventDefault();
          setFocusedIndex(prev => {
            const next = Math.max(prev - 1, 0);
            cardRefs.current.get(next)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return next;
          });
          break;
        }
        case 'a': {
          e.preventDefault();
          const piece = filteredPieces[focusedIndex];
          if (piece) handleStatusChange(piece.id, 'approved');
          break;
        }
        case 'r': {
          e.preventDefault();
          const piece = filteredPieces[focusedIndex];
          if (piece) handleStatusChange(piece.id, 'rejected');
          break;
        }
        case 'e': {
          e.preventDefault();
          const piece = filteredPieces[focusedIndex];
          if (piece) handleStartEdit(piece);
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingId, filteredPieces, focusedIndex]);

  // ─── Character Counter ──────────────────────────────────────

  const CharCounter = ({ count, limit, status }: { count: number; limit: number; status: string }) => {
    const color = status === 'good' ? 'text-emerald-400' : status === 'warning' ? 'text-amber-400' : 'text-red-400';
    const icon = status === 'good' ? '\u2713' : status === 'warning' ? '!' : '\u2717';
    return (
      <span className={`text-xs font-mono ${color}`}>
        {count}/{limit} {icon}
      </span>
    );
  };

  // ─── No brief found ────────────────────────────────────────

  if (!brief) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-5 shadow-[0_0_40px_-10px_rgba(245,158,11,0.35)]">
          <Sparkles className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">No Content to Review</h2>
        <p className="text-zinc-400 mb-8 max-w-md mx-auto leading-relaxed">
          {currentClient
            ? `No generated content found for ${currentClient.name}. Create a brief to generate content.`
            : 'Pick a client and create a content brief to generate content for review.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/brief')}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-xl transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Create New Brief
          </button>
          <button
            onClick={() => navigate('/calendar')}
            className="px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] text-white font-medium rounded-xl border border-white/10 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Open Calendar
          </button>
        </div>
      </div>
    );
  }

  if (!pieces.length) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-5 shadow-[0_0_40px_-10px_rgba(245,158,11,0.35)]">
          <Sparkles className="w-7 h-7 text-amber-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">No Content Generated Yet</h2>
        <p className="text-zinc-400 mb-8 max-w-md mx-auto leading-relaxed">This brief has no generated pieces to review.</p>
        <button
          onClick={() => navigate('/brief')}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-xl transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          Create New Brief
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="max-w-[1440px] mx-auto pb-32 print:pb-4">

      {/* ── Header ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <button
          onClick={() => {
            const cId = urlClient || selectedClientId || '';
            const m = brief?.month ? encodeURIComponent(brief.month) : '';
            navigate(cId && m ? `/calendar?client=${cId}&month=${m}` : '/calendar');
          }}
          className="flex items-center gap-2 text-zinc-400 hover:text-white mb-4 transition-colors duration-200 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 print:hidden"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Calendar
        </button>

        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-white tracking-tight mb-1">
              Review Content
            </h1>
            <p className="text-zinc-400">
              <span className="text-amber-400 font-medium">{client?.name || brief.clientId}</span>
              {' \u00B7 '}
              <span className="text-zinc-300">{brief.month}</span>
              {' \u00B7 '}
              <span className="text-zinc-500">{pieces.length} pieces</span>
            </p>
          </div>

          {/* Stats bar */}
          <div className="flex gap-3 flex-wrap">
            {[
              { label: STATUS_LABEL.draft, value: stats.draft, color: 'text-zinc-400' },
              { label: STATUS_LABEL.in_review, value: stats.in_review, color: 'text-amber-400' },
              { label: STATUS_LABEL.approved, value: stats.approved, color: 'text-emerald-400' },
              { label: STATUS_LABEL.changes_requested, value: stats.changes_requested, color: 'text-blue-400' },
              { label: STATUS_LABEL.published, value: stats.published, color: 'text-white' },
              { label: STATUS_LABEL.rejected, value: stats.rejected, color: 'text-red-400' },
            ].map(s => (
              <div
                key={s.label}
                className="bg-[#111] border border-white/10 rounded-xl px-4 py-2 text-center min-w-[92px]"
              >
                <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-[#111] border border-white/10 rounded-2xl p-4 mb-6 print:hidden"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search captions, copy, hashtags..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-colors ${
              showFilters ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {/* View toggle */}
          <div className="flex bg-zinc-900 border border-white/10 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                viewMode === 'list' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
              List
            </button>
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <Printer className="w-4 h-4" />
            Export PDF
          </button>
          <button
            onClick={handleExportPptx}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Exporting...' : 'Export PPTX'}
          </button>
        </div>

        {/* Expanded filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-3 pt-4 mt-4 border-t border-white/5">
                {/* Platform filter */}
                <select
                  value={platformFilter}
                  onChange={e => setPlatformFilter(e.target.value)}
                  className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                >
                  <option value="all">All Platforms</option>
                  {platforms.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>

                {/* Status filter */}
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                >
                  <option value="all">All Statuses</option>
                  {(Object.keys(STATUS_LABEL) as ContentStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>

                {/* Campaign filter */}
                {campaigns.length > 0 && (
                  <select
                    value={campaignFilter}
                    onChange={e => setCampaignFilter(e.target.value)}
                    className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="all">All Campaigns</option>
                    {campaigns.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {/* Clear filters */}
                {(platformFilter !== 'all' || statusFilter !== 'all' || campaignFilter !== 'all' || searchQuery) && (
                  <button
                    onClick={() => {
                      setPlatformFilter('all');
                      setStatusFilter('all');
                      setCampaignFilter('all');
                      setSearchQuery('');
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Clear All
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Approval Progress ────────────────────────────── */}
      {pieces.length > 0 && (
        <div className="mb-4 px-1 print:hidden">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-zinc-300">
              {stats.approved === stats.total ? (
                <span className="text-emerald-400">All approved — ready to export &#10003;</span>
              ) : (
                <>
                  <span className="text-emerald-400 tabular-nums">{stats.approved}</span>
                  <span className="text-zinc-500">/{stats.total}</span>
                  {' approved — '}
                  <span className="text-zinc-400 tabular-nums">
                    {stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0}% complete
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-emerald-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${stats.total > 0 ? (stats.approved / stats.total) * 100 : 0}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* ── Results count ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 px-1 print:hidden">
        <p className="text-sm text-zinc-500">
          Showing {filteredPieces.length} of {pieces.length} pieces
        </p>
      </div>

      {/* ── Grid View ──────────────────────────────────────── */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <AnimatePresence mode="popLayout">
            {filteredPieces.map((piece, idx) => (
              <motion.div
                key={piece.id}
                ref={(el: HTMLDivElement | null) => { if (el) cardRefs.current.set(idx, el); else cardRefs.current.delete(idx); }}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.03, duration: 0.25 }}
                className={`bg-[#111] border rounded-2xl overflow-hidden transition-colors ${
                  selectedIds.has(piece.id) ? 'border-amber-500/50 ring-1 ring-amber-500/20'
                  : focusedIndex === idx ? 'border-amber-500/30 ring-1 ring-amber-500/10'
                  : 'border-white/10'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between p-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    {/* Select checkbox */}
                    <button
                      onClick={() => toggleSelect(piece.id)}
                      aria-label={selectedIds.has(piece.id) ? 'Deselect post' : 'Select post'}
                      className="text-zinc-500 hover:text-white transition-colors duration-200 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 print:hidden"
                    >
                      {selectedIds.has(piece.id)
                        ? <CheckSquare className="w-4 h-4 text-amber-400" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>

                    {/* Platform badge */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      PLATFORM_COLORS[piece.platform.toLowerCase()] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${PLATFORM_DOT_COLORS[piece.platform.toLowerCase()] || 'bg-zinc-400'}`} />
                      {piece.platform}
                    </span>

                    {/* Format badge */}
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider bg-white/5 text-zinc-400 border border-white/5">
                      {piece.format}
                    </span>
                  </div>

                  {/* Status badge */}
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                    STATUS_COLOR[piece.status].badge
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[piece.status].dot}`} />
                    {STATUS_LABEL[piece.status]}
                  </span>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-4">

                  {/* Campaign + Date */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {piece.campaignTheme && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400/80">
                        <Sparkles className="w-3 h-3" />
                        {piece.campaignTheme}
                      </span>
                    )}
                    {piece.suggestedDate && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                        <Calendar className="w-3 h-3" />
                        {piece.suggestedDate}
                      </span>
                    )}
                    {piece.targetAudience && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                        <Users className="w-3 h-3" />
                        {piece.targetAudience}
                      </span>
                    )}
                  </div>

                  {/* Creative Copy */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Eye className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Art Direction</span>
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/5">
                      {piece.creativeCopy || 'No art direction'}
                    </p>
                  </div>

                  {/* COPY SECTION — Key Message + Caption + CTA + Hashtags */}
                  <div className="space-y-3 bg-white/[0.02] rounded-xl p-3 border border-white/[0.08]">
                    <div className="flex items-center gap-2 mb-1">
                      <Hash className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Copy</span>
                      <div className="ml-auto">
                        {editingId === piece.id ? (
                          <CharCounter
                            count={editCaption.length}
                            limit={piece.charLimit}
                            status={editCaption.length > piece.charLimit ? 'over' : editCaption.length > piece.charLimit * 0.8 ? 'warning' : 'good'}
                          />
                        ) : (
                          <CharCounter count={piece.charCount} limit={piece.charLimit} status={piece.charStatus} />
                        )}
                      </div>
                    </div>

                    {/* Key Message (goes ON the visual) */}
                    {(piece.keyMessage || editingId === piece.id) && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-amber-400/60 font-semibold">Key Message (on visual)</span>
                        <p className="text-sm text-amber-200/90 font-medium mt-0.5 bg-amber-500/[0.06] rounded-lg px-3 py-2 border border-amber-500/10">
                          {piece.keyMessage || '—'}
                        </p>
                      </div>
                    )}

                    {/* Caption */}
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-zinc-600 font-semibold">Caption</span>
                      {editingId === piece.id ? (
                        <textarea
                          value={editCaption}
                          onChange={e => setEditCaption(e.target.value)}
                          rows={4}
                          className="w-full bg-zinc-900 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none resize-y mt-0.5"
                        />
                      ) : (
                        <p className="text-sm text-zinc-300 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/5 whitespace-pre-wrap mt-0.5">
                          {piece.caption || 'No caption'}
                        </p>
                      )}
                    </div>

                    {/* CTA */}
                    {(piece.cta || editingId === piece.id) && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-emerald-400/60 font-semibold">Call to Action</span>
                        <p className="text-sm text-emerald-300/90 font-medium mt-0.5 bg-emerald-500/[0.06] rounded-lg px-3 py-2 border border-emerald-500/10">
                          {piece.cta || '—'}
                        </p>
                      </div>
                    )}

                    {/* Hashtags */}
                    {piece.hashtags?.length > 0 && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-zinc-600 font-semibold">Hashtags</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {piece.hashtags.map((tag, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md text-xs bg-white/5 text-zinc-400 border border-white/5">
                              #{tag.replace(/^#/, '')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Visual References — shared component, external refs preferred */}
                  <VisualRefGrid
                    post={piece as any}
                    onSearchClick={async (q) => {
                      try {
                        await visualRefsApi.autoPopulate(piece.id, 6);
                        // Re-fetch the month so the new refs appear
                        if (backendMonth?.month && (urlClient || selectedClientId)) {
                          const cId = urlClient || selectedClientId!;
                          const refreshed = await calendarApi.getMonth(cId, backendMonth.month);
                          setBackendMonth(refreshed);
                        }
                      } catch (err: any) {
                        console.warn('Auto-populate failed:', err);
                      }
                    }}
                  />
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 p-4 pt-3 border-t border-white/5 print:hidden">
                  {editingId === piece.id ? (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/30 border border-zinc-500/20 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStatusChange(piece.id, 'approved')}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"
                        title="Approve"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleStartEdit(piece)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleRegenerate(piece.id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
                        title="Regenerate"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleStatusChange(piece.id, 'rejected')}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                        title="Reject"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── List View ──────────────────────────────────────── */}
      {viewMode === 'list' && (
        <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium w-10 print:hidden">
                    <button onClick={toggleSelectAll} className="text-zinc-500 hover:text-white transition-colors">
                      {selectedIds.size === filteredPieces.length && filteredPieces.length > 0
                        ? <CheckSquare className="w-4 h-4 text-amber-400" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Platform</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Campaign</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium min-w-[250px]">Caption</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Chars</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-500 font-medium print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredPieces.map((piece) => (
                    <motion.tr
                      key={piece.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${
                        selectedIds.has(piece.id) ? 'bg-amber-500/[0.03]' : ''
                      }`}
                    >
                      <td className="px-4 py-3 print:hidden">
                        <button onClick={() => toggleSelect(piece.id)} className="text-zinc-500 hover:text-white transition-colors">
                          {selectedIds.has(piece.id)
                            ? <CheckSquare className="w-4 h-4 text-amber-400" />
                            : <Square className="w-4 h-4" />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${
                            PLATFORM_COLORS[piece.platform.toLowerCase()] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${PLATFORM_DOT_COLORS[piece.platform.toLowerCase()] || 'bg-zinc-400'}`} />
                            {piece.platform}
                          </span>
                          <span className="text-[10px] text-zinc-600">{piece.format}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-zinc-400">{piece.campaignTheme || '\u2014'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-zinc-300 line-clamp-2 max-w-[350px]">
                          {piece.caption || 'No caption'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <CharCounter count={piece.charCount} limit={piece.charLimit} status={piece.charStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-zinc-500">{piece.suggestedDate || '\u2014'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${
                          STATUS_COLOR[piece.status].badge
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[piece.status].dot}`} />
                          {STATUS_LABEL[piece.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 print:hidden">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleStatusChange(piece.id, 'approved')}
                            className="p-1.5 rounded-md text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStartEdit(piece)}
                            className="p-1.5 rounded-md text-blue-400/60 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRegenerate(piece.id)}
                            className="p-1.5 rounded-md text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                            title="Regenerate"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStatusChange(piece.id, 'rejected')}
                            className="p-1.5 rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Inline Edit Modal (List View) ──────────────────── */}
      <AnimatePresence>
        {editingId && viewMode === 'list' && (() => {
          const piece = pieces.find(p => p.id === editingId);
          if (!piece) return null;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden"
              onClick={handleCancelEdit}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4"
              >
                <h3 className="text-lg font-semibold text-white">
                  Edit Content
                  <span className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${
                    PLATFORM_COLORS[piece.platform.toLowerCase()] || ''
                  }`}>
                    {piece.platform}
                  </span>
                </h3>

                <div>
                  <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Creative Copy</label>
                  <textarea
                    value={editCreativeCopy}
                    onChange={e => setEditCreativeCopy(e.target.value)}
                    rows={3}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 resize-y"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Caption</label>
                    <CharCounter
                      count={editCaption.length}
                      limit={piece.charLimit}
                      status={
                        editCaption.length > piece.charLimit ? 'over'
                        : editCaption.length > piece.charLimit * 0.8 ? 'warning'
                        : 'good'
                      }
                    />
                  </div>
                  <textarea
                    value={editCaption}
                    onChange={e => setEditCaption(e.target.value)}
                    rows={5}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 resize-y"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleSaveEdit}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save Changes
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/30 border border-zinc-500/20 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Keyboard Hint Bar ────────────────────────────── */}
      {!editingId && pieces.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center py-2 pointer-events-none print:hidden">
          <div className="px-4 py-1.5 bg-zinc-900/80 backdrop-blur-sm border border-white/5 rounded-lg">
            <span className="text-[11px] text-zinc-500 font-mono tracking-wide">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-zinc-400 text-[10px]">j</kbd>/<kbd className="px-1.5 py-0.5 bg-white/5 rounded text-zinc-400 text-[10px]">k</kbd> navigate
              <span className="mx-2 text-zinc-700">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-zinc-400 text-[10px]">a</kbd> approve
              <span className="mx-2 text-zinc-700">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-zinc-400 text-[10px]">r</kbd> reject
              <span className="mx-2 text-zinc-700">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-zinc-400 text-[10px]">e</kbd> edit
            </span>
          </div>
        </div>
      )}

      {/* ── Bulk Actions Bar ───────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 print:hidden"
          >
            <div className="flex items-center gap-3 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 shadow-2xl shadow-black/40">
              {/* Select all */}
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {selectedIds.size === filteredPieces.length
                  ? <CheckSquare className="w-4 h-4 text-amber-400" />
                  : <Square className="w-4 h-4" />
                }
                <span className="text-amber-400 font-medium">{selectedIds.size}</span>
                <span>selected</span>
              </button>

              <div className="w-px h-6 bg-white/10" />

              <button
                onClick={() => bulkAction('approved')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve ({selectedIds.size})
              </button>

              <button
                onClick={() => bulkAction('rejected')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>

              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Export Approved
              </button>

              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
