import { useState, useMemo, useEffect, useCallback } from 'react';
import { t } from '../i18n';
import { Calendar as CalendarIcon, X, ExternalLink, ChevronLeft, ChevronRight, Instagram, Linkedin, Twitter, Facebook, Video, Sparkles, FileText, ArrowRight, Share2, Loader2, Copy, Download, Edit3, Check, Save, Trash2, Building2, ChevronDown, ImagePlus, Archive, RotateCcw, History, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Dialog } from '../components/ui/Dialog';
import { validateCaption } from '../lib/platform-limits';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useClients } from '../lib/client-context';
import { calendarApi, reviewApi, exportsApi, jobsApi, visualRefsApi } from '../lib/backend-api';
import type { CalendarMonthSummary } from '../lib/backend-api';
import { hijriDateLabel, holidaysForDate, isInRamadan, type Holiday } from '../lib/gcc-holidays';
import { SkeletonRow, SkeletonAnnouncer } from '../components/ui/Skeleton';
import { motionUI, motionBase } from '../lib/motion';
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
function DayCell(props: { day: number; cellDate: Date; onClick: () => void; title?: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDayDroppable(props.cellDate);
  return (
    <button
      ref={setNodeRef}
      onClick={props.onClick}
      title={props.title}
      className={props.className}
      style={{
        ...props.style,
        ...(isOver ? { outline: '1.5px dashed var(--color-accent)', outlineOffset: -2, background: 'var(--color-accent-subtle)' } : {}),
      }}
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
      // PERF-8: route returns 202 + jobId; worker does the search/insert loop.
      const { jobId } = await calendarApi.backfillVisualRefs(activeClientId, backendMonth.month, 6);
      showStatus('Backfilling visual references…', 'ok');
      // Poll up to 2 minutes (visual search can be slow per post).
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const job = await jobsApi.get(jobId);
        if (job.status === 'completed') {
          const r = (job as any).result || {};
          const msg = r.totalRefsAdded > 0
            ? `Added ${r.totalRefsAdded} visual refs across ${r.postsBackfilled}/${r.postsEligible} posts`
            : `No posts needed backfill (${r.postsScanned ?? 0} scanned)`;
          showStatus(msg, 'ok');
          fetchMonth();
          return;
        }
        if (job.status === 'failed') {
          showStatus('Backfill failed: ' + ((job as any).error || 'unknown'), 'error', 6000);
          return;
        }
      }
      showStatus('Backfill still running — check back in a moment.', 'ok', 6000);
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

  // Sync the visible grid to the LOADED month (A3 fix). The grid is anchored to
  // the current month via monthOffset; without this, a loaded July calendar
  // rendered the June grid and its July-dated posts didn't show. Parse the
  // stored month label ("July 2026" or "2026-07") → offset from current month.
  useEffect(() => {
    const label = backendMonth?.month;
    if (!label) return;
    const n = new Date();
    let y: number | undefined; let m: number | undefined; // m = 0-based
    const iso = String(label).match(/(\d{4})-(\d{2})/);
    const txt = String(label).match(/([A-Za-z]+)\s+(\d{4})/);
    if (iso) { y = +iso[1]; m = +iso[2] - 1; }
    else if (txt) { const mi = new Date(`${txt[1]} 1, ${txt[2]}`); if (!isNaN(mi.getTime())) { y = +txt[2]; m = mi.getMonth(); } }
    if (y === undefined || m === undefined) return;
    setMonthOffset((y - n.getFullYear()) * 12 + (m - n.getMonth()));
  }, [backendMonth?.month]);

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
            className="rounded-xl px-4 py-2.5 text-sm font-medium border"
            style={{
              background:
                statusMsg.type === 'ok' ? 'var(--color-success-subtle)' :
                statusMsg.type === 'error' ? 'var(--color-danger-subtle)' :
                'var(--color-info-subtle)',
              color:
                statusMsg.type === 'ok' ? 'var(--color-success)' :
                statusMsg.type === 'error' ? 'var(--color-danger)' :
                'var(--color-info)',
              borderColor:
                statusMsg.type === 'ok' ? 'color-mix(in srgb, var(--color-success) 24%, transparent)' :
                statusMsg.type === 'error' ? 'color-mix(in srgb, var(--color-danger) 24%, transparent)' :
                'color-mix(in srgb, var(--color-info) 24%, transparent)',
            }}>
            {statusMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border px-6 py-5 flex items-start justify-between gap-4 flex-wrap"
        style={{
          background: 'linear-gradient(135deg, var(--color-bg-elevated), color-mix(in srgb, var(--color-accent) 4%, var(--color-bg-elevated)))',
          borderColor: 'var(--color-border-subtle)',
        }}>
        {/* Decorative accent glow — depth layer behind header content */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 end-[-4rem] w-72 h-72 rounded-full blur-3xl opacity-[0.5] z-0"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 70%)' }} />
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl border"
              style={{ background: 'var(--color-accent-subtle)', borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }}>
              <CalendarIcon className="w-5 h-5" style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
            </span>
            <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--color-fg)' }}>{t('page.calendar.title')}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Client selector — drives the entire page */}
            <div className="relative">
              <select
                value={activeClientId}
                onChange={e => handleClientPick(e.target.value)}
                className="appearance-none rounded-lg px-8 py-1.5 text-xs font-semibold outline-none cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--color-info)]"
                style={{
                  background: 'color-mix(in srgb, var(--color-info) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-info) 32%, transparent)',
                  color: 'var(--color-info)',
                }}
              >
                {clients.length === 0 && <option value="">No clients</option>}
                {clients.map(c => (
                  <option key={c.id} value={c.id} style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-fg)' }}>{c.name}</option>
                ))}
              </select>
              <Building2 className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--color-info)' }} />
              <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--color-info)' }} />
            </div>
            <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>·</span>
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              {loadingBackend ? 'Loading from server...' :
                backendMonth ? `${backendMonth.month} — ${totalPieces} posts (${backendMonth.status})` :
                activeClientId ? 'No content yet — create a brief first' :
                'Pick a client to load their calendar'}
            </p>
          </div>
        </div>
        {backendMonth && (
          <div className="relative z-10 flex items-center gap-2 flex-wrap justify-end">
            {exportDone && (
              <a href={exportDone} download
                className="text-[10px] px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-info)', background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}>
                Download again
              </a>
            )}
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? 'Exporting...' : 'Export PPTX'}
            </button>
            {/* Monthly Report hidden until its backend exists — POST /reports/monthly
                is not implemented server-side, so the button 404'd ("Report failed").
                Re-enable once reportsRoutes ships. Component + reportsApi kept intact. */}
            {false && urlClient && backendMonth?.month && (
              <MonthlyReportButton
                clientId={urlClient}
                month={backendMonth.month}
                postCount={backendMonth.posts?.length ?? 0}
                onStatus={showStatus}
              />
            )}
            {reviewLink && (
              <div className="text-[10px] px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--color-success)', background: 'var(--color-success-subtle)' }}>
                {copyNotice ? 'Copied!' : 'Link created'}
              </div>
            )}
            <button onClick={handleCreateReviewLink}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}>
              <Share2 className="w-4 h-4" /> Share for Review
            </button>
            <button onClick={handleBackfillRefs} disabled={backfilling}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              style={{ background: 'color-mix(in srgb, var(--color-info) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-info) 24%, transparent)', color: 'var(--color-info)' }}>
              {backfilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {backfilling ? 'Backfilling...' : 'Backfill Refs'}
            </button>
            <button onClick={openHistory}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}>
              <History className="w-4 h-4" /> Previous Months
            </button>
            <button onClick={handleArchiveMonth}
              title="Archive this month — reversible. Posts are preserved in Previous Months."
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: 'var(--color-accent-subtle)', border: '1px solid color-mix(in srgb, var(--color-accent) 24%, transparent)', color: 'var(--color-accent)' }}>
              <Archive className="w-4 h-4" /> Archive Month
            </button>
          </div>
        )}
      </motion.div>

      {/* Empty state — no months generated for this client yet */}
      {totalPieces === 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionBase, delay: 0.1 }}
          className="rounded-3xl border p-12 text-center shadow-sm"
          style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}>
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center border"
            style={{ background: 'var(--color-accent-subtle)', borderColor: 'var(--color-border-subtle)' }}
          >
            <CalendarIcon className="w-7 h-7" style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-fg)' }}>No months generated</h2>
          <p className="text-sm mb-6 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
            Create a content brief to generate this client's first month of scheduled posts.
          </p>
          <Link to="/brief"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-colors hover:brightness-110"
            style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}>
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
              <button onClick={() => setMonthOffset(o => o - 1)} aria-label="Previous month"
                className="p-2 rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-black tracking-tight min-w-[180px] text-center" style={{ color: 'var(--color-fg)' }}>{monthName}</h2>
              <button onClick={() => setMonthOffset(o => o + 1)} aria-label="Next month"
                className="p-2 rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}>
                <ChevronRight className="w-4 h-4" />
              </button>
              {monthOffset !== 0 && (
                <button onClick={() => setMonthOffset(0)}
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md transition-colors cursor-pointer"
                  style={{ color: 'var(--color-accent)', background: 'var(--color-accent-subtle)' }}>Today</button>
              )}
              <button
                onClick={() => {
                  const next = !showHijri;
                  setShowHijri(next);
                  try { localStorage.setItem('radix.calendar.hijri', next ? '1' : '0'); } catch {}
                }}
                title="Toggle Hijri / Gregorian dual display"
                aria-pressed={showHijri}
                className="px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer border"
                style={showHijri
                  ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }
                  : { background: 'transparent', color: 'var(--color-fg-subtle)', borderColor: 'var(--color-border-subtle)' }}>
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
                    className="px-2.5 py-1.5 min-w-[28px] min-h-[28px] text-[10px] font-medium uppercase tracking-wider transition-colors cursor-pointer first:rounded-l-lg last:rounded-r-lg"
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
                  aria-pressed={platformFilter === p}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border"
                  style={platformFilter === p
                    ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }
                    : { background: 'transparent', color: 'var(--color-fg-subtle)', borderColor: 'transparent' }}>
                  {p}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Calendar Grid + Inbox Rail (Tier 2 #5 + Tier 3 #9) */}
          <CalendarDndProvider onDrop={() => { try { (window as any).dispatchEvent(new CustomEvent('radix:calendar-refetch')); } catch {} }}>
          <div className="flex gap-3">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionBase, delay: 0.1 }}
            className="relative overflow-hidden flex-1 min-w-0 rounded-3xl border p-5"
            style={{
              background: 'linear-gradient(160deg, var(--color-bg-elevated), color-mix(in srgb, var(--color-accent) 3%, var(--color-bg-elevated)))',
              borderColor: 'var(--color-border-subtle)',
              boxShadow: '0 1px 0 0 color-mix(in srgb, var(--color-fg) 4%, transparent) inset, 0 20px 50px -30px color-mix(in srgb, var(--color-bg-sunken) 60%, transparent)',
            }}>
            {/* Decorative corner glow — depth layer behind the grid */}
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 start-[-5rem] w-80 h-80 rounded-full blur-3xl opacity-40 z-0"
              style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%)' }} />
            <div className={`relative z-10 grid grid-cols-7 ${densityClasses.gap} mb-2`}>
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
              className={`relative z-10 grid grid-cols-7 ${densityClasses.gap}`}
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
                    className={`aspect-square rounded-xl border ${densityClasses.padding} flex flex-col transition-all duration-200 cursor-pointer relative ${pieces.length > 0 || dayHolidays.length > 0 ? 'hover:-translate-y-0.5' : ''}`}
                    style={
                      isSelected ? {
                        background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
                        borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
                        boxShadow: '0 8px 24px -12px color-mix(in srgb, var(--color-accent) 50%, transparent)',
                      }
                        : dayHolidays.length > 0 ? {
                        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                        borderColor: 'color-mix(in srgb, var(--color-accent) 32%, transparent)',
                      }
                        : ramadan ? {
                        background: 'color-mix(in srgb, var(--color-success) 7%, transparent)',
                        borderColor: 'color-mix(in srgb, var(--color-success) 24%, transparent)',
                      }
                        : pieces.length > 0 ? {
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border-subtle)',
                      }
                        : {
                        background: 'color-mix(in srgb, var(--color-fg) 2%, transparent)',
                        borderColor: 'var(--color-border-subtle)',
                      }
                    }>
                    <div className="flex items-start justify-between w-full">
                      {isToday ? (
                        <span className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ color: 'var(--color-fg-on-accent)', background: 'var(--color-accent)' }}>{day}</span>
                      ) : (
                        <span className="text-xs font-bold tabular-nums"
                          style={{ color: pieces.length > 0 ? 'var(--color-fg)' : 'var(--color-fg-subtle)' }}>{day}</span>
                      )}
                      {showHijri && hijriShort && (
                        <span className="text-[8px] font-medium leading-tight text-end" style={{ color: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-fg-subtle))' }}>{hijriShort}</span>
                      )}
                    </div>
                    {dayHolidays.length > 0 && (
                      <span className="text-[7px] uppercase tracking-wider mt-0.5 truncate w-full" style={{ color: 'var(--color-accent)' }} title={dayHolidays[0].name}>
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
                              background: 'var(--color-bg-elevated)',
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
                className="relative overflow-hidden rounded-3xl border p-6"
                style={{
                  background: 'var(--color-bg-elevated)',
                  borderColor: 'var(--color-border-subtle)',
                  boxShadow: '0 20px 50px -30px color-mix(in srgb, var(--color-bg-sunken) 60%, transparent)',
                }}>
                <div aria-hidden="true" className="pointer-events-none absolute -top-24 end-[-3rem] w-64 h-64 rounded-full blur-3xl opacity-30 z-0"
                  style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%)' }} />
                <div className="relative z-10 flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-fg)' }}>
                    <span className="inline-block w-1 h-4 rounded-full" style={{ background: 'var(--color-accent)' }} />
                    {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay} — {selectedPieces.length} piece{selectedPieces.length > 1 ? 's' : ''}
                  </h3>
                  <button onClick={() => setSelectedDay(null)} aria-label="Close day detail"
                    className="p-1.5 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--color-fg-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative z-10 space-y-4">
                  {selectedPieces.map((piece: any, i: number) => {
                    const isEditing = editingPostId === piece.id;
                    const v = validateCaption(isEditing ? editDraft.caption || '' : piece.caption || '', (isEditing ? editDraft.platform : piece.platform) || 'Instagram');
                    const pc = getPlatformColor(isEditing ? editDraft.platform : piece.platform);

                    return (
                      <motion.div key={piece.id || i}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionUI, delay: i * 0.05 }}
                        className="rounded-2xl border p-5 space-y-3 transition-shadow"
                        style={isEditing
                          ? { background: 'var(--color-surface-hover)', borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)', boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent) 12%, transparent), 0 16px 40px -28px color-mix(in srgb, var(--color-bg-sunken) 70%, transparent)' }
                          : { background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', boxShadow: '0 12px 32px -28px color-mix(in srgb, var(--color-bg-sunken) 70%, transparent)' }}>

                        {/* Header: Platform + Format + Edit/Save buttons */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${pc.badge}`}>
                            {getPlatformIcon(isEditing ? editDraft.platform : piece.platform)} {isEditing ? editDraft.platform : piece.platform}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-1 rounded-lg"
                            style={{ color: 'var(--color-fg-subtle)', background: 'color-mix(in srgb, var(--color-fg) 4%, transparent)' }}>
                            {isEditing ? editDraft.format : piece.format}
                          </span>
                          {piece.pillar && !isEditing && (
                            <span className="text-[10px] font-medium px-2 py-1 rounded-lg"
                              style={{ color: 'var(--color-info)', background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}>{piece.pillar}</span>
                          )}

                          <div className="ms-auto flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
                              style={{
                                color: v.status === 'good' ? 'var(--color-success)' : v.status === 'warning' ? 'var(--color-warning)' : 'var(--color-danger)',
                                background: v.status === 'good' ? 'var(--color-success-subtle)' : v.status === 'warning' ? 'var(--color-warning-subtle)' : 'var(--color-danger-subtle)',
                              }}>{v.length}/{v.max}</span>

                            {isEditing ? (
                              <>
                                {saveStatus === 'saved' && (
                                  <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-success)' }}><Check className="w-3 h-3" /> Saved</span>
                                )}
                                <button onClick={saveEdit} disabled={saving}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold border disabled:opacity-50 cursor-pointer transition-colors"
                                  style={{ color: 'var(--color-success)', background: 'var(--color-success-subtle)', borderColor: 'color-mix(in srgb, var(--color-success) 24%, transparent)' }}>
                                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                                </button>
                                <button onClick={cancelEdit}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold border cursor-pointer transition-colors"
                                  style={{ color: 'var(--color-fg-muted)', background: 'color-mix(in srgb, var(--color-fg) 6%, transparent)', borderColor: 'var(--color-border)' }}>
                                  <X className="w-3 h-3" /> Cancel
                                </button>
                              </>
                            ) : (
                              piece.id && (
                                <button onClick={() => startEdit(piece)}
                                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-bold border cursor-pointer transition-colors"
                                  style={{ color: 'var(--color-fg-muted)', background: 'var(--color-surface-hover)', borderColor: 'var(--color-border)' }}>
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
                                <label htmlFor={`cal-edit-title-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Title</label>
                                <input id={`cal-edit-title-${piece.id}`} value={editDraft.title} onChange={e => updateDraftField('title', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                              </div>
                              {/* Pillar */}
                              <div>
                                <label htmlFor={`cal-edit-pillar-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Pillar</label>
                                <input id={`cal-edit-pillar-${piece.id}`} value={editDraft.pillar} onChange={e => updateDraftField('pillar', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                              </div>
                              {/* Platform */}
                              <div>
                                <label htmlFor={`cal-edit-platform-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Platform</label>
                                <select id={`cal-edit-platform-${piece.id}`} value={editDraft.platform} onChange={e => updateDraftField('platform', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5">
                                  {['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </div>
                              {/* Format */}
                              <div>
                                <label htmlFor={`cal-edit-format-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Format</label>
                                <input id={`cal-edit-format-${piece.id}`} value={editDraft.format} onChange={e => updateDraftField('format', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                              </div>
                              {/* Status */}
                              <div>
                                <label htmlFor={`cal-edit-status-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Status</label>
                                <select id={`cal-edit-status-${piece.id}`} value={editDraft.status} onChange={e => updateDraftField('status', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5">
                                  {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s as keyof typeof STATUS_LABEL]}</option>)}
                                </select>
                              </div>
                              {/* Timing */}
                              <div>
                                <label htmlFor={`cal-edit-timing-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Timing</label>
                                <input id={`cal-edit-timing-${piece.id}`} value={editDraft.timing} onChange={e => updateDraftField('timing', e.target.value)}
                                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                              </div>
                            </div>

                            {/* Hook */}
                            <div>
                              <label htmlFor={`cal-edit-hook-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Hook</label>
                              <input id={`cal-edit-hook-${piece.id}`} value={editDraft.hook} onChange={e => updateDraftField('hook', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                            </div>

                            {/* Key Message */}
                            <div>
                              <label htmlFor={`cal-edit-keyMessage-${piece.id}`} className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Key Message (on visual)</label>
                              <textarea id={`cal-edit-keyMessage-${piece.id}`} value={editDraft.keyMessage} onChange={e => updateDraftField('keyMessage', e.target.value)} rows={2}
                                className="w-full bg-zinc-900 border border-amber-500/20 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 resize-y mt-0.5" />
                            </div>

                            {/* Caption */}
                            <div>
                              <label htmlFor={`cal-edit-caption-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Caption</label>
                              <textarea id={`cal-edit-caption-${piece.id}`} value={editDraft.caption} onChange={e => updateDraftField('caption', e.target.value)} rows={4}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 resize-y mt-0.5" />
                            </div>

                            {/* CTA */}
                            <div>
                              <label htmlFor={`cal-edit-cta-${piece.id}`} className="text-[9px] text-emerald-400/60 uppercase tracking-wider font-semibold">CTA</label>
                              <input id={`cal-edit-cta-${piece.id}`} value={editDraft.cta} onChange={e => updateDraftField('cta', e.target.value)}
                                className="w-full bg-zinc-900 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 text-xs text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 mt-0.5" />
                            </div>

                            {/* Hashtags */}
                            <div>
                              <label htmlFor={`cal-edit-hashtags-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Hashtags (comma-separated)</label>
                              <input id={`cal-edit-hashtags-${piece.id}`} value={editDraft.hashtags} onChange={e => updateDraftField('hashtags', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5"
                                placeholder="tag1, tag2, tag3" />
                            </div>

                            {/* Visual Direction */}
                            <div>
                              <label htmlFor={`cal-edit-visualDirection-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Visual Direction</label>
                              <textarea id={`cal-edit-visualDirection-${piece.id}`} value={editDraft.visualDirection} onChange={e => updateDraftField('visualDirection', e.target.value)} rows={2}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 resize-y mt-0.5" />
                            </div>

                            {/* Reference Query */}
                            <div>
                              <label htmlFor={`cal-edit-referenceQuery-${piece.id}`} className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Reference Query</label>
                              <input id={`cal-edit-referenceQuery-${piece.id}`} value={editDraft.referenceQuery} onChange={e => updateDraftField('referenceQuery', e.target.value)}
                                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 mt-0.5" />
                            </div>
                          </div>
                        ) : (
                          /* ─── Read-only view ────────────────────────────── */
                          <>
                            {/* Title */}
                            {piece.title && (
                              <h4 className="text-sm font-bold" style={{ color: 'var(--color-fg)' }}>{piece.title}</h4>
                            )}

                            {/* Hook */}
                            {piece.hook && (
                              <p className="text-xs italic" style={{ color: 'color-mix(in srgb, var(--color-accent) 85%, var(--color-fg))' }}>"{piece.hook}"</p>
                            )}

                            {/* Art Direction */}
                            {(piece.creativeCopy || piece.visualDirection) && (
                              <div>
                                <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-fg-subtle)' }}>Art Direction</h4>
                                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>{piece.visualDirection || piece.creativeCopy}</p>
                              </div>
                            )}

                            {/* Copy Section */}
                            <div className="space-y-2 rounded-lg p-3 border"
                              style={{ background: 'var(--color-bg-sunken)', borderColor: 'var(--color-border-subtle)' }}>
                              <h4 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>Copy</h4>

                              {piece.keyMessage && (
                                <div>
                                  <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-accent)' }}>Key Message (on visual)</span>
                                  <p className="text-sm font-medium rounded-lg px-2 py-1.5 border mt-0.5"
                                    style={{ color: 'color-mix(in srgb, var(--color-accent) 80%, var(--color-fg))', background: 'var(--color-accent-subtle)', borderColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>{piece.keyMessage}</p>
                                </div>
                              )}

                              <div>
                                <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Caption</span>
                                <p className="text-sm p-2 rounded-lg border whitespace-pre-wrap leading-relaxed mt-0.5"
                                  style={{ color: 'var(--color-fg)', background: 'color-mix(in srgb, var(--color-fg) 3%, transparent)', borderColor: 'var(--color-border-subtle)' }}>{piece.caption}</p>
                              </div>

                              {piece.cta && (
                                <div>
                                  <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-success)' }}>CTA</span>
                                  <p className="text-sm font-medium rounded-lg px-2 py-1.5 border mt-0.5"
                                    style={{ color: 'var(--color-success)', background: 'var(--color-success-subtle)', borderColor: 'color-mix(in srgb, var(--color-success) 18%, transparent)' }}>{piece.cta}</p>
                                </div>
                              )}

                              {piece.hashtags?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {piece.hashtags.map((h: string, j: number) => (
                                    <span key={j} className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ color: 'var(--color-info)', background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}>#{h.replace(/^#/, '')}</span>
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
                              <p className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>Timing: {piece.timing}</p>
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
              className="rounded-2xl border p-8 text-center"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}>
              <p className="text-sm" style={{ color: 'var(--color-fg-subtle)' }}>No content scheduled for {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay}</p>
            </motion.div>
          )}
        </>
      )}

      {/* Previous Months — RadixDialog gives focus trap + Esc + return focus.
          Custom right-side positioning instead of the centered helper. */}
      <RadixDialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-drawer bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <RadixDialog.Content
            className="fixed right-0 top-0 z-drawer h-full w-full max-w-md bg-[#0a0a0a] border-l border-white/10 flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
          >
            <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" aria-hidden="true" />
                <RadixDialog.Title className="text-base font-bold text-white">Previous Months</RadixDialog.Title>
              </div>
              <RadixDialog.Description className="sr-only">
                Archived calendar months. Restore any month back to the active calendar, or permanently delete it.
              </RadixDialog.Description>
              <RadixDialog.Close
                aria-label="Close previous months"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/[0.06] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <X className="w-4 h-4" />
              </RadixDialog.Close>
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
                          <span aria-live="polite" aria-atomic="true" className="flex items-center gap-1.5">
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
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      {/* Archive confirm — Dialog primitive (focus trap, Esc, return-focus). */}
      <Dialog.Root open={showArchiveConfirm && !!backendMonth} onOpenChange={setShowArchiveConfirm}>
        {showArchiveConfirm && backendMonth && (
          <Dialog.Content
            title={`Archive ${backendMonth.month}?`}
            description={currentClient?.name || 'this client'}
            width={480}
          >
            <div className="space-y-3">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>
                This moves the month to <span className="text-amber-300 font-semibold">Previous Months</span>. Posts are preserved and can be restored anytime from the history drawer.
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-fg-subtle)' }}>
                To delete permanently, open Previous Months and use "Delete permanently" there.
              </p>
            </div>
            <Dialog.Footer>
              <Dialog.Close asChild>
                {/* autoFocus on Cancel — never the destructive action (A11Y-5). */}
                <button
                  type="button"
                  autoFocus
                  className="px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm font-semibold text-zinc-300 hover:bg-white/[0.08] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={confirmArchive}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
              >
                <Archive className="w-4 h-4" />
                Archive
              </button>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog.Root>
    </div>
  );
}
