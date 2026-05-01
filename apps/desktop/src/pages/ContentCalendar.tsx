import { useState, useMemo, useEffect, useCallback } from 'react';
import { t } from '../i18n';
import { Calendar as CalendarIcon, X, ExternalLink, ChevronLeft, ChevronRight, Instagram, Linkedin, Twitter, Facebook, Video, Sparkles, FileText, ArrowRight, Share2, Loader2, Copy, Download, Edit3, Check, Save, Trash2, Building2, ChevronDown, ImagePlus, Archive, RotateCcw, History, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { validateCaption } from '../lib/platform-limits';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useClients } from '../lib/client-context';
import { calendarApi, reviewApi, exportsApi, jobsApi, visualRefsApi } from '../lib/backend-api';
import type { CalendarMonthSummary } from '../lib/backend-api';
import { hijriDateLabel, holidaysForDate, isInRamadan, type Holiday } from '../lib/gcc-holidays';
import { SkeletonRow, SkeletonAnnouncer } from '../components/ui/Skeleton';
import { motionUI, motionBase, motionInstant, motionHero } from '../lib/motion';
import { HoverCard } from '../components/ui/HoverCard';
import { STATUS_LABEL, normalizeStatus } from '../lib/status-enum';
import VisualRefGrid from '../components/VisualRefGrid';
import MonthlyReportButton from '../components/MonthlyReportButton';
import InboxRail, { CalendarDndProvider, useDayDroppable } from '../components/calendar/InboxRail';

/**
 * DayCell — a calendar day button wrapped in a useDayDroppable target so
 * dragged drafts from InboxRail can be dropped onto it. Adds a faint accent
 * outline + background tint when hovered with a draggable.
 */
function DayCell(props: { day: number; cellDate: Date; onClick: () => void; title?: string; className?: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDayDroppable(props.cellDate);
  return (
    <button
      ref={setNodeRef}
      onClick={props.onClick}
      title={props.title}
      className={props.className}
      style={isOver ? { outline: '1.5px dashed var(--color-accent)', outlineOffset: -2, background: 'var(--color-accent-subtle)' } : undefined}
    >
      {props.children}
    </button>
  );
}


const getPlatformIcon = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('instagram')) return <Instagram className="w-3.5 h-3.5" />;
  if (p.includes('linkedin')) return <Linkedin className="w-3.5 h-3.5" />;
  if (p.includes('tiktok')) return <Video className="w-3.5 h-3.5" />;
  if (p.includes('twitter') || p.includes('x')) return <Twitter className="w-3.5 h-3.5" />;
  if (p.includes('facebook')) return <Facebook className="w-3.5 h-3.5" />;
  return <Sparkles className="w-3.5 h-3.5" />;
};

const getPlatformColor = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('instagram')) return { dot: 'bg-pink-500', badge: 'bg-pink-500/20 text-pink-400 border-pink-500/20' };
  if (p.includes('linkedin')) return { dot: 'bg-blue-500', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/20' };
  if (p.includes('tiktok')) return { dot: 'bg-zinc-400', badge: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/20' };
  if (p.includes('twitter') || p.includes('x')) return { dot: 'bg-sky-500', badge: 'bg-sky-500/20 text-sky-400 border-sky-500/20' };
  if (p.includes('facebook')) return { dot: 'bg-indigo-500', badge: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/20' };
  return { dot: 'bg-emerald-500', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' };
};

function extractDay(dateStr: string): number | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  const iso = s.match(/^\d{4}-\d{2}-(\d{2})$/);
  if (iso) return parseInt(iso[1]);
  const monthDay = s.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})/i);
  if (monthDay) return parseInt(monthDay[1]);
  const dayMonth = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (dayMonth) return parseInt(dayMonth[1]);
  const dayN = s.match(/day\s+(\d+)/i);
  if (dayN) return parseInt(dayN[1]);
  const nums = s.match(/(\d{1,2})/g);
  if (nums) { const last = parseInt(nums[nums.length - 1]); if (last >= 1 && last <= 31) return last; }
  return null;
}

// Editable field definitions
const EDITABLE_FIELDS = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'pillar', label: 'Pillar', type: 'text' },
  { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'] },
  { key: 'format', label: 'Format', type: 'text' },
  { key: 'hook', label: 'Hook', type: 'text' },
  { key: 'keyMessage', label: 'Key Message', type: 'textarea' },
  { key: 'caption', label: 'Caption', type: 'textarea' },
  { key: 'cta', label: 'CTA', type: 'text' },
  { key: 'hashtags', label: 'Hashtags', type: 'tags' },
  { key: 'visualDirection', label: 'Visual Direction', type: 'textarea' },
  { key: 'referenceQuery', label: 'Reference Query', type: 'text' },
  { key: 'timing', label: 'Timing', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: Object.keys(STATUS_LABEL) },
] as const;

export default function ContentCalendar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clients, selectedClientId, currentClient, setSelectedClientId } = useClients();

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthOffset, setMonthOffset] = useState(0);
  const [showHijri, setShowHijri] = useState<boolean>(() => {
    try { return localStorage.getItem('radix.calendar.hijri') === '1'; } catch { return false; }
  });
  type Density = 'compact' | 'comfortable' | 'spacious';
  const [density, setDensity] = useState<Density>(() => {
    try {
      const saved = localStorage.getItem('radix.calendar.density') as Density | null;
      return saved === 'compact' || saved === 'spacious' ? saved : 'comfortable';
    } catch { return 'comfortable'; }
  });
  useEffect(() => {
    try { localStorage.setItem('radix.calendar.density', density); } catch { /* ssr */ }
  }, [density]);
  const densityClasses = {
    compact:     { gap: 'gap-1', padding: 'p-1.5', dayText: 'text-[11px]', subText: 'text-[8px]' },
    comfortable: { gap: 'gap-2', padding: 'p-2',   dayText: 'text-xs',     subText: 'text-[9px]' },
    spacious:    { gap: 'gap-3', padding: 'p-3',   dayText: 'text-sm',     subText: 'text-[10px]' },
  }[density];
  const [backendMonth, setBackendMonth] = useState<any>(null);
  const [loadingBackend, setLoadingBackend] = useState(false);
  const [reviewLink, setReviewLink] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);

  // Archive / history state — Manus-pattern: reset = archive (reversible) by default.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archivedMonths, setArchivedMonths] = useState<CalendarMonthSummary[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [pendingHardDelete, setPendingHardDelete] = useState<string | null>(null); // month key awaiting 2nd confirm

  // Edit state
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'ok' | 'error' | 'info' } | null>(null);

  const showStatus = (text: string, type: 'ok' | 'error' | 'info' = 'ok', ms = 4000) => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), ms);
  };

  // Dirty-state protection via beforeunload (works with all router types)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ─── Hard client filter — selectedClientId is the only source of truth ─────
  // URL ?client= and ?month= are display-state only; they get rewritten when
  // the global selected client changes so other pages stay in sync.
  const urlMonth = searchParams.get('month');
  const urlClient = searchParams.get('client');
  // Always use the global selected client; if URL has a different client, the
  // global client wins and we rewrite the URL.
  const activeClientId = selectedClientId || '';

  // Reset stale per-month state when the active client changes
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  useEffect(() => {
    if (urlClient && urlClient !== activeClientId) {
      // URL still references old client — rewrite URL and clear stale month
      setBackendMonth(null);
      setSelectedDay(null);
      setEditingPostId(null);
      setEditDraft({});
      setIsDirty(false);
      setAutoLoadAttempted(false);
      const next = new URLSearchParams(searchParams);
      next.delete('month');
      if (activeClientId) next.set('client', activeClientId);
      else next.delete('client');
      setSearchParams(next, { replace: true });
    }
  }, [activeClientId, urlClient]);

  const fetchMonth = useCallback(async () => {
    if (!activeClientId) {
      setBackendMonth(null);
      return;
    }
    if (urlMonth) {
      // Explicit month requested
      setLoadingBackend(true);
      try {
        const data = await calendarApi.getMonth(activeClientId, decodeURIComponent(urlMonth));
        setBackendMonth(data);
      } catch {
        setBackendMonth(null);
      } finally {
        setLoadingBackend(false);
      }
      return;
    }
    // No explicit month — fetch the list of all months for this client and pick the most recent.
    // This works regardless of how months are named (timestamp-named, freeform, calendar-style).
    if (!autoLoadAttempted) {
      setAutoLoadAttempted(true);
      setLoadingBackend(true);
      try {
        const months = await calendarApi.listMonths(activeClientId);
        if (months.length > 0) {
          const latest = months[0].month;
          const data = await calendarApi.getMonth(activeClientId, latest);
          setBackendMonth(data);
          const next = new URLSearchParams(searchParams);
          next.set('client', activeClientId);
          next.set('month', latest);
          setSearchParams(next, { replace: true });
        }
      } catch { /* ignore — empty calendar is the same UX */ }
      finally { setLoadingBackend(false); }
    }
  }, [activeClientId, urlMonth, autoLoadAttempted, searchParams]);

  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  // When the user picks a client via the in-page selector
  const handleClientPick = (id: string) => {
    if (!id || id === activeClientId) return;
    setSelectedClientId(id);
    setBackendMonth(null);
    setSelectedDay(null);
    setEditingPostId(null);
    setEditDraft({});
    setIsDirty(false);
    setAutoLoadAttempted(false);
    const next = new URLSearchParams(searchParams);
    next.set('client', id);
    next.delete('month');
    setSearchParams(next, { replace: true });
  };

  // ─── Edit handlers ─────────────────────────────────────────────
  const startEdit = (post: any) => {
    setEditingPostId(post.id);
    setEditDraft({
      title: post.title || '',
      pillar: post.pillar || '',
      platform: post.platform || 'Instagram',
      format: post.format || '',
      hook: post.hook || '',
      keyMessage: post.keyMessage || '',
      caption: post.caption || '',
      cta: post.cta || '',
      hashtags: (post.hashtags || []).join(', '),
      visualDirection: post.visualDirection || '',
      referenceQuery: post.referenceQuery || '',
      timing: post.timing || '',
      status: normalizeStatus(post.status),
    });
    setIsDirty(true);
    setSaveStatus('idle');
  };

  const cancelEdit = () => {
    setEditingPostId(null);
    setEditDraft({});
    setIsDirty(false);
    setSaveStatus('idle');
  };

  const saveEdit = async () => {
    if (!editingPostId) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const payload = {
        ...editDraft,
        hashtags: editDraft.hashtags
          ? editDraft.hashtags.split(',').map((t: string) => t.trim().replace(/^#/, '')).filter(Boolean)
          : [],
      };
      await calendarApi.updatePost(editingPostId, payload);

      // Optimistic update — patch the post in backendMonth
      if (backendMonth?.posts) {
        setBackendMonth((prev: any) => ({
          ...prev,
          posts: prev.posts.map((p: any) =>
            p.id === editingPostId ? { ...p, ...payload } : p
          ),
        }));
      }

      setSaveStatus('saved');
      setIsDirty(false);
      setTimeout(() => { setEditingPostId(null); setSaveStatus('idle'); }, 800);
    } catch (err: any) {
      setSaveStatus('error');
      showStatus('Save failed: ' + err.message, 'error', 6000);
    } finally {
      setSaving(false);
    }
  };

  const updateDraftField = (key: string, value: string) => {
    setEditDraft(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  // ─── Export + Review ───────────────────────────────────────────
  const handleExport = async () => {
    if (!urlClient || !backendMonth?.month) return;
    setExporting(true);
    setExportDone(null);
    try {
      const { jobId } = await exportsApi.trigger(urlClient, backendMonth.month);
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
          document.body.removeChild(a);
          return;
        }
        if (job.status === 'failed') throw new Error(job.error || 'Export failed');
        attempts++;
      }
      throw new Error('Export timed out');
    } catch (err: any) {
      showStatus('Export failed: ' + err.message, 'error', 6000);
    } finally {
      setExporting(false);
    }
  };

  const [backfilling, setBackfilling] = useState(false);
  const handleBackfillRefs = async () => {
    if (!activeClientId || !backendMonth?.month || backfilling) return;
    setBackfilling(true);
    try {
      const out = await calendarApi.backfillVisualRefs(activeClientId, backendMonth.month, 6);
      const msg = out.totalRefsAdded > 0
        ? `Added ${out.totalRefsAdded} visual refs across ${out.postsBackfilled}/${out.postsEligible} posts`
        : `No posts needed backfill (${out.postsScanned} scanned)`;
      showStatus(msg, 'ok');
      // Re-fetch the month so the new refs render
      fetchMonth();
    } catch (err: any) {
      showStatus('Backfill failed: ' + (err?.message || 'unknown'), 'error', 6000);
    } finally {
      setBackfilling(false);
    }
  };

  // Archive the active month (soft delete — reversible via Previous Months drawer).
  // Two-stage: button click sets state, modal asks for confirmation, confirm fires the call.
  const handleArchiveMonth = () => {
    if (!urlClient || !backendMonth?.month) return;
    setShowArchiveConfirm(true);
  };

  const confirmArchive = async () => {
    if (!urlClient || !backendMonth?.month) return;
    setShowArchiveConfirm(false);
    try {
      await calendarApi.archiveMonth(urlClient, backendMonth.month);
      showStatus(`${backendMonth.month} archived. Find it in Previous Months.`, 'ok', 5000);
      setBackendMonth(null);
      setSelectedDay(null);
      setTimeout(() => navigate(`/brief?client=${urlClient}`), 1000);
    } catch (err: any) {
      showStatus('Archive failed: ' + err.message, 'error', 6000);
    }
  };

  // Load archived months for the active client — used by Previous Months drawer.
  const loadArchived = useCallback(async () => {
    if (!urlClient) return;
    setLoadingArchived(true);
    try {
      const list = await calendarApi.listArchived(urlClient);
      setArchivedMonths(list);
    } catch (err: any) {
      showStatus('Failed to load archive: ' + err.message, 'error', 5000);
    } finally {
      setLoadingArchived(false);
    }
  }, [urlClient]);

  const openHistory = () => {
    setHistoryOpen(true);
    setPendingHardDelete(null);
    loadArchived();
  };

  const handleRestore = async (month: string) => {
    if (!urlClient) return;
    try {
      await calendarApi.restoreMonth(urlClient, month);
      showStatus(`${month} restored.`, 'ok');
      setArchivedMonths(prev => prev.filter(m => m.month !== month));
      // Navigate user to the restored month so they immediately see their work back.
      setHistoryOpen(false);
      navigate(`/calendar?client=${urlClient}&month=${encodeURIComponent(month)}`);
    } catch (err: any) {
      showStatus('Restore failed: ' + err.message, 'error', 6000);
    }
  };

  const handleHardDelete = async (month: string) => {
    if (!urlClient) return;
    // Two-step: first click arms the action, second click executes.
    if (pendingHardDelete !== month) {
      setPendingHardDelete(month);
      showStatus(`Click "Delete permanently" again within 8s to confirm.`, 'info', 8000);
      setTimeout(() => setPendingHardDelete(curr => (curr === month ? null : curr)), 8000);
      return;
    }
    try {
      await calendarApi.hardDeleteMonth(urlClient, month);
      showStatus(`${month} permanently deleted.`, 'ok');
      setArchivedMonths(prev => prev.filter(m => m.month !== month));
      setPendingHardDelete(null);
    } catch (err: any) {
      showStatus('Hard delete failed: ' + err.message, 'error', 6000);
    }
  };

  const handleCreateReviewLink = async () => {
    if (!urlClient || !backendMonth?.month) return;
    try {
      const { url } = await reviewApi.createLink(urlClient, backendMonth.month);
      setReviewLink(url);
      navigator.clipboard.writeText(url).then(() => { setCopyNotice(true); setTimeout(() => setCopyNotice(false), 2000); });
    } catch (err: any) {
      showStatus('Failed to create review link: ' + err.message, 'error', 6000);
    }
  };

  // ─── Calendar display ─────────────────────────────────────────
  const now = new Date();
  const displayDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthName = displayDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0).getDate();
  const firstDayOffset = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1).getDay();

  // Hard-filter: ONLY render the active client's backend posts.
  // No localStorage fallback — that was the source of cross-client bleed.
  const allPieces = useMemo(() => {
    if (backendMonth?.posts?.length) {
      return backendMonth.posts.map((p: any) => ({ ...p, suggestedDate: p.date }));
    }
    return [];
  }, [backendMonth]);

  const dayPieces = useMemo(() => {
    const map: Record<number, any[]> = {};
    for (const piece of allPieces) {
      const day = extractDay(piece.suggestedDate);
      if (day && day >= 1 && day <= 31) {
        if (!map[day]) map[day] = [];
        map[day].push(piece);
      }
    }
    return map;
  }, [allPieces]);

  const filteredDayPieces = useMemo(() => {
    if (platformFilter === 'All') return dayPieces;
    const filtered: Record<number, any[]> = {};
    for (const [day, pieces] of Object.entries(dayPieces)) {
      const f = pieces.filter(p => p.platform?.toLowerCase().includes(platformFilter.toLowerCase()));
      if (f.length) filtered[parseInt(day)] = f;
    }
    return filtered;
  }, [dayPieces, platformFilter]);

  const selectedPieces = selectedDay ? (filteredDayPieces[selectedDay] || []) : [];
  const totalPieces = allPieces.length;
  const platforms = Array.from(new Set<string>(allPieces.map((p: any) => String(p.platform || ''))).values()).filter(Boolean);

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* Status banner */}
      <AnimatePresence>
        {statusMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
              statusMsg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
              statusMsg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-blue-500/10 text-blue-400 border border-blue-500/20'
            }`}>
            {statusMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">{t('page.calendar.title')}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Client selector — drives the entire page */}
            <div className="relative">
              <select
                value={activeClientId}
                onChange={e => handleClientPick(e.target.value)}
                className="appearance-none rounded-lg bg-violet-500/15 border border-violet-500/30 pl-8 pr-8 py-1.5 text-xs font-semibold text-violet-300 outline-none cursor-pointer hover:bg-violet-500/20"
              >
                {clients.length === 0 && <option value="">No clients</option>}
                {clients.map(c => (
                  <option key={c.id} value={c.id} className="bg-zinc-900 text-white">{c.name}</option>
                ))}
              </select>
              <Building2 className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400" />
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-violet-400" />
            </div>
            <span className="text-xs text-zinc-600">·</span>
            <p className="text-xs text-zinc-500">
              {loadingBackend ? 'Loading from server...' :
                backendMonth ? `${backendMonth.month} — ${totalPieces} posts (${backendMonth.status})` :
                activeClientId ? 'No content yet — create a brief first' :
                'Pick a client to load their calendar'}
            </p>
          </div>
        </div>
        {backendMonth && (
          <div className="flex items-center gap-2">
            {exportDone && (
              <a href={exportDone} download
                className="text-[10px] text-violet-400 bg-violet-500/10 px-3 py-1.5 rounded-lg hover:bg-violet-500/20 transition-colors">
                Download again
              </a>
            )}
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] text-zinc-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/[0.1] cursor-pointer disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? 'Exporting...' : 'Export PPTX'}
            </button>
            {urlClient && backendMonth?.month && (
              <MonthlyReportButton
                clientId={urlClient}
                month={backendMonth.month}
                postCount={backendMonth.posts?.length ?? 0}
                onStatus={showStatus}
              />
            )}
            {reviewLink && (
              <div className="text-[10px] text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg">
                {copyNotice ? 'Copied!' : 'Link created'}
              </div>
            )}
            <button onClick={handleCreateReviewLink}
              className="flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] text-zinc-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/[0.1] cursor-pointer">
              <Share2 className="w-4 h-4" /> Share for Review
            </button>
            <button onClick={handleBackfillRefs} disabled={backfilling}
              className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 text-violet-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-violet-500/20 cursor-pointer disabled:opacity-50">
              {backfilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {backfilling ? 'Backfilling...' : 'Backfill Refs'}
            </button>
            <button onClick={openHistory}
              className="flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] text-zinc-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/[0.1] cursor-pointer">
              <History className="w-4 h-4" /> Previous Months
            </button>
            <button onClick={handleArchiveMonth}
              title="Archive this month — reversible. Posts are preserved in Previous Months."
              className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-amber-500/20 cursor-pointer">
              <Archive className="w-4 h-4" /> Archive Month
            </button>
          </div>
        )}
      </motion.div>

      {/* Empty state */}
      {totalPieces === 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionBase, delay: 0.1 }}
          className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-12 text-center">
          <CalendarIcon className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-zinc-400 mb-2">No content scheduled</h2>
          <p className="text-zinc-600 text-sm mb-6">Create a content brief to populate your calendar</p>
          <Link to="/brief"
            className="inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-colors">
            <FileText className="w-4 h-4" /> Create Brief
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      )}

      {totalPieces > 0 && (
        <>
          {/* Controls */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionBase, delay: 0.05 }}
            className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setMonthOffset(o => o - 1)}
                className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-white hover:border-white/[0.1] transition-all cursor-pointer">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-bold text-white min-w-[180px] text-center">{monthName}</h2>
              <button onClick={() => setMonthOffset(o => o + 1)}
                className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-white hover:border-white/[0.1] transition-all cursor-pointer">
                <ChevronRight className="w-4 h-4" />
              </button>
              {monthOffset !== 0 && (
                <button onClick={() => setMonthOffset(0)}
                  className="text-[10px] text-zinc-600 hover:text-white transition-colors cursor-pointer">Today</button>
              )}
              <button
                onClick={() => {
                  const next = !showHijri;
                  setShowHijri(next);
                  try { localStorage.setItem('radix.calendar.hijri', next ? '1' : '0'); } catch {}
                }}
                title="Toggle Hijri / Gregorian dual display"
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                  showHijri ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-zinc-600 hover:text-zinc-300 border border-white/[0.06] hover:border-white/[0.12]'
                }`}>
                ه Hijri
              </button>
              {/* Density toggle — compact / comfortable / spacious */}
              <div className="inline-flex items-center rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                {(['compact','comfortable','spacious'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDensity(d)}
                    title={`${d[0].toUpperCase() + d.slice(1)} density`}
                    aria-pressed={density === d}
                    className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors cursor-pointer first:rounded-l-lg last:rounded-r-lg"
                    style={{
                      background: density === d ? 'var(--color-surface-active)' : 'transparent',
                      color: density === d ? 'var(--color-fg)' : 'var(--color-fg-subtle)',
                    }}
                  >
                    {d === 'compact' ? '·' : d === 'comfortable' ? '··' : '···'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {['All', ...platforms].map(p => (
                <button key={p} onClick={() => setPlatformFilter(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    platformFilter === p
                      ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                      : 'text-zinc-600 hover:text-zinc-300 border border-transparent'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Calendar Grid + Inbox Rail (Tier 2 #5 + Tier 3 #9) */}
          <CalendarDndProvider onDrop={() => { try { (window as any).dispatchEvent(new CustomEvent('radix:calendar-refetch')); } catch {} }}>
          <div className="flex gap-3">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionBase, delay: 0.1 }}
            className="flex-1 min-w-0 rounded-3xl border p-5"
            style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}>
            <div className={`grid grid-cols-7 ${densityClasses.gap} mb-2`}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider py-2" style={{ color: 'var(--color-fg-subtle)' }}>{d}</div>
              ))}
            </div>
            <AnimatePresence mode="wait">
            <motion.div
              key={monthOffset}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={motionUI}
              className={`grid grid-cols-7 ${densityClasses.gap}`}
            >
              {Array.from({ length: firstDayOffset }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-xl" style={{ background: 'var(--color-surface)' }} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const pieces = filteredDayPieces[day] || [];
                const isSelected = selectedDay === day;
                const isToday = monthOffset === 0 && day === now.getDate();
                const cellDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
                const dayHolidays: Holiday[] = holidaysForDate(cellDate);
                const ramadan = isInRamadan(cellDate);
                const hijri = showHijri ? hijriDateLabel(cellDate) : '';
                const hijriShort = hijri ? hijri.split(' ').slice(0, 2).join(' ') : '';
                return (
                  <HoverCard.Root key={day} openDelay={pieces.length > 0 ? 250 : 9_999_999}>
                  <HoverCard.Trigger asChild>
                  <DayCell
                    day={day} cellDate={cellDate}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    title={dayHolidays.map((h) => h.name).join(' · ') || (hijri || undefined)}
                    className={`aspect-square rounded-xl border ${densityClasses.padding} flex flex-col transition-all cursor-pointer relative ${
                      isSelected ? 'bg-white/[0.08] border-white/[0.2]'
                        : dayHolidays.length > 0 ? 'bg-amber-500/[0.06] border-amber-500/30 hover:border-amber-500/50'
                        : ramadan ? 'bg-emerald-500/[0.04] border-emerald-500/20 hover:border-emerald-500/40'
                        : pieces.length > 0 ? 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                        : 'bg-white/[0.01] border-white/[0.03] hover:bg-white/[0.02]'
                    }`}>
                    <div className="flex items-start justify-between w-full">
                      <span className={`text-xs font-bold ${
                        isToday ? 'text-white bg-white/20 w-6 h-6 rounded-full flex items-center justify-center' :
                        pieces.length > 0 ? 'text-zinc-300' : 'text-zinc-700'
                      }`}>{day}</span>
                      {showHijri && hijriShort && (
                        <span className="text-[8px] font-medium text-amber-400/70 leading-tight text-right">{hijriShort}</span>
                      )}
                    </div>
                    {dayHolidays.length > 0 && (
                      <span className="text-[7px] uppercase tracking-wider text-amber-300/80 mt-0.5 truncate w-full" title={dayHolidays[0].name}>
                        {dayHolidays[0].name.length > 12 ? dayHolidays[0].name.slice(0, 12) + '…' : dayHolidays[0].name}
                      </span>
                    )}
                    {pieces.length > 0 && (
                      <div className="mt-auto space-y-0.5">
                        {pieces.slice(0, 2).map((p: any, j: number) => (
                          <div
                            key={j}
                            className="flex items-center gap-1 truncate rounded px-1 py-[1px] text-[8px] font-medium leading-tight"
                            style={{
                              background: 'var(--color-surface)',
                              color: 'var(--color-fg-muted)',
                            }}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${getPlatformColor(p.platform).dot}`} />
                            <span className="truncate uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>{p.platform}</span>
                          </div>
                        ))}
                        {pieces.length > 2 && (
                          <span className="block text-[8px]" style={{ color: 'var(--color-fg-subtle)' }}>+{pieces.length - 2} more</span>
                        )}
                      </div>
                    )}
                  </DayCell>
                  </HoverCard.Trigger>
                  {pieces.length > 0 && (
                    <HoverCard.Content side="top" align="center">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                            {new Date(displayDate.getFullYear(), displayDate.getMonth(), day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                          </span>
                          <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-fg-muted)' }}>
                            {pieces.length} post{pieces.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        {pieces.slice(0, 3).map((p: any, j: number) => (
                          <div key={j} className="flex items-start gap-2 rounded-lg p-2" style={{ background: 'var(--color-surface)' }}>
                            <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${getPlatformColor(p.platform).dot}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-muted)' }}>{p.platform}</p>
                              <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug" style={{ color: 'var(--color-fg)' }}>
                                {p.caption || p.brief || '(no caption)'}
                              </p>
                            </div>
                          </div>
                        ))}
                        {pieces.length > 3 && (
                          <p className="text-center text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                            + {pieces.length - 3} more — click to open
                          </p>
                        )}
                      </div>
                    </HoverCard.Content>
                  )}
                  </HoverCard.Root>
                );
              })}
            </motion.div>
            </AnimatePresence>
          </motion.div>
          <InboxRail clientId={activeClientId || null} />
          </div>
          </CalendarDndProvider>

          {/* Selected Day Detail Panel */}
          <AnimatePresence>
            {selectedDay && selectedPieces.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold text-white">
                    {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay} — {selectedPieces.length} piece{selectedPieces.length > 1 ? 's' : ''}
                  </h3>
                  <button onClick={() => setSelectedDay(null)}
                    className="p-1.5 text-zinc-600 hover:text-white transition-colors cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  {selectedPieces.map((piece: any, i: number) => {
                    const isEditing = editingPostId === piece.id;
                    const v = validateCaption(isEditing ? editDraft.caption || '' : piece.caption || '', (isEditing ? editDraft.platform : piece.platform) || 'Instagram');
                    const pc = getPlatformColor(isEditing ? editDraft.platform : piece.platform);

                    return (
                      <motion.div key={piece.id || i}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionUI, delay: i * 0.05 }}
                        className={`rounded-2xl border p-5 space-y-3 ${isEditing ? 'bg-white/[0.04] border-violet-500/30' : 'bg-white/[0.02] border-white/[0.05]'}`}>

                        {/* Header: Platform + Format + Edit/Save buttons */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${pc.badge}`}>
                            {getPlatformIcon(isEditing ? editDraft.platform : piece.platform)} {isEditing ? editDraft.platform : piece.platform}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-600 bg-white/[0.03] px-2 py-1 rounded-lg">
                            {isEditing ? editDraft.format : piece.format}
                          </span>
                          {piece.pillar && !isEditing && (
                            <span className="text-[10px] font-medium text-violet-400/60 bg-violet-500/10 px-2 py-1 rounded-lg">{piece.pillar}</span>
                          )}

                          <div className="ml-auto flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              v.status === 'good' ? 'bg-emerald-500/10 text-emerald-400' :
                              v.status === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
                            }`}>{v.length}/{v.max}</span>

                            {isEditing ? (
                              <>
                                {saveStatus === 'saved' && (
                                  <span className="text-[10px] text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>
                                )}
                                <button onClick={saveEdit} disabled={saving}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 cursor-pointer">
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                                </button>
                                <button onClick={cancelEdit}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold bg-zinc-500/20 text-zinc-400 border border-zinc-500/20 hover:bg-zinc-500/30 cursor-pointer">
                                  <X className="w-3 h-3" /> Cancel
                                </button>
                              </>
                            ) : (
                              piece.id && (
                                <button onClick={() => startEdit(piece)}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold bg-white/[0.05] text-zinc-400 border border-white/[0.08] hover:text-white hover:bg-white/[0.1] cursor-pointer">
                                  <Edit3 className="w-3 h-3" /> Edit
                                </button>
                              )
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          /* ─── Edit Form ─────────────────────────────────── */
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              {/* Title */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Title</label>
                                <input value={editDraft.title} onChange={e => updateDraftField('title', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5" />
                              </div>
                              {/* Pillar */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Pillar</label>
                                <input value={editDraft.pillar} onChange={e => updateDraftField('pillar', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5" />
                              </div>
                              {/* Platform */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Platform</label>
                                <select value={editDraft.platform} onChange={e => updateDraftField('platform', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5">
                                  {['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </div>
                              {/* Format */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Format</label>
                                <input value={editDraft.format} onChange={e => updateDraftField('format', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5" />
                              </div>
                              {/* Status */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Status</label>
                                <select value={editDraft.status} onChange={e => updateDraftField('status', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5">
                                  {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s as keyof typeof STATUS_LABEL]}</option>)}
                                </select>
                              </div>
                              {/* Timing */}
                              <div>
                                <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Timing</label>
                                <input value={editDraft.timing} onChange={e => updateDraftField('timing', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5" />
                              </div>
                            </div>

                            {/* Hook */}
                            <div>
                              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Hook</label>
                              <input value={editDraft.hook} onChange={e => updateDraftField('hook', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 mt-0.5" />
                            </div>

                            {/* Key Message */}
                            <div>
                              <label className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Key Message (on visual)</label>
                              <textarea value={editDraft.keyMessage} onChange={e => updateDraftField('keyMessage', e.target.value)} rows={2}
                                className="w-full bg-zinc-900 border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 outline-none focus:border-amber-500/40 resize-y mt-0.5" />
                            </div>

                            {/* Caption */}
                            <div>
                              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Caption</label>
                              <textarea value={editDraft.caption} onChange={e => updateDraftField('caption', e.target.value)} rows={4}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 resize-y mt-0.5" />
                            </div>

                            {/* CTA */}
                            <div>
                              <label className="text-[9px] text-emerald-400/60 uppercase tracking-wider font-semibold">CTA</label>
                              <input value={editDraft.cta} onChange={e => updateDraftField('cta', e.target.value)}
                                className="w-full bg-zinc-900 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 text-xs text-emerald-200 outline-none focus:border-emerald-500/40 mt-0.5" />
                            </div>

                            {/* Hashtags */}
                            <div>
                              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Hashtags (comma-separated)</label>
                              <input value={editDraft.hashtags} onChange={e => updateDraftField('hashtags', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-violet-300 outline-none focus:border-violet-500/40 mt-0.5"
                                placeholder="tag1, tag2, tag3" />
                            </div>

                            {/* Visual Direction */}
                            <div>
                              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Visual Direction</label>
                              <textarea value={editDraft.visualDirection} onChange={e => updateDraftField('visualDirection', e.target.value)} rows={2}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500/40 resize-y mt-0.5" />
                            </div>

                            {/* Reference Query */}
                            <div>
                              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Reference Query</label>
                              <input value={editDraft.referenceQuery} onChange={e => updateDraftField('referenceQuery', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500/40 mt-0.5" />
                            </div>
                          </div>
                        ) : (
                          /* ─── Read-only view ────────────────────────────── */
                          <>
                            {/* Title */}
                            {piece.title && (
                              <h4 className="text-sm font-bold text-white">{piece.title}</h4>
                            )}

                            {/* Hook */}
                            {piece.hook && (
                              <p className="text-xs text-amber-300/80 italic">"{piece.hook}"</p>
                            )}

                            {/* Art Direction */}
                            {(piece.creativeCopy || piece.visualDirection) && (
                              <div>
                                <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1">Art Direction</h4>
                                <p className="text-xs text-zinc-400 leading-relaxed">{piece.visualDirection || piece.creativeCopy}</p>
                              </div>
                            )}

                            {/* Copy Section */}
                            <div className="space-y-2 bg-white/[0.01] rounded-lg p-3 border border-white/[0.03]">
                              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Copy</h4>

                              {piece.keyMessage && (
                                <div>
                                  <span className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Key Message (on visual)</span>
                                  <p className="text-sm text-amber-200/90 font-medium bg-amber-500/[0.06] rounded-lg px-2 py-1.5 border border-amber-500/10 mt-0.5">{piece.keyMessage}</p>
                                </div>
                              )}

                              <div>
                                <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">Caption</span>
                                <p className="text-sm text-zinc-200 bg-white/[0.02] p-2 rounded-lg border border-white/[0.04] whitespace-pre-wrap leading-relaxed mt-0.5">{piece.caption}</p>
                              </div>

                              {piece.cta && (
                                <div>
                                  <span className="text-[9px] text-emerald-400/60 uppercase tracking-wider font-semibold">CTA</span>
                                  <p className="text-sm text-emerald-300/90 font-medium bg-emerald-500/[0.06] rounded-lg px-2 py-1.5 border border-emerald-500/10 mt-0.5">{piece.cta}</p>
                                </div>
                              )}

                              {piece.hashtags?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {piece.hashtags.map((h: string, j: number) => (
                                    <span key={j} className="text-[10px] text-violet-400/70 bg-violet-500/10 px-1.5 py-0.5 rounded">#{h.replace(/^#/, '')}</span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Visual references — external refs preferred, internal assets fallback */}
                            <VisualRefGrid
                              post={piece}
                              onSearchClick={async (q) => {
                                try {
                                  await visualRefsApi.autoPopulate(piece.id, 6);
                                  showStatus(`Added inspiration refs for "${q.slice(0, 40)}"`, 'ok');
                                  fetchMonth();
                                } catch (err: any) {
                                  showStatus('Auto-populate failed: ' + err.message, 'error', 6000);
                                }
                              }}
                            />


                            {piece.timing && (
                              <p className="text-[10px] text-zinc-600">Timing: {piece.timing}</p>
                            )}
                          </>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {selectedDay && selectedPieces.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-8 text-center">
              <p className="text-zinc-600 text-sm">No content scheduled for {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay}</p>
            </motion.div>
          )}
        </>
      )}

      {/* Previous Months drawer — Manus-style history panel */}
      <AnimatePresence>
        {historyOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-drawer bg-black/70 backdrop-blur-sm flex items-start justify-end p-0"
            onClick={() => setHistoryOpen(false)}
          >
            <motion.div
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="h-full w-full max-w-md bg-[#0a0a0a] border-l border-white/10 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-white">Previous Months</h2>
                </div>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {loadingArchived && (
                  <div className="space-y-2">
                    <SkeletonAnnouncer label="Loading archived months…" />
                    {Array.from({ length: 4 }).map((_, i) => (
                      <SkeletonRow key={i} delay={i * 70} />
                    ))}
                  </div>
                )}

                {!loadingArchived && archivedMonths.length === 0 && (
                  <div className="text-center py-12">
                    <Archive className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500">No archived months yet.</p>
                    <p className="text-xs text-zinc-600 mt-1">When you archive a month it shows up here — restore anytime.</p>
                  </div>
                )}

                {!loadingArchived && archivedMonths.map((m) => {
                  const isArmed = pendingHardDelete === m.month;
                  return (
                    <div key={m.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{m.month}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            {m.postCount} post{m.postCount === 1 ? '' : 's'} · archived {m.archivedAt ? new Date(m.archivedAt).toLocaleDateString() : 'recently'}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded-md px-1.5 py-0.5 shrink-0">
                          {m.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleRestore(m.month)}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-emerald-500/20 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                        <button
                          onClick={() => handleHardDelete(m.month)}
                          aria-pressed={isArmed}
                          aria-label={isArmed
                            ? `Armed: click again within 8 seconds to permanently delete ${m.month} and all ${m.postCount} posts. This cannot be undone.`
                            : `Delete ${m.month} permanently. Two-step confirmation will arm the button.`}
                          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                            isArmed
                              ? 'bg-red-500/30 border-red-500/50 text-red-200 animate-pulse'
                              : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                          }`}
                        >
                          <span aria-live="assertive" aria-atomic="true" className="flex items-center gap-1.5">
                            {isArmed ? (
                              <>
                                <AlertTriangle className="w-3.5 h-3.5" /> Confirm delete
                              </>
                            ) : (
                              <>
                                <Trash2 className="w-3.5 h-3.5" /> Delete permanently
                              </>
                            )}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 border-t border-white/[0.06] bg-black/30">
                <p className="text-[10px] text-zinc-600 leading-relaxed">
                  Archived months stay safe until you delete them permanently. Hard delete removes the month + all posts and cannot be undone.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Archive confirm modal — replaces native window.confirm with styled UI */}
      <AnimatePresence>
        {showArchiveConfirm && backendMonth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionInstant}
            className="fixed inset-0 z-popover bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowArchiveConfirm(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-confirm-title"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={motionUI}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-[#0a0a0a] border border-white/10 shadow-2xl shadow-black/50 overflow-hidden"
            >
              <div className="flex items-start gap-3 p-5 border-b border-white/[0.06]">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <Archive className="w-4 h-4 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <h2 id="archive-confirm-title" className="text-base font-bold text-white">
                    Archive {backendMonth.month}?
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {currentClient?.name || 'this client'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  aria-label="Cancel"
                  className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/[0.06] cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3">
                <p className="text-sm text-zinc-300 leading-relaxed">
                  This moves the month to <span className="text-amber-300 font-semibold">Previous Months</span>. Posts are preserved and can be restored anytime from the history drawer.
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  To delete permanently, open Previous Months and use "Delete permanently" there.
                </p>
              </div>

              <div className="flex items-center gap-2 p-4 border-t border-white/[0.06] bg-black/30">
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm font-semibold text-zinc-300 hover:bg-white/[0.08] cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmArchive}
                  autoFocus
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300/60"
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
