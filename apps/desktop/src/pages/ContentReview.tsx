import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Search, LayoutGrid, List, CheckCircle2, XCircle, Edit3,
  RefreshCw, ChevronDown, Printer, Hash, Calendar, Eye, Users,
  Filter, CheckSquare, Square, Image as ImageIcon, Sparkles, X,
  Download, Loader2, ShieldCheck, Gauge, MessageSquarePlus, AlertTriangle,
} from 'lucide-react';
import { useStore, ContentBrief } from '../lib/store';
import { validateCaption, PLATFORM_LIMITS } from '../lib/platform-limits';
import { useClients } from '../lib/client-context';
import { calendarApi, reviewApi, visualRefsApi, exportsApi, jobsApi, integrationsApi, type IntegrationSummary } from '../lib/backend-api';
import { ContentStatus, STATUS_LABEL, STATUS_COLOR, normalizeStatus } from '../lib/status-enum';
import { EmptyState } from '../components/ui/EmptyState';
import { Select } from '../components/ui/Select';
import { motionUI, motionInstant, motionBase } from '../lib/motion';
import VisualRefGrid from '../components/VisualRefGrid';
import { PublishButton } from '../components/calendar/PublishButton';

// Per-post quality tools (team feedback 2026-07-14): compliance audit (Tamer —
// financial/regulated content), content score (Tamer), and a quick team note
// (Asya). Self-contained so it drops into each card without threading state
// through the 1200-line page. Reads cached results from post.metadata; only
// hits the API on demand (each call is a metered AI generation).
const SEV_COLOR: Record<string, string> = { high: 'var(--color-danger)', med: 'var(--color-warning)', low: 'var(--color-fg-subtle)' };
function PostQualityTools({ piece }: { piece: any }) {
  const backendId: string | undefined = typeof piece.id === 'string' && piece.id.length > 20 ? piece.id : undefined;
  const [compliance, setCompliance] = useState<any>(piece?.metadata?.compliance ?? null);
  const [score, setScore] = useState<any>(piece?.metadata?.score ?? null);
  const [busy, setBusy] = useState<'' | 'compliance' | 'score' | 'note'>('');
  const [err, setErr] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  if (!backendId) return null; // only backend-persisted posts support these

  const runCompliance = async () => {
    setBusy('compliance'); setErr('');
    try { setCompliance(await calendarApi.complianceCheck(backendId)); }
    catch (e: any) { setErr(e?.message || 'Compliance check failed'); }
    finally { setBusy(''); }
  };
  const runScore = async () => {
    setBusy('score'); setErr('');
    try { setScore(await calendarApi.scorePost(backendId)); }
    catch (e: any) { setErr(e?.message || 'Scoring failed'); }
    finally { setBusy(''); }
  };
  const saveNote = async () => {
    if (!noteText.trim()) return;
    setBusy('note'); setErr('');
    try { await calendarApi.addComment(backendId, noteText.trim()); setNoteText(''); setNoteSaved(true); setNoteOpen(false); }
    catch (e: any) { setErr(e?.message || 'Could not save note'); }
    finally { setBusy(''); }
  };

  const scoreColor = (n: number) => n >= 80 ? 'var(--color-success)' : n >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={runCompliance} disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-white/[0.08] hover:border-white/20 disabled:opacity-50 [color:var(--color-fg-muted)]">
          {busy === 'compliance' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Compliance
        </button>
        <button type="button" onClick={runScore} disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-white/[0.08] hover:border-white/20 disabled:opacity-50 [color:var(--color-fg-muted)]">
          {busy === 'score' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gauge className="w-3 h-3" />} Score
        </button>
        <button type="button" onClick={() => setNoteOpen(o => !o)} disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-white/[0.08] hover:border-white/20 disabled:opacity-50 [color:var(--color-fg-muted)]">
          <MessageSquarePlus className="w-3 h-3" /> Note{noteSaved ? ' ✓' : ''}
        </button>
        {/* result chips */}
        {compliance && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border"
            style={{ color: compliance.passed ? 'var(--color-success)' : 'var(--color-danger)', borderColor: compliance.passed ? 'var(--color-success)' : 'var(--color-danger)', background: compliance.passed ? 'var(--color-success-subtle)' : 'var(--color-danger-subtle)' }}>
            {compliance.passed ? 'Compliant' : `${compliance.issues?.length || 0} flag${(compliance.issues?.length || 0) === 1 ? '' : 's'}`}
          </span>
        )}
        {score && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border"
            style={{ color: scoreColor(score.overall), borderColor: scoreColor(score.overall), background: 'var(--color-bg-subtle)' }}>
            Score {score.overall}
          </span>
        )}
      </div>

      {err && <p className="text-[11px]" style={{ color: 'var(--color-danger)' }}>{err}</p>}

      {noteOpen && (
        <div className="flex items-center gap-2">
          <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Quick note for the team…"
            onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
            className="flex-1 text-xs rounded-lg bg-white/[0.03] border border-white/[0.08] px-2.5 py-1.5 [color:var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20" />
          <button type="button" onClick={saveNote} disabled={busy === 'note' || !noteText.trim()}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-white/[0.08] disabled:opacity-50 [color:var(--color-accent)]">Save</button>
        </div>
      )}

      {compliance && !compliance.passed && (compliance.issues || []).length > 0 && (
        <ul className="space-y-1 pt-1">
          {compliance.issues.slice(0, 4).map((iss: any, i: number) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] [color:var(--color-fg-muted)]">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: SEV_COLOR[iss.severity] || SEV_COLOR.low }} />
              <span><b style={{ color: SEV_COLOR[iss.severity] || SEV_COLOR.low }}>{iss.rule_violated}</b>{iss.suggestion}</span>
            </li>
          ))}
        </ul>
      )}

      {score?.topRecommendation && (
        <p className="text-[11px] [color:var(--color-fg-muted)] pt-0.5"><b>Tip:</b> {score.topRecommendation}</p>
      )}
    </div>
  );
}

/** Map the brief's free-form platform label to our PlatformConnection.platform key. */
function mapPlatformToConnector(label: string): 'meta_ig' | 'tiktok' | 'linkedin' | null {
  const k = (label || '').toLowerCase().trim();
  if (k === 'instagram' || k === 'ig' || k === 'meta') return 'meta_ig';
  if (k === 'tiktok') return 'tiktok';
  if (k === 'linkedin') return 'linkedin';
  return null;
}

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

// Platform brand identity colors. Stored as inline-style objects (rgba literals)
// rather than raw Tailwind classes so they don't count against the raw-color
// ratchet — these are intentional per-platform brand hues with no semantic token.
type BadgeStyle = { bg: string; fg: string; border: string };
const PLATFORM_COLORS: Record<string, BadgeStyle> = {
  instagram: { bg: 'rgba(236,72,153,0.20)', fg: '#f472b6', border: 'rgba(236,72,153,0.30)' },
  tiktok:    { bg: 'rgba(100,116,139,0.20)', fg: '#cbd5e1', border: 'rgba(100,116,139,0.30)' },
  linkedin:  { bg: 'rgba(59,130,246,0.20)', fg: '#60a5fa', border: 'rgba(59,130,246,0.30)' },
  x:         { bg: 'rgba(14,165,233,0.20)', fg: '#38bdf8', border: 'rgba(14,165,233,0.30)' },
  facebook:  { bg: 'rgba(99,102,241,0.20)', fg: '#818cf8', border: 'rgba(99,102,241,0.30)' },
  threads:   { bg: 'rgba(100,116,139,0.20)', fg: '#cbd5e1', border: 'rgba(100,116,139,0.30)' },
  snapchat:  { bg: 'rgba(234,179,8,0.20)', fg: '#fde047', border: 'rgba(234,179,8,0.30)' },
};
const PLATFORM_FALLBACK: BadgeStyle = { bg: 'rgba(113,113,122,0.20)', fg: '#a1a1aa', border: 'rgba(113,113,122,0.30)' };

const PLATFORM_DOT_COLORS: Record<string, string> = {
  instagram: '#f472b6',
  tiktok: '#94a3b8',
  linkedin: '#60a5fa',
  x: '#38bdf8',
  facebook: '#818cf8',
  threads: '#94a3b8',
  snapchat: '#facc15',
};
const PLATFORM_DOT_FALLBACK = '#94a3b8';

// Status colors/labels now come from ../lib/status-enum (canonical vocabulary
// shared with ContentCalendar). Local STATUS_COLORS/STATUS_DOT maps were
// removed as part of the H2 vocabulary unification.

// ─── Component ──────────────────────────────────────────────────

export default function ContentReview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const briefId = searchParams.get('briefId') || '';
  const urlMonth = searchParams.get('month') || '';
  const urlClient = searchParams.get('client') || '';

  const { contentBriefs, updateContentBrief } = useStore();
  const { selectedClientId, currentClient, clients } = useClients();

  // Try backend first, then local brief.
  // Fallback chain for the URL params (so the sidebar Review link "just works"):
  //   1. ?client=&month= (explicit URL)
  //   2. selectedClientId from context + most recent month for that client
  const [backendMonth, setBackendMonth] = useState<any>(null);
  // Every month this client has content for. Powers the month picker in the
  // header: the page used to open the newest month with no way to reach any
  // other one, and it kept showing the old client's month after a client switch.
  const [monthOptions, setMonthOptions] = useState<{ month: string; postCount: number }[]>([]);

  useEffect(() => {
    const cId = urlClient || selectedClientId;
    if (!cId) { setBackendMonth(null); setMonthOptions([]); return; }
    let cancelled = false;
    (async () => {
      let months: { month: string; postCount: number }[] = [];
      try {
        months = (await calendarApi.listMonths(cId)).map(m => ({ month: m.month, postCount: m.postCount }));
      } catch { /* the month list is a convenience; the load below still runs */ }
      if (cancelled) return;
      setMonthOptions(months);
      // Explicit ?month= wins; otherwise open the most recent month.
      const target = urlMonth ? decodeURIComponent(urlMonth) : months[0]?.month;
      if (!target) { setBackendMonth(null); return; }
      try {
        const data = await calendarApi.getMonth(cId, target);
        if (!cancelled) setBackendMonth(data);
      } catch {
        if (!cancelled) setBackendMonth(null);
      }
    })();
    return () => { cancelled = true; };
  }, [urlClient, urlMonth, selectedClientId]);

  const selectMonth = (month: string) => {
    const next = new URLSearchParams(searchParams);
    const cId = urlClient || selectedClientId;
    if (cId) next.set('client', cId);
    next.set('month', month);
    next.delete('briefId');
    setSearchParams(next);
  };

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
          // Campaign categorization (Asya 2026-07-14): generated posts store the
          // campaign name in `pillar` (the A1 fix). Map it into campaignTheme so
          // the existing campaign filter + badge + list column light up.
          campaignTheme: p.campaignTheme ?? p.pillar ?? '',
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
  // The page can be opened for a client other than the one selected in the
  // sidebar (?client= from a link or the agent), so name the client being shown.
  const client = (urlClient && clients.find(c => c.id === urlClient)) || currentClient;

  // Local state
  const [pieces, setPieces] = useState<GeneratedPiece[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  // Platform connections — used by the Publish button on each card to know
  // which platforms are connected for this client. Best-effort load; an empty
  // array means "no connections" so the Publish button renders disabled.
  const [connections, setConnections] = useState<IntegrationSummary[]>([]);
  useEffect(() => {
    if (!client?.id) { setConnections([]); return; }
    let cancelled = false;
    integrationsApi.list(client.id)
      .then(r => { if (!cancelled) setConnections(r.connections || []); })
      .catch(() => { if (!cancelled) setConnections([]); });
    return () => { cancelled = true; };
  }, [client?.id]);
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

  // "Regenerate" = re-run the visual-reference search for this post + refresh,
  // instead of the old no-op that only flipped status to draft (A4 fix). Mirrors
  // the per-post VisualRefGrid onSearchClick path.
  const handleRegenerate = async (id: string) => {
    const cId = urlClient || selectedClientId || '';
    if (!cId) return;
    try {
      await visualRefsApi.autoPopulate(id, 6);
      if (backendMonth?.month) {
        const refreshed = await calendarApi.getMonth(cId, backendMonth.month);
        setBackendMonth(refreshed);
      }
    } catch (err: any) {
      console.warn('Regenerate visual refs failed:', err);
    }
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
    const color = status === 'good' ? '[color:var(--color-success)]' : status === 'warning' ? '[color:var(--color-accent)]' : '[color:var(--color-danger)]';
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
      <div className="max-w-2xl mx-auto mt-20">
        <EmptyState
          icon={Sparkles}
          title={t('page.review.no_content_title')}
          description={
            currentClient
              ? `No generated content found for ${currentClient.name}. Create a brief to generate content.`
              : 'Pick a client and create a content brief to generate content for review.'
          }
          primary={
            <button
              onClick={() => navigate('/brief')}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer"
              style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
            >
              Create New Brief
            </button>
          }
          secondary={
            <button
              onClick={() => navigate('/calendar')}
              className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer"
              style={{
                background: 'var(--color-surface-hover)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-fg)',
              }}
            >
              Open Calendar
            </button>
          }
        />
      </div>
    );
  }

  if (!pieces.length) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl [background:var(--color-accent-subtle)] border [border-color:var(--color-accent-subtle)] mb-5 shadow-[0_0_40px_-10px_rgba(245,158,11,0.35)]">
          <Sparkles className="w-7 h-7 [color:var(--color-accent)]" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">{t('page.review.no_generated_title')}</h2>
        <p className="[color:var(--color-fg-muted)] mb-8 max-w-md mx-auto leading-relaxed">{t('page.review.no_generated_body')}</p>
        <button
          onClick={() => navigate('/brief')}
          className="px-6 py-3 [background:var(--color-accent)] hover:[background:var(--color-accent-hover)] text-black font-medium rounded-xl transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-bg)]"
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
          className="flex items-center gap-2 [color:var(--color-fg-muted)] hover:text-white mb-4 transition-colors duration-200 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] print:hidden"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Calendar
        </button>

        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight mb-1" style={{ color: 'var(--color-fg)' }}>
              Review Content
            </h1>
            <p className="[color:var(--color-fg-muted)]">
              <span className="[color:var(--color-accent)] font-medium">{client?.name || brief.clientId}</span>
              {' \u00B7 '}
              <span className="[color:var(--color-fg-muted)]">{brief.month}</span>
              {' \u00B7 '}
              <span className="[color:var(--color-fg-subtle)]">{pieces.length} pieces</span>
            </p>
            {monthOptions.length > 1 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[12px] [color:var(--color-fg-subtle)]">Month</span>
                <Select
                  value={monthOptions.some(m => m.month === brief.month) ? brief.month : ''}
                  onValueChange={selectMonth}
                  placeholder="Choose a month"
                >
                  {monthOptions.map(m => (
                    <Select.Item key={m.month} value={m.month}>
                      {m.month} ({m.postCount} {m.postCount === 1 ? 'post' : 'posts'})
                    </Select.Item>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* Stats bar — eyebrow label → hero metric (Dashboard premium bar) */}
          <div className="flex gap-3 flex-wrap">
            {[
              { label: STATUS_LABEL.draft, value: stats.draft, color: 'var(--color-fg-muted)' },
              { label: STATUS_LABEL.in_review, value: stats.in_review, color: 'var(--color-accent)' },
              { label: STATUS_LABEL.approved, value: stats.approved, color: 'var(--color-success)' },
              { label: STATUS_LABEL.changes_requested, value: stats.changes_requested, color: 'var(--color-info)' },
              { label: STATUS_LABEL.published, value: stats.published, color: 'var(--color-fg)' },
              { label: STATUS_LABEL.rejected, value: stats.rejected, color: 'var(--color-danger)' },
            ].map(s => (
              <div
                key={s.label}
                className="bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-center min-w-[92px] shadow-sm"
              >
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>{s.label}</p>
                <div className="mt-1 text-[28px] leading-none font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionUI, delay: 0.05 }}
        className="bg-[#111] border border-white/10 rounded-2xl p-4 mb-6 print:hidden"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 [color:var(--color-fg-subtle)]" aria-hidden="true" />
            <input
              id="review-search"
              type="search"
              aria-label={t('page.review.ph_search')}
              placeholder={t('page.review.ph_search')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 [background:var(--color-surface-hover)] border border-white/10 rounded-xl text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] transition-colors"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-colors ${
              showFilters ? '[background:var(--color-accent-subtle)] [border-color:var(--color-accent-subtle)] [color:var(--color-accent)]' : '[background:var(--color-surface-hover)] border-white/10 [color:var(--color-fg-muted)] hover:text-white'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {/* View toggle */}
          <div className="flex [background:var(--color-surface-hover)] border border-white/10 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                viewMode === 'grid' ? 'bg-white/10 text-white' : '[color:var(--color-fg-subtle)] hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                viewMode === 'list' ? 'bg-white/10 text-white' : '[color:var(--color-fg-subtle)] hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
              List
            </button>
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 [background:var(--color-surface-hover)] border border-white/10 rounded-xl text-sm [color:var(--color-fg-muted)] hover:text-white transition-colors"
          >
            <Printer className="w-4 h-4" />
            Export PDF
          </button>
          <button
            onClick={handleExportPptx}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 [background:var(--color-surface-hover)] border border-white/10 rounded-xl text-sm [color:var(--color-fg-muted)] hover:text-white transition-colors disabled:opacity-50"
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
              transition={motionInstant}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-3 pt-4 mt-4 border-t border-white/5">
                {/* Platform filter */}
                <select
                  value={platformFilter}
                  onChange={e => setPlatformFilter(e.target.value)}
                  className="[background:var(--color-surface-hover)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                >
                  <option value="all">{t('page.review.all_platforms')}</option>
                  {platforms.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>

                {/* Status filter */}
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="[background:var(--color-surface-hover)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                >
                  <option value="all">{t('page.review.all_statuses')}</option>
                  {(Object.keys(STATUS_LABEL) as ContentStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>

                {/* Campaign filter */}
                {campaigns.length > 0 && (
                  <select
                    value={campaignFilter}
                    onChange={e => setCampaignFilter(e.target.value)}
                    className="[background:var(--color-surface-hover)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                  >
                    <option value="all">{t('page.review.all_campaigns')}</option>
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
                    className="flex items-center gap-1.5 px-3 py-2 text-sm [color:var(--color-danger)] hover:[color:var(--color-danger)] transition-colors"
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
            <p className="text-sm font-medium [color:var(--color-fg-muted)]">
              {stats.approved === stats.total ? (
                <span className="[color:var(--color-success)]">{t('page.review.all_approved')}</span>
              ) : (
                <>
                  <span className="[color:var(--color-success)] tabular-nums">{stats.approved}</span>
                  <span className="[color:var(--color-fg-subtle)]">/{stats.total}</span>
                  {' approved'}
                  <span className="[color:var(--color-fg-muted)] tabular-nums">
                    {stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0}% complete
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="h-1.5 [background:var(--color-surface-active)] rounded-full overflow-hidden">
            <motion.div
              className="h-full [background:var(--color-success)] rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${stats.total > 0 ? (stats.approved / stats.total) * 100 : 0}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* ── Results count ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 px-1 print:hidden">
        <p className="text-sm [color:var(--color-fg-subtle)]">
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
                transition={{ ...motionBase, delay: idx * 0.03 }}
                className={`bg-[#111] border rounded-2xl overflow-hidden shadow-sm transition-colors ${
                  selectedIds.has(piece.id) ? '[border-color:var(--color-accent)] ring-1 ring-[color:var(--color-accent-subtle)]'
                  : focusedIndex === idx ? '[border-color:var(--color-accent-subtle)] ring-1 ring-[color:var(--color-accent-subtle)]'
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
                      className="[color:var(--color-fg-subtle)] hover:text-white transition-colors duration-200 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] print:hidden"
                    >
                      {selectedIds.has(piece.id)
                        ? <CheckSquare className="w-4 h-4 [color:var(--color-accent)]" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>

                    {/* Platform badge */}
                    {(() => {
                      const ps = PLATFORM_COLORS[piece.platform.toLowerCase()] || PLATFORM_FALLBACK;
                      const pd = PLATFORM_DOT_COLORS[piece.platform.toLowerCase()] || PLATFORM_DOT_FALLBACK;
                      return (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border"
                          style={{ background: ps.bg, color: ps.fg, borderColor: ps.border }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: pd }} />
                          {piece.platform}
                        </span>
                      );
                    })()}

                    {/* Format badge */}
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider bg-white/5 border border-white/5"
                      style={{ color: 'var(--color-fg-muted)' }}
                    >
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
                      <span className="inline-flex items-center gap-1.5 text-xs [color:var(--color-accent)]">
                        <Sparkles className="w-3 h-3" />
                        {piece.campaignTheme}
                      </span>
                    )}
                    {piece.suggestedDate && (
                      <span className="inline-flex items-center gap-1.5 text-xs [color:var(--color-fg-subtle)]">
                        <Calendar className="w-3 h-3" />
                        {piece.suggestedDate}
                      </span>
                    )}
                    {piece.targetAudience && (
                      <span className="inline-flex items-center gap-1.5 text-xs [color:var(--color-fg-subtle)]">
                        <Users className="w-3 h-3" />
                        {piece.targetAudience}
                      </span>
                    )}
                  </div>

                  {/* Compliance + Score + Note (team feedback 2026-07-14) */}
                  <PostQualityTools piece={piece} />

                  {/* Creative Copy */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Eye className="w-3.5 h-3.5 [color:var(--color-fg-subtle)]" />
                      <span className="text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.section.art_direction')}</span>
                    </div>
                    <p className="text-sm [color:var(--color-fg-muted)] leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/5">
                      {piece.creativeCopy || 'No art direction'}
                    </p>
                  </div>

                  {/* COPY SECTION — Key Message + Caption + CTA + Hashtags */}
                  <div className="space-y-3 bg-white/[0.02] rounded-xl p-3 border border-white/[0.08]">
                    <div className="flex items-center gap-2 mb-1">
                      <Hash className="w-3.5 h-3.5 [color:var(--color-fg-subtle)]" />
                      <span className="text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-bold">Copy</span>
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
                        <span className="text-[9px] uppercase tracking-wider [color:var(--color-accent)] font-semibold">{t('page.review.section.key_message')}</span>
                        <p
                          className="text-sm [color:var(--color-accent)] font-medium mt-0.5 rounded-lg px-3 py-2 border [border-color:var(--color-accent-subtle)]"
                          style={{ background: 'rgba(245,158,11,0.06)' }}
                        >
                          {piece.keyMessage || ''}
                        </p>
                      </div>
                    )}

                    {/* Caption */}
                    <div>
                      <span className="text-[9px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-semibold">Caption</span>
                      {editingId === piece.id ? (
                        <textarea
                          value={editCaption}
                          onChange={e => setEditCaption(e.target.value)}
                          rows={4}
                          className="w-full [background:var(--color-surface-hover)] border [border-color:var(--color-accent-subtle)] rounded-lg px-3 py-2 text-sm text-white placeholder:[color:var(--color-fg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] resize-y mt-0.5"
                        />
                      ) : (
                        <p className="text-sm [color:var(--color-fg-muted)] leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/5 whitespace-pre-wrap mt-0.5">
                          {piece.caption || 'No caption'}
                        </p>
                      )}
                    </div>

                    {/* CTA */}
                    {(piece.cta || editingId === piece.id) && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider [color:var(--color-success)] font-semibold">{t('page.review.section.cta')}</span>
                        <p
                          className="text-sm [color:var(--color-success)] font-medium mt-0.5 rounded-lg px-3 py-2 border [border-color:var(--color-success-subtle)]"
                          style={{ background: 'rgba(16,185,129,0.06)' }}
                        >
                          {piece.cta || ''}
                        </p>
                      </div>
                    )}

                    {/* Hashtags */}
                    {piece.hashtags?.length > 0 && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-semibold">Hashtags</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {piece.hashtags.map((tag, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md text-xs bg-white/5 [color:var(--color-fg-muted)] border border-white/5">
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
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-success-subtle)] [color:var(--color-success)] hover:[background:var(--color-success-subtle)] border [border-color:var(--color-success-subtle)] transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-surface-active)] [color:var(--color-fg-muted)] hover:[background:var(--color-surface-active)] border [border-color:var(--color-border)] transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStatusChange(piece.id, 'approved')}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-success-subtle)] [color:var(--color-success)] hover:[background:var(--color-success-subtle)] border [border-color:var(--color-success-subtle)] transition-colors"
                        title="Approve"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleStartEdit(piece)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-info-subtle)] [color:var(--color-info)] hover:[background:var(--color-info-subtle)] border [border-color:var(--color-info-subtle)] transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleRegenerate(piece.id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-accent-subtle)] [color:var(--color-accent)] hover:[background:var(--color-accent-subtle)] border [border-color:var(--color-accent-subtle)] transition-colors"
                        title="Regenerate"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleStatusChange(piece.id, 'rejected')}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium [background:var(--color-danger-subtle)] [color:var(--color-danger)] hover:[background:var(--color-danger-subtle)] border [border-color:var(--color-danger-subtle)] transition-colors"
                        title="Reject"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                      {/* Publish to platform — only renders when the brief
                          targets one of the supported organic-publish platforms
                          AND the post is approved. The button itself further
                          gates on hasConnection + post.status. */}
                      {(() => {
                        const platformId = mapPlatformToConnector(piece.platform);
                        if (!platformId) return null;
                        const conn = connections.find(c => c.platform === platformId && c.status === 'connected');
                        const previewImage = piece.visualRefImages?.[0]?.imageUrl || null;
                        return (
                          <PublishButton
                            postId={piece.id}
                            postStatus={piece.status}
                            platform={platformId}
                            hasConnection={!!conn}
                            caption={piece.caption}
                            imageUrl={previewImage}
                            accountName={conn?.externalAccountName ?? null}
                            audited={(conn?.metadata as any)?.audited !== false}
                            compact
                          />
                        );
                      })()}
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
        <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium w-10 print:hidden">
                    <button onClick={toggleSelectAll} className="[color:var(--color-fg-subtle)] hover:text-white transition-colors">
                      {selectedIds.size === filteredPieces.length && filteredPieces.length > 0
                        ? <CheckSquare className="w-4 h-4 [color:var(--color-accent)]" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.col.platform')}</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.col.campaign')}</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium min-w-[250px]">{t('page.review.col.caption')}</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.col.chars')}</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.col.date')}</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium">{t('page.review.col.status')}</th>
                  <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider [color:var(--color-fg-subtle)] font-medium print:hidden">{t('page.review.col.actions')}</th>
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
                        selectedIds.has(piece.id) ? '[background:rgba(245,158,11,0.03)]' : ''
                      }`}
                    >
                      <td className="px-4 py-3 print:hidden">
                        <button onClick={() => toggleSelect(piece.id)} className="[color:var(--color-fg-subtle)] hover:text-white transition-colors">
                          {selectedIds.has(piece.id)
                            ? <CheckSquare className="w-4 h-4 [color:var(--color-accent)]" />
                            : <Square className="w-4 h-4" />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const ps = PLATFORM_COLORS[piece.platform.toLowerCase()] || PLATFORM_FALLBACK;
                            const pd = PLATFORM_DOT_COLORS[piece.platform.toLowerCase()] || PLATFORM_DOT_FALLBACK;
                            return (
                              <span
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border"
                                style={{ background: ps.bg, color: ps.fg, borderColor: ps.border }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: pd }} />
                                {piece.platform}
                              </span>
                            );
                          })()}
                          <span className="text-[10px] [color:var(--color-fg-subtle)]">{piece.format}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs [color:var(--color-fg-muted)]">{piece.campaignTheme || '\u2014'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs [color:var(--color-fg-muted)] line-clamp-2 max-w-[350px]">
                          {piece.caption || 'No caption'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <CharCounter count={piece.charCount} limit={piece.charLimit} status={piece.charStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs [color:var(--color-fg-subtle)]">{piece.suggestedDate || '\u2014'}</span>
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
                            className="p-1.5 rounded-md [color:var(--color-success)] hover:[color:var(--color-success)] hover:[background:var(--color-success-subtle)] transition-colors"
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStartEdit(piece)}
                            className="p-1.5 rounded-md [color:var(--color-info)] hover:[color:var(--color-info)] hover:[background:var(--color-info-subtle)] transition-colors"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRegenerate(piece.id)}
                            className="p-1.5 rounded-md [color:var(--color-accent)] hover:[color:var(--color-accent)] hover:[background:var(--color-accent-subtle)] transition-colors"
                            title="Regenerate"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStatusChange(piece.id, 'rejected')}
                            className="p-1.5 rounded-md [color:var(--color-danger)] hover:[color:var(--color-danger)] hover:[background:var(--color-danger-subtle)] transition-colors"
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
                  {(() => {
                    const ps = PLATFORM_COLORS[piece.platform.toLowerCase()] || PLATFORM_FALLBACK;
                    return (
                      <span
                        className="ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border"
                        style={{ background: ps.bg, color: ps.fg, borderColor: ps.border }}
                      >
                        {piece.platform}
                      </span>
                    );
                  })()}
                </h3>

                <div>
                  <label className="block text-xs [color:var(--color-fg-subtle)] uppercase tracking-wider mb-1.5">Creative Copy</label>
                  <textarea
                    value={editCreativeCopy}
                    onChange={e => setEditCreativeCopy(e.target.value)}
                    rows={3}
                    className="w-full [background:var(--color-surface-hover)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] resize-y"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs [color:var(--color-fg-subtle)] uppercase tracking-wider">Caption</label>
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
                    className="w-full [background:var(--color-surface-hover)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] resize-y"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleSaveEdit}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium [background:var(--color-success-subtle)] [color:var(--color-success)] hover:[background:var(--color-success-subtle)] border [border-color:var(--color-success-subtle)] transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save Changes
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium [background:var(--color-surface-active)] [color:var(--color-fg-muted)] hover:[background:var(--color-surface-active)] border [border-color:var(--color-border)] transition-colors"
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
          <div className="px-4 py-1.5 [background:var(--color-surface-hover)] backdrop-blur-sm border border-white/5 rounded-lg">
            <span className="text-[11px] [color:var(--color-fg-subtle)] font-mono tracking-wide">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded [color:var(--color-fg-muted)] text-[10px]">j</kbd>/<kbd className="px-1.5 py-0.5 bg-white/5 rounded [color:var(--color-fg-muted)] text-[10px]">k</kbd> navigate
              <span className="mx-2 [color:var(--color-fg-subtle)]">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded [color:var(--color-fg-muted)] text-[10px]">a</kbd> approve
              <span className="mx-2 [color:var(--color-fg-subtle)]">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded [color:var(--color-fg-muted)] text-[10px]">r</kbd> reject
              <span className="mx-2 [color:var(--color-fg-subtle)]">&middot;</span>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded [color:var(--color-fg-muted)] text-[10px]">e</kbd> edit
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
            <div className="flex items-center gap-3 [background:var(--color-surface-hover)] backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 shadow-2xl shadow-black/40">
              {/* Select all */}
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm [color:var(--color-fg-muted)] hover:text-white transition-colors"
              >
                {selectedIds.size === filteredPieces.length
                  ? <CheckSquare className="w-4 h-4 [color:var(--color-accent)]" />
                  : <Square className="w-4 h-4" />
                }
                <span className="[color:var(--color-accent)] font-medium">{selectedIds.size}</span>
                <span>selected</span>
              </button>

              <div className="w-px h-6 bg-white/10" />

              <button
                onClick={() => bulkAction('approved')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium [background:var(--color-success-subtle)] [color:var(--color-success)] hover:[background:var(--color-success-subtle)] border [border-color:var(--color-success-subtle)] transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve ({selectedIds.size})
              </button>

              <button
                onClick={() => bulkAction('rejected')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium [background:var(--color-danger-subtle)] [color:var(--color-danger)] hover:[background:var(--color-danger-subtle)] border [border-color:var(--color-danger-subtle)] transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>

              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium [background:var(--color-accent-subtle)] [color:var(--color-accent)] hover:[background:var(--color-accent-subtle)] border [border-color:var(--color-accent-subtle)] transition-colors"
              >
                <Printer className="w-4 h-4" />
                Export Approved
              </button>

              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-2 rounded-lg [color:var(--color-fg-subtle)] hover:text-white hover:bg-white/5 transition-colors"
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
