import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  Instagram,
  Linkedin,
  Facebook,
  Hash,
  SlidersHorizontal,
  FileText,
  Megaphone,
  CalendarHeart,
  MonitorPlay,
  Loader2,
  CheckCircle2,
  X,
  Zap,
} from 'lucide-react';
import { useStore, type ContentBrief } from '../lib/store';
import { useClients } from '../lib/client-context';
import { briefsApi, calendarApi, jobsApi } from '../lib/backend-api';
import { motionUI } from '../lib/motion';
import { InlineAITextHost, AIRewriteDialog, useAIRewrite } from '../components/ui';
import {
  DEFAULT_CAMPAIGNS,
  DEFAULT_OCCASIONS,
} from '../lib/clients';
import { PLATFORM_LIMITS } from '../lib/platform-limits';

// ─── Platform config ───────────────────────────────────────────────
interface PlatformOption {
  id: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  maxCaption: number;
}

const PLATFORMS: PlatformOption[] = [
  { id: 'Instagram', label: 'Instagram', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/30', maxCaption: 2200 },
  { id: 'TikTok', label: 'TikTok', color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/30', maxCaption: 4000 },
  { id: 'LinkedIn', label: 'LinkedIn', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', maxCaption: 3000 },
  { id: 'X', label: 'X (Twitter)', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30', maxCaption: 280 },
  { id: 'Facebook', label: 'Facebook', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', maxCaption: 63206 },
];

// ─── Icon map for platforms ────────────────────────────────────────
function PlatformIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'Instagram': return <Instagram className={className} />;
    case 'LinkedIn': return <Linkedin className={className} />;
    case 'Facebook': return <Facebook className={className} />;
    case 'TikTok': return <MonitorPlay className={className} />;
    case 'X': return <Hash className={className} />;
    default: return <Hash className={className} />;
  }
}

// ─── Month options ─────────────────────────────────────────────────
function buildMonthOptions(): { label: string; value: string }[] {
  const months: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ label, value });
  }
  return months;
}

// ─── Campaign type ─────────────────────────────────────────────────
interface CampaignEntry {
  name: string;
  targetAudience: string;
  productFocus: string;
  objective: string;
  keyMessage: string;
}

// ─── Occasion type ─────────────────────────────────────────────────
interface OccasionEntry {
  name: string;
  date: string;
  enabled: boolean;
}

// ─── In-flight generation persistence ──────────────────────────────
// The calendar generation runs as a server-side job; if the user refreshes
// mid-run we'd lose the jobId and the "generating" UI even though the job is
// still going. Stashing it lets the page reconnect on reload.
const ACTIVE_JOB_KEY = 'radix.activeJob.calendar';
interface ActiveJob { jobId: string; clientId: string; month: string; count?: number; startedAt?: number }
function saveActiveJob(j: ActiveJob) { try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(j)); } catch { /* noop */ } }
function clearActiveJob() { try { localStorage.removeItem(ACTIVE_JOB_KEY); } catch { /* noop */ } }
function readActiveJob(): ActiveJob | null {
  try { const r = localStorage.getItem(ACTIVE_JOB_KEY); return r ? (JSON.parse(r) as ActiveJob) : null; } catch { return null; }
}

// ─── Job polling ───────────────────────────────────────────────────
// The server ends every run within ~8 min (AI budget + saving), so 15 min of
// wall clock is a generous ceiling. Wall clock, not poll count: iOS freezes
// timers while the screen is locked.
const POLL_MS = 5000;
const MAX_WAIT_MS = 15 * 60 * 1000;
// Consecutive failed status checks tolerated (~2 min) before giving up.
const MAX_POLL_FAILURES = 24;
const CANCELLED = 'Cancelled';
const LOST_CONNECTION = 'Lost connection while checking on your content. It is still being made on the server: refresh this page to reconnect, or open Review in a few minutes.';

// One dropped status check used to end the whole run with "Failed to fetch"
// (Safari: "Load failed") while the job finished fine on the server: the posts
// were saved but the page never took you to them. A network-level failure has
// no statusCode; a server restart shows up as 502/503/504. Neither says
// anything about the job, so keep checking.
function isTransientPollError(err: any): boolean {
  const code = err?.statusCode;
  if (typeof code !== 'number') return true;
  return code === 408 || code === 429 || code >= 500;
}

function stageLabel(progress: number): string {
  if (progress < 20) return 'Reading your brief';
  if (progress < 70) return 'Writing your posts';
  if (progress < 88) return 'Saving your posts';
  if (progress < 100) return 'Finding visual references';
  return 'Done';
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function BriefInput() {
  const navigate = useNavigate();
  const { addContentBrief, updateContentBrief } = useStore();
  const { clients: backendClients, selectedClientId: contextClientId, setSelectedClientId: setContextClientId, currentClient } = useClients();
  // Map backend clients to the shape BriefInput expects. Memoized so the
  // array reference is stable across renders — without this, every
  // downstream useCallback/useMemo that depends on `clients` re-creates
  // each tick, which is the most plausible root cause of the workshop
  // 2026-05-06 Chrome crash Drishti reported on "first use" of the
  // briefing calendar template (#5).
  const clients = useMemo(
    () => backendClients.map(c => ({ id: c.id, name: c.name, industry: c.industry || '', ...c })),
    [backendClients],
  );
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  // ─── Form state ──────────────────────────────────────────────────
  // Local selectedClientId is purely a mirror of the global context.
  // Use the context value directly as the source of truth.
  const selectedClientId = contextClientId || clients[0]?.id || '';
  // Setter pushes back to the global context so other pages stay in sync.
  const setSelectedClientId = (id: string) => {
    if (id) setContextClientId(id);
  };
  // Empty campaign template — start fresh for new clients, populate from
  // saved brief in the per-client useEffect below. Previously initialized
  // with DEFAULT_CAMPAIGNS (Al Fardan) which leaked across clients.
  const blankCampaign = (): CampaignEntry => ({
    name: '', targetAudience: '', productFocus: '', objective: '', keyMessage: '',
  });
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value || '');
  const [campaigns, setCampaigns] = useState<CampaignEntry[]>([blankCampaign()]);
  // Default OFF — users must opt-in to any occasion. Pre-selecting all of them
  // led to bloated calendars where every culture's holidays were force-fed into
  // every brand. The saved-brief restoration below still respects prior picks.
  const [occasions, setOccasions] = useState<OccasionEntry[]>(
    DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: false }))
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Instagram', 'TikTok', 'LinkedIn']);
  const [pieceCount, setPieceCount] = useState(18);
  const [toneNotes, setToneNotes] = useState('');
  const [lookFeel, setLookFeel] = useState(''); // B4: visual look & feel direction
  // AI rewrite flow: useAIRewrite drives a state machine; AIRewriteDialog
  // mounts the DiffView for accept/reject. No more toast-as-Apply hack.
  const aiRewrite = useAIRewrite();
  const [isGenerating, setIsGenerating] = useState(false);
  const cancelledRef = useRef(false);
  const [generationProgress, setGenerationProgress] = useState('');
  const [jobProgress, setJobProgress] = useState(0);
  // Piece count of the run in flight (after a refresh the slider resets to 18).
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  // Resolves the current between-polls wait early (tab back in view / Stop).
  const wakeRef = useRef<(() => void) | null>(null);
  const [customOccasionName, setCustomOccasionName] = useState('');
  const [customOccasionDate, setCustomOccasionDate] = useState('');
  const [conflict, setConflict] = useState<{ month: string; clientId: string } | null>(null);
  const [conflictAction, setConflictAction] = useState<'idle' | 'deleting' | 'regenerating'>('idle');
  // Brief-per-month (2026-07-14): when this month has no dedicated brief we
  // start BLANK (so a new month is an independent plan, not an inherited one)
  // and offer to copy the most recent brief on demand.
  const [copyableBrief, setCopyableBrief] = useState<{ month: string; brief: any } | null>(null);

  // ─── Handlers ────────────────────────────────────────────────────

  const handleClientChange = useCallback((id: string) => {
    setSelectedClientId(id);
    // Form repopulation happens in the useEffect that watches selectedClientId
  }, []);

  // Load saved brief for the selected client. Resets the form on every client
  // switch so leftover state from another client (e.g. Al Fardan campaigns)
  // doesn't bleed into a fresh client like GE Healthcare.
  // Apply a saved brief object into the form (reused by month-load + "copy
  // last month"). Pure setter — no fetch.
  const hydrateFromBrief = useCallback((brief: any) => {
    const blankAll = () => {
      setCampaigns([blankCampaign()]);
      setOccasions(DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: false })));
      setSelectedPlatforms(['Instagram', 'TikTok', 'LinkedIn']);
      setToneNotes('');
      setLookFeel('');
    };
    if (!brief) { blankAll(); return; }
    const savedCampaigns: any[] = Array.isArray(brief.campaigns) ? brief.campaigns : [];
    if (savedCampaigns.length > 0) {
      setCampaigns(savedCampaigns.map((c) => ({
        name: c.name || '', productFocus: c.productFocus || '', targetAudience: c.targetAudience || '',
        objective: c.objective || '', keyMessage: c.keyMessage || '',
      })));
    } else {
      const pillars: string[] = Array.isArray(brief.pillars) ? brief.pillars : [];
      const products: string[] = Array.isArray(brief.products) ? brief.products : [];
      setCampaigns(pillars.length > 0
        ? pillars.map((name, i) => ({ name, productFocus: products[i] || '', targetAudience: brief.audience || '', objective: brief.objective || '', keyMessage: brief.objective || '' }))
        : [blankCampaign()]);
    }
    if (Array.isArray(brief.campaignMoments) && brief.campaignMoments.length > 0) {
      const savedNames = new Set(brief.campaignMoments.map((m: any) => m.name));
      setOccasions(DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: savedNames.has(o.name) })));
    } else {
      setOccasions(DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: false })));
    }
    setSelectedPlatforms(Array.isArray(brief.channels) && brief.channels.length > 0 ? brief.channels : ['Instagram', 'TikTok', 'LinkedIn']);
    setToneNotes(typeof brief.tone === 'string' && brief.tone !== 'Professional' ? brief.tone : '');
    setLookFeel(typeof brief.visualLookFeel === 'string' ? brief.visualLookFeel : '');
  }, []);

  // Brief-per-month: load THIS (client, month)'s brief. Draft (unsaved edits)
  // for this exact client+month wins; else the dedicated brief for this month;
  // else BLANK — a new month starts as an independent plan, never inheriting an
  // earlier month's campaigns (Habiba's fix). If another month has a brief we
  // stash it so the user can explicitly "copy last month".
  useEffect(() => {
    if (!selectedClientId || !selectedMonth) return;
    let cancelled = false;
    const draftKey = `radix.draft.bi.${selectedClientId}.${selectedMonth}`;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        const hasContent = Array.isArray(d?.campaigns) && d.campaigns.some((c: any) => c?.name?.trim());
        if (hasContent) {
          setCampaigns(d.campaigns);
          if (Array.isArray(d.occasions)) setOccasions(d.occasions);
          if (Array.isArray(d.selectedPlatforms)) setSelectedPlatforms(d.selectedPlatforms);
          if (typeof d.toneNotes === 'string') setToneNotes(d.toneNotes);
          if (typeof d.lookFeel === 'string') setLookFeel(d.lookFeel);
          setCopyableBrief(null);
          return;
        }
      }
    } catch { /* corrupt draft. Fall through */ }
    (async () => {
      try {
        const all = await briefsApi.list(selectedClientId).catch(() => [] as any[]);
        if (cancelled) return;
        const exact = Array.isArray(all) ? all.find((b: any) => (b.month || '') === selectedMonth) : null;
        // legacy default brief (month='') counts as this month's brief only when
        // the client has no dedicated per-month briefs yet (back-compat: existing
        // single-brief clients keep seeing their brief).
        const legacyDefault = Array.isArray(all) ? all.find((b: any) => (b.month || '') === '') : null;
        const onlyLegacy = Array.isArray(all) && all.length > 0 && all.every((b: any) => (b.month || '') === '');
        if (exact) {
          hydrateFromBrief(exact);
          setCopyableBrief(null);
        } else if (onlyLegacy && legacyDefault) {
          hydrateFromBrief(legacyDefault);
          setCopyableBrief(null);
        } else {
          // new independent month → blank, offer to copy the most recent brief
          hydrateFromBrief(null);
          const others = (all || []).filter((b: any) => (b.month || '') !== selectedMonth);
          setCopyableBrief(others.length ? { month: others[0].month || 'previous', brief: others[0] } : null);
        }
      } catch {
        hydrateFromBrief(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedClientId, selectedMonth, hydrateFromBrief]);

  // Persist the in-progress form per (client, month) so switching tab/month/
  // refresh never wipes typed campaigns AND a draft for one month never bleeds
  // into another (A2 fix, now month-scoped).
  useEffect(() => {
    if (!selectedClientId || !selectedMonth) return;
    const draftKey = `radix.draft.bi.${selectedClientId}.${selectedMonth}`;
    const t = setTimeout(() => {
      try {
        const hasContent = campaigns.some(c => c.name.trim()) || toneNotes.trim().length > 0 || lookFeel.trim().length > 0;
        if (hasContent) {
          localStorage.setItem(draftKey, JSON.stringify({ campaigns, occasions, selectedPlatforms, toneNotes, selectedMonth, lookFeel }));
        } else {
          localStorage.removeItem(draftKey);
        }
      } catch { /* storage unavailable. In-memory only */ }
    }, 400);
    return () => clearTimeout(t);
  }, [selectedClientId, selectedMonth, campaigns, occasions, selectedPlatforms, toneNotes, lookFeel]);

  const updateCampaign = useCallback((index: number, field: keyof CampaignEntry, value: string) => {
    setCampaigns(prev => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }, []);

  const removeCampaign = useCallback((index: number) => {
    setCampaigns(prev => prev.filter((_, i) => i !== index));
  }, []);

  const addCampaign = useCallback(() => {
    setCampaigns(prev => [
      ...prev,
      { name: '', targetAudience: '', productFocus: '', objective: '', keyMessage: '' },
    ]);
  }, []);

  const toggleOccasion = useCallback((index: number) => {
    setOccasions(prev => prev.map((o, i) => (i === index ? { ...o, enabled: !o.enabled } : o)));
  }, []);

  const addCustomOccasion = useCallback(() => {
    if (!customOccasionName.trim()) return;
    setOccasions(prev => [...prev, { name: customOccasionName.trim(), date: customOccasionDate.trim() || 'TBD', enabled: true }]);
    setCustomOccasionName('');
    setCustomOccasionDate('');
  }, [customOccasionName, customOccasionDate]);

  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  // ─── Cancel Generation ───────────────────────────────────────────

  // Stop = stop the SERVER run too. It used to only stop this page polling: the
  // job kept going, and the next Generate click was deduped straight back onto
  // it (same stuck progress, timer restarting: "it keeps looping").
  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    const jobId = activeJobIdRef.current;
    if (jobId) jobsApi.cancel(jobId).catch(() => { /* best-effort: the server's time budget still ends it */ });
    activeJobIdRef.current = null;
    clearActiveJob();
    wakeRef.current?.();
    setIsGenerating(false);
    setGenerationProgress('');
    setJobProgress(0);
  }, []);

  // Wake the between-polls wait when the tab comes back into view, so a phone
  // unlocked mid-run shows fresh status at once instead of after a stale timer.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') wakeRef.current?.(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const report = useCallback((progress: number, msg: string) => {
    setJobProgress(progress);
    setGenerationProgress(msg);
  }, []);

  // ─── Shared generate + poll helper ──────────────────────────────

  // Poll a server-side generation job to completion. Extracted so a page
  // refresh mid-generation can RESUME the same job (see the mount effect below)
  // instead of stranding the user — the job keeps running on the server, we just
  // reconnect to it.
  const pollJob = useCallback(async (
    jobId: string,
    clientId: string,
    month: string,
    startedAt: number,
    onProgress?: (progress: number, msg: string) => void,
  ): Promise<void> => {
    let failures = 0;
    let progress = 0;
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      if (cancelledRef.current) throw new Error(CANCELLED);
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(t); wakeRef.current = null; resolve(); };
        const t = setTimeout(done, POLL_MS);
        wakeRef.current = done;
      });
      if (cancelledRef.current) throw new Error(CANCELLED);

      let job;
      try {
        job = await jobsApi.get(jobId);
        failures = 0;
      } catch (err) {
        if (!isTransientPollError(err)) throw err;
        if (++failures >= MAX_POLL_FAILURES) throw new Error(LOST_CONNECTION);
        onProgress?.(progress, `Reconnecting… ${fmtElapsed(Date.now() - startedAt)}`);
        continue;
      }
      progress = job.progress;
      onProgress?.(progress, `${stageLabel(progress)}… ${progress}% · ${fmtElapsed(Date.now() - startedAt)}`);

      if (job.status === 'completed') {
        onProgress?.(100, 'Done!');
        clearActiveJob();
        activeJobIdRef.current = null;
        // Route to Review (not Calendar) so user sees generated content + visual references first
        navigate(`/content-review?client=${clientId}&month=${encodeURIComponent(month)}`);
        return;
      }
      if (job.status === 'failed') {
        clearActiveJob();
        activeJobIdRef.current = null;
        throw new Error(job.error || 'Generation failed on server');
      }
    }
    clearActiveJob();
    activeJobIdRef.current = null;
    throw new Error('Generation timed out after 15 minutes');
  }, [navigate]);

  const generateAndPoll = useCallback(async (
    clientId: string,
    month: string,
    count: number,
    onProgress?: (progress: number, msg: string) => void,
  ): Promise<void> => {
    onProgress?.(0, 'Starting…');
    const startedAt = Date.now();
    const { jobId } = await calendarApi.generate(clientId, month, count);
    activeJobIdRef.current = jobId;
    // Persist the in-flight job so a refresh can reconnect to it.
    saveActiveJob({ jobId, clientId, month, count, startedAt });
    await pollJob(jobId, clientId, month, startedAt, onProgress);
  }, [pollJob]);

  // Resume an in-flight generation after a page refresh: the server job is
  // still running, so reconnect to it instead of losing the "generating" state.
  useEffect(() => {
    const active = readActiveJob();
    if (!active?.jobId) return;
    cancelledRef.current = false;
    activeJobIdRef.current = active.jobId;
    setActiveCount(active.count ?? null);
    setIsGenerating(true);
    report(0, 'Reconnecting to your generation…');
    pollJob(active.jobId, active.clientId, active.month, active.startedAt ?? Date.now(), report)
      .catch((err: any) => {
        setIsGenerating(false);
        report(0, '');
        const msg = err?.message || '';
        if (msg === CANCELLED) return;
        // Keep the record on a lost connection so the next refresh reconnects.
        if (msg !== LOST_CONNECTION) clearActiveJob();
        // 404: the job finished long ago and expired from the queue. Nothing to say.
        if (err?.statusCode === 404) return;
        // Used to be swallowed: the overlay just vanished and the run looked
        // like it never happened, so people clicked Generate again.
        alert(`Generate content failed: ${msg}`);
      });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Generate ────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    cancelledRef.current = false;
    if (!selectedClientId) return;
    if (selectedPlatforms.length === 0) return;
    if (campaigns.filter(c => c.name.trim()).length === 0) return;

    setIsGenerating(true);
    setActiveCount(pieceCount);
    const monthLabel = monthOptions.find(m => m.value === selectedMonth)?.label || selectedMonth;
    let step: 'save_brief' | 'generate' = 'save_brief';

    try {
      // 1. Save brief to backend
      report(0, 'Saving brief…');
      const enabledOccasions = occasions.filter(o => o.enabled).map(({ name, date }) => ({ name, date }));
      const validCampaigns = campaigns.filter(c => c.name.trim()).map(c => ({ ...c, duration: 'Monthly' }));

      await briefsApi.save(selectedClientId, {
        // Scalar objective/audience kept for back-compat + display only; the
        // generator now reads the full per-campaign array below (fixes the bug
        // where every campaign collapsed to campaign #1).
        objective: validCampaigns[0]?.keyMessage || 'Content generation',
        audience: validCampaigns[0]?.targetAudience || 'General audience',
        tone: toneNotes || 'Professional',
        visualLookFeel: lookFeel.trim() || undefined,
        brandDo: 'Follow brand guidelines',
        brandDont: 'No misleading claims',
        products: validCampaigns.map(c => c.productFocus).filter(Boolean),
        pillars: validCampaigns.map(c => c.name).filter(Boolean),
        // Full per-campaign data — each with its OWN audience/objective/keyMessage.
        campaigns: validCampaigns.map(c => ({
          name: c.name,
          targetAudience: c.targetAudience,
          objective: c.objective,
          keyMessage: c.keyMessage,
          productFocus: c.productFocus,
        })),
        campaignMoments: enabledOccasions,
        channels: selectedPlatforms,
        approvers: [],
      }, selectedMonth); // brief-per-month: save under THIS month
      // Brief is now persisted server-side under this month — drop the local
      // (client, month) draft so future loads hydrate from the saved brief.
      try { localStorage.removeItem(`radix.draft.bi.${selectedClientId}.${selectedMonth}`); } catch { /* noop */ }

      // 2. Generate + poll (shared helper)
      step = 'generate';
      await generateAndPoll(selectedClientId, monthLabel, pieceCount, report);
      setIsGenerating(false);
    } catch (err: any) {
      report(0, '');
      setIsGenerating(false);
      const msg = err.message || '';
      // The user pressed Stop: not an error, don't alert.
      if (msg === CANCELLED) return;
      console.error(`Generation failed at step="${step}":`, err);
      const stepLabel = step === 'save_brief' ? 'Save brief' : 'Generate content';

      if (msg === LOST_CONNECTION) {
        alert(msg);
      } else if (msg.includes('timed out') || msg.includes('timeout')) {
        alert(`${stepLabel} is taking longer than expected. Check the calendar in a few minutes. The server may still be processing.`);
      } else if (msg.includes('401') || msg.includes('Unauthorized')) {
        alert(`${stepLabel} failed: session expired. Please refresh the page and try again.`);
      } else if (msg.includes('409') || msg.includes('already exists')) {
        setConflict({ month: monthLabel, clientId: selectedClientId });
        setConflictAction('idle');
      } else if (msg.includes('422') || msg.includes('completeness')) {
        alert(`${stepLabel} blocked: brief is incomplete. ${msg}`);
      } else {
        alert(`${stepLabel} failed: ${msg}`);
      }
    }
  }, [selectedClientId, selectedMonth, campaigns, occasions, selectedPlatforms, pieceCount, toneNotes, lookFeel, monthOptions, generateAndPoll, report]);

  // ─── Conflict handlers ──────────────────────────────────────────

  const handleOpenExisting = () => {
    if (!conflict) return;
    setConflict(null);
    navigate(`/calendar?client=${conflict.clientId}&month=${encodeURIComponent(conflict.month)}`);
  };

  const handleDeleteAndRegenerate = async () => {
    if (!conflict) return;
    const { month, clientId } = conflict;
    try {
      setConflictAction('deleting');
      try {
        // Hard-delete (not archive) — the unique constraint @@unique([clientId, month])
        // would block regeneration if we left a soft-archived row in place.
        await calendarApi.hardDeleteMonth(clientId, month);
      } catch (delErr: any) {
        console.error('Delete step failed:', delErr);
        throw new Error(`Delete failed: ${delErr.message}`);
      }
      setConflictAction('regenerating');
      cancelledRef.current = false;
      // Progress shown in conflict modal
      await generateAndPoll(clientId, month, pieceCount, report);
      setConflict(null);
      setConflictAction('idle');
    } catch (err: any) {
      setConflictAction('idle');
      setConflict(null);
      if (err?.message === CANCELLED) return;
      console.error('Delete and regenerate failed:', err);
      alert(err.message);
    }
  };

  const handleChooseAnother = () => {
    setConflict(null);
    setConflictAction('idle');
  };

  // ─── Render helpers ──────────────────────────────────────────────

  const selectedMonthLabel = monthOptions.find(m => m.value === selectedMonth)?.label || '';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // JSX
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Loading overlay */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-[#111] p-10 shadow-2xl"
            >
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-violet-500" />
                <div className="absolute inset-0 h-12 w-12 animate-ping rounded-full bg-violet-500/20" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-white">
                  Generating {activeCount ?? pieceCount} content pieces...
                </p>
                <p className="mt-2 text-sm text-zinc-400" aria-live="polite">{generationProgress}</p>
                <p className="mt-1 text-xs text-zinc-500">Usually 1 to 4 minutes. You can lock your phone; we'll pick up where we left off.</p>
              </div>
              {/* Real job progress. It used to animate to 85% in 30s no matter
                  what, then sit there while the text said 40%. */}
              <div className="h-1.5 w-64 overflow-hidden rounded-full bg-zinc-800">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  initial={{ width: '5%' }}
                  animate={{ width: `${Math.max(5, Math.min(100, jobProgress))}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
              <button
                onClick={handleCancel}
                className="mt-2 flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-medium transition-all cursor-pointer"
                style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}
              >
                Stop Generation
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conflict modal — month already exists */}
      <AnimatePresence>
        {conflict && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-8 shadow-2xl"
            >
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--color-accent-subtle)' }}>
                  <CalendarHeart className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
                </div>
                <h3 className="text-lg font-bold text-white">{conflict.month} already exists</h3>
                <p className="mt-2 text-sm text-zinc-400">
                  This month already has generated content. What would you like to do?
                </p>
              </div>

              {conflictAction !== 'idle' ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                  <p className="text-sm text-zinc-300">
                    {conflictAction === 'deleting' ? 'Deleting old content...' : 'Regenerating fresh content...'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={handleOpenExisting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-300 transition hover:bg-violet-500/20"
                  >
                    <CalendarHeart className="h-4 w-4" /> Open Existing Month
                  </button>
                  <button
                    onClick={handleDeleteAndRegenerate}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition"
                    style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}
                  >
                    <Sparkles className="h-4 w-4" /> Delete and Regenerate
                  </button>
                  <button
                    onClick={handleChooseAnother}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" /> Choose Another Month
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>New Brief</p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
                Create Content Brief
              </h1>
            </div>
          </div>
          <div className="mt-2 pl-[52px] flex items-center gap-3">
            <p className="text-sm text-zinc-500">
              Brief for
            </p>
            {currentClient ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 px-3 py-1 text-sm font-semibold text-violet-300">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                {currentClient.name}
              </span>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-accent)' }}>no client selected. Pick one on /clients first</span>
            )}
          </div>
        </motion.div>

        <div className="space-y-8">
          {/* ─── Row: Client + Month ──────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.05 }}
            className="grid gap-6 sm:grid-cols-2"
          >
            {/* Client selector */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Client
              </label>
              <div className="relative">
                <select
                  value={selectedClientId}
                  onChange={e => handleClientChange(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-[#111] px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                >
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>

            {/* Month selector */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Month
              </label>
              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-[#111] px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                >
                  {monthOptions.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              </div>
              {/* Brief-per-month: this month starts blank; one-click copy the
                  most recent brief as a starting point (explicit, not automatic). */}
              {copyableBrief && (
                <button
                  type="button"
                  onClick={() => { hydrateFromBrief(copyableBrief.brief); setCopyableBrief(null); }}
                  className="mt-2 text-xs text-violet-300 hover:text-violet-200 underline underline-offset-2"
                >
                  This is a fresh plan for this month. Copy {copyableBrief.month}'s brief as a starting point?
                </button>
              )}
            </div>
          </motion.div>

          {/* ─── Campaigns ────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.1 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Campaigns ({campaigns.length})
                </h2>
              </div>
              <button
                onClick={addCampaign}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-violet-500/30 hover:bg-violet-500/10 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Campaign
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {campaigns.map((campaign, idx) => (
                  <motion.div
                    key={idx}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative rounded-xl border border-violet-500/20 bg-[#111] p-4"
                  >
                    <div className="absolute left-0 top-0 h-full w-0.5 rounded-full bg-gradient-to-b from-violet-500 to-fuchsia-500" />

                    {campaigns.length > 1 && (
                      <button
                        onClick={() => removeCampaign(idx)}
                        className="absolute right-3 top-3 rounded-md p-1 text-zinc-600 opacity-0 transition hover:bg-white/5 hover:text-white group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <div className="space-y-3">
                      <input
                        value={campaign.name}
                        onChange={e => updateCampaign(idx, 'name', e.target.value)}
                        placeholder={t('page.brief.ph_campaign_name')}
                        className="w-full border-b border-white/10 bg-transparent pb-2 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                            Audience
                          </label>
                          <input
                            value={campaign.targetAudience}
                            onChange={e => updateCampaign(idx, 'targetAudience', e.target.value)}
                            placeholder={t('page.brief.ph_audience')}
                            className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                            Product Focus
                          </label>
                          <input
                            value={campaign.productFocus}
                            onChange={e => updateCampaign(idx, 'productFocus', e.target.value)}
                            placeholder={t('page.brief.ph_product')}
                            className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                          Objective
                        </label>
                        <input
                          value={campaign.objective}
                          onChange={e => updateCampaign(idx, 'objective', e.target.value)}
                          placeholder={t('page.brief.ph_objective')}
                          className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                          Key Message
                        </label>
                        <textarea
                          value={campaign.keyMessage}
                          onChange={e => updateCampaign(idx, 'keyMessage', e.target.value)}
                          placeholder={t('page.brief.ph_core_message')}
                          rows={2}
                          className="w-full resize-none rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.section>

          {/* ─── Special Occasions ────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.15 }}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarHeart className="h-4 w-4 text-fuchsia-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Special Occasions
                </h2>
              </div>
              {occasions.some(o => o.enabled) && (
                <button
                  type="button"
                  onClick={() => setOccasions(prev => prev.map(o => ({ ...o, enabled: false })))}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
                  title="Uncheck every occasion. Lets you opt-in only to the ones that match this brand's audience."
                >
                  Deselect all
                </button>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="flex flex-wrap gap-2">
                {occasions.map((occ, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleOccasion(idx)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      occ.enabled
                        ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
                        : 'border-white/5 bg-white/5 text-zinc-600 hover:border-white/10 hover:text-zinc-400'
                    }`}
                  >
                    {occ.enabled ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <div className="h-3 w-3 rounded-full border border-zinc-600" />
                    )}
                    <span>{occ.name}</span>
                    <span className="text-[10px] opacity-60">{occ.date}</span>
                  </button>
                ))}
              </div>

              {/* Add custom occasion */}
              <div className="mt-4 flex items-end gap-2 border-t border-white/5 pt-4">
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Custom Occasion
                  </label>
                  <input
                    value={customOccasionName}
                    onChange={e => setCustomOccasionName(e.target.value)}
                    placeholder={t('page.brief.ph_occasion')}
                    className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
                    onKeyDown={e => e.key === 'Enter' && addCustomOccasion()}
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Date
                  </label>
                  <input
                    value={customOccasionDate}
                    onChange={e => setCustomOccasionDate(e.target.value)}
                    placeholder="e.g. 15th Aug"
                    className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
                    onKeyDown={e => e.key === 'Enter' && addCustomOccasion()}
                  />
                </div>
                <button
                  onClick={addCustomOccasion}
                  disabled={!customOccasionName.trim()}
                  className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-400 transition hover:border-fuchsia-500/30 hover:text-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.section>

          {/* ─── Platforms ─────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.2 }}
          >
            <div className="mb-4 flex items-center gap-2">
              <MonitorPlay className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Platforms
              </h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.map(platform => {
                const isSelected = selectedPlatforms.includes(platform.id);
                const limits = PLATFORM_LIMITS[platform.id.toLowerCase().replace(/[\s()]/g, '')];
                const defaultFormat = limits?.formats[0];

                return (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? `${platform.border} ${platform.bg} ${platform.color}`
                        : 'border-white/5 bg-white/[0.02] text-zinc-600 hover:border-white/10 hover:text-zinc-400'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isSelected ? `${platform.bg}` : 'bg-white/5'
                      }`}
                    >
                      <PlatformIcon id={platform.id} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{platform.label}</p>
                      {isSelected && defaultFormat && (
                        <p className="mt-0.5 truncate text-[10px] opacity-60">
                          {defaultFormat.caption.max.toLocaleString()} chars max
                          {' / '}
                          {defaultFormat.caption.optimal} optimal
                        </p>
                      )}
                    </div>
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        isSelected
                          ? 'border-current bg-current/20'
                          : 'border-zinc-700'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.section>

          {/* ─── Piece Count + Tone + Engine ───────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.25 }}
            className="grid gap-6 lg:grid-cols-3"
          >
            {/* Piece count slider */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-violet-400" />
                  <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Content Pieces
                  </label>
                </div>
                <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-sm font-bold text-violet-400">
                  {pieceCount}
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={18}
                value={pieceCount}
                onChange={e => setPieceCount(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
                <span>5 pieces</span>
                <span>18 pieces</span>
              </div>
              <p className="mt-3 text-center text-xs text-zinc-500">
                {pieceCount} content pieces for {selectedMonthLabel}
              </p>
            </div>

            {/* Tone notes */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-fuchsia-400" />
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Tone Notes
                </label>
              </div>
              <InlineAITextHost
                onAction={(action, selected) => aiRewrite.start(action, selected, (newText) => {
                  // Replace the selected substring within toneNotes
                  setToneNotes(prev => prev.includes(selected) ? prev.replace(selected, newText) : prev + '\n' + newText);
                })}
              >
                <textarea
                  value={toneNotes}
                  onChange={e => setToneNotes(e.target.value)}
                  placeholder={t('page.brief.ph_extra_notes')}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
                />
              </InlineAITextHost>
            </div>

            {/* B4 — visual look & feel direction (fed into generation prompts) */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-fuchsia-400" />
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Visual Look &amp; Feel
                </label>
              </div>
              <textarea
                value={lookFeel}
                onChange={e => setLookFeel(e.target.value)}
                placeholder="Mood, palette, and style in words, e.g. warm minimal, gold + cream, editorial photography, lots of negative space"
                rows={3}
                className="w-full resize-none rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
              />
            </div>

            {/* AI engine info — configured server-side */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  AI Engine
                </label>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">AI Router</p>
                  <p className="text-[10px] text-zinc-500">Server-configured AI routing</p>
                </div>
              </div>
            </div>
          </motion.section>

          {/* ─── Generate Button ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: 0.3 }}
            className="pt-2"
          >
            <button
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                selectedPlatforms.length === 0 ||
                campaigns.filter(c => c.name.trim()).length === 0
              }
              className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 p-[1px] shadow-lg shadow-violet-500/20 transition hover:shadow-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <div className="relative flex items-center justify-center gap-3 rounded-[15px] bg-zinc-950/50 px-8 py-4 transition group-hover:bg-zinc-950/30">
                <Sparkles className="h-5 w-5 text-white" />
                <span className="text-lg font-bold text-white">
                  Generate Content
                </span>
                <Zap className="h-5 w-5 text-yellow-400" />
              </div>
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </button>

            {/* Validation hints */}
            {selectedPlatforms.length === 0 && (
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--color-danger)' }}>
                Select at least one platform
              </p>
            )}
            {campaigns.filter(c => c.name.trim()).length === 0 && (
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--color-danger)' }}>
                Add at least one campaign with a name
              </p>
            )}
          </motion.div>
        </div>
      </div>

      {/* Shimmer keyframe via inline style */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* AI rewrite dialog — opens on InlineAI action, shows DiffView. */}
      <AIRewriteDialog state={aiRewrite.state} onClose={aiRewrite.cancel} />
    </div>
  );
}
