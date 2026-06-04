import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, FileText, Layers, Wand2, ArrowRight, Activity, CheckCircle2, Zap, Clock, ArrowUpRight, BarChart3, Users, Database, Sparkles, TrendingUp, TrendingDown, AlertTriangle, Cpu, ShieldCheck, Gauge, ChevronDown, ChevronUp, Building2, Image as ImageIcon, Video as VideoIcon, Search, Palette, Bot, BookOpen, Radio, Bell, Lightbulb, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useClients } from '../lib/client-context';
import { dashboardApi, authApi, type DashboardStats, type AiStats, type DashboardInsights, type ActivityEntry } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { greeting } from '../lib/greeting';
import { t } from '../i18n';
import { EmptyState, EmptyStateAction } from '../components/ui/EmptyState';
// Note: Sparkline is defined locally below — the SVG-based version
// already in use at line 1107 has different ergonomics than the
// recharts-based components/ui/Sparkline. Passing through the local one
// keeps the bundle smaller and avoids a name collision.
import { motionUI, motionBase, easings, durations } from '../lib/motion';
import { Skeleton as TokenSkeleton } from '../components/ui/Skeleton';
import { BentoGrid, BentoTile } from '../components/ui/BentoGrid';
import { AIProviderRouter } from '../components/insights/AIProviderRouter';
import { AnimatedGradientBorder } from '../components/ui/AnimatedGradientBorder';

// Synth a smoothly-rising 12-point sparkline that ends at `target`.
// Used until per-stat time-series is wired into the backend dashboard API.
function trendSeries(target: number, length = 12): number[] {
  if (target <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const t = i / (length - 1);
    const ease = 1 - Math.pow(1 - t, 2.4);
    const wobble = Math.sin(i * 1.2) * 0.04 * target;
    out.push(Math.max(0, Math.round(target * (0.55 + 0.45 * ease) + wobble)));
  }
  return out;
}

// Valid month format: "Month YYYY" e.g. "April 2026"
const VALID_MONTH_RE = /^[A-Z][a-z]+ \d{4}$/;
const SMOKE_RE = /^VPS Smoke|smoke/i;

function SkeletonTile({ isDark }: { isDark: boolean }) {
  return <div className={`h-8 w-16 rounded ${isDark ? 'bg-white/[0.05]' : 'bg-slate-200/60'} animate-pulse`} />;
}

// Routes through the Phase 4.1 motion vocabulary so all 40+ Dashboard
// fadeUp() call sites share one easing + duration pair. Easing kept on
// the locally-defined out-quart for visual continuity with prior builds;
// duration borrowed from --dur-slow so the entrance feels editorial.
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: durations.slow,
    delay,
    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  },
});

function getRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Map raw AuditLog action strings → human-readable activity descriptions
function describeActivity(entry: ActivityEntry): { label: string; icon: any; color: (d: boolean) => string; href?: string } {
  const c = entry.clientName || 'a client';
  const p = entry.payload || {};
  switch (entry.action) {
    case 'generate':
      return { label: `Generated ${p.pieceCount || ''} posts for ${c} (${p.month || 'a month'})`, icon: Sparkles, color: (d) => d ? 'text-amber-400' : 'text-amber-700', href: p.month ? `/calendar?client=${entry.clientId}&month=${encodeURIComponent(p.month)}` : '/calendar' };
    case 'assistant:generate_content':
      return { label: `Assistant generated content for ${c}`, icon: Bot, color: (d) => d ? 'text-violet-400' : 'text-violet-700' };
    case 'assistant:create_client':
      return { label: `Created new client: ${p.name || c}`, icon: Building2, color: (d) => d ? 'text-blue-400' : 'text-blue-700', href: '/clients' };
    case 'assistant:search_visual_refs':
      return { label: `Searched visual refs: "${(p.query || '').slice(0, 40)}"`, icon: ImageIcon, color: (d) => d ? 'text-pink-400' : 'text-pink-700' };
    case 'assistant:research':
      return { label: `Researched: "${(p.query || '').slice(0, 40)}"`, icon: Search, color: (d) => d ? 'text-orange-400' : 'text-orange-700' };
    case 'assistant:get_brief':
      return { label: `Viewed brief for ${c}`, icon: FileText, color: (d) => d ? 'text-zinc-400' : 'text-slate-600' };
    case 'assistant:get_stats':
      return { label: 'Checked stats', icon: BarChart3, color: (d) => d ? 'text-zinc-400' : 'text-slate-600' };
    case 'assistant:delete_calendar':
      return { label: `Deleted calendar (${p.month || 'a month'}) for ${c}`, icon: AlertTriangle, color: (d) => d ? 'text-red-400' : 'text-red-700' };
    default:
      return { label: `${entry.action} on ${entry.entityType}${entry.clientName ? ' · ' + entry.clientName : ''}`, icon: Activity, color: (d) => d ? 'text-zinc-400' : 'text-slate-600' };
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Rough cost estimation per provider (input+output blended USD per 1M tokens)
const PROVIDER_COST_PER_M: Record<string, number> = {
  gemini: 5.0,    // Gemini 3.1 Pro avg ~$5/M
  xai: 3.0,       // Grok 4.20 ~$3/M
  moonshot: 1.0,  // Kimi K2.6 ~$1/M
};

function estimateCostUsd(providerStats: { provider: string; totalTokens: number }[]): number {
  return providerStats.reduce((sum, p) => sum + (p.totalTokens / 1_000_000) * (PROVIDER_COST_PER_M[p.provider] || 2), 0);
}

function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

// Inline SVG sparkline — no chart lib needed
let _sparkId = 0;
function Sparkline({ data, color, height = 32, width = 100 }: { data: number[]; color: string; height?: number; width?: number }) {
  // Stable per-instance ID prevents gradient collision when multiple sparklines share a color
  const gradId = useMemo(() => `spark-grad-${++_sparkId}`, []);
  if (!data.length) return null;
  // Single-data-point fallback: render flat line at mid-height instead of collapsing to x=0
  if (data.length === 1) {
    const y = height / 2;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1="0" y1={y} x2={width} y2={y} stroke={color} strokeWidth="1.5" strokeOpacity="0.4" strokeDasharray="2 2" />
        <circle cx={width / 2} cy={y} r="3" fill={color} />
      </svg>
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => `${i * stepX},${height - ((v - min) / range) * height}`).join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const PROVIDER_META: Record<string, { label: string; color: (d: boolean) => string; bg: (d: boolean) => string }> = {
  gemini: { label: 'Gemini', color: (d) => d ? 'text-blue-400' : 'text-blue-600', bg: (d) => d ? 'bg-blue-500/10' : 'bg-blue-50' },
  xai: { label: 'Grok', color: (d) => d ? 'text-orange-400' : 'text-orange-600', bg: (d) => d ? 'bg-orange-500/10' : 'bg-orange-50' },
  moonshot: { label: 'Kimi', color: (d) => d ? 'text-purple-400' : 'text-purple-600', bg: (d) => d ? 'bg-purple-500/10' : 'bg-purple-50' },
};

const TASK_COLORS: Record<string, string> = {
  text: 'bg-blue-500', image: 'bg-pink-500', image_edit: 'bg-rose-500',
  video: 'bg-violet-500', analysis: 'bg-amber-500', embedding: 'bg-cyan-500',
};

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const prevValueRef = useRef<number | null>(null);
  const isInteger = Number.isInteger(value);
  useEffect(() => {
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;
    if (value === 0) { setDisplay(0); return; }
    const duration = 800;
    const steps = 30;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) { setDisplay(value); clearInterval(timer); }
      // Round (not floor) so percentages animate smoothly to nearest integer
      else setDisplay(isInteger ? Math.round(current) : Math.round(current * 10) / 10);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value, isInteger]);
  return <>{display}</>;
}

// ─── Walkthrough Section ────────────────────────────────────────

const WALKTHROUGH_KEY = 'radix_walkthrough_open';

const WALKTHROUGH_STEPS: Array<{
  icon: any; title: string; description: string; href: string; cta: string;
  color: (d: boolean) => string; bg: (d: boolean) => string;
}> = [
  {
    icon: Building2,
    title: '1. Add Your Clients',
    description: 'Start by adding your clients with their brand name and industry. Each client gets their own workspace with a dedicated brief, calendar, and content library.',
    href: '/clients',
    cta: 'Go to Clients',
    color: (d) => d ? 'text-blue-400' : 'text-blue-600',
    bg: (d) => d ? 'bg-blue-500/10' : 'bg-blue-100',
  },
  {
    icon: FileText,
    title: '2. Create a Brief',
    description: 'Define the brand voice, target audience, objectives, key messages, and which platforms to post on. This brief powers all AI-generated content for the client.',
    href: '/brief',
    cta: 'New Brief',
    color: (d) => d ? 'text-purple-400' : 'text-purple-600',
    bg: (d) => d ? 'bg-purple-500/10' : 'bg-purple-100',
  },
  {
    icon: Calendar,
    title: '3. Generate a Content Calendar',
    description: 'AI creates a full month of platform-optimized posts — captions, hashtags, visual ideas, and posting schedule. Each post is tailored to the platform (Instagram, TikTok, LinkedIn, X).',
    href: '/calendar',
    cta: 'View Calendar',
    color: (d) => d ? 'text-amber-400' : 'text-amber-600',
    bg: (d) => d ? 'bg-amber-500/10' : 'bg-amber-100',
  },
  {
    icon: Layers,
    title: '4. Review & Approve',
    description: 'Go through each generated post, edit captions, request changes, or approve. Posts move through a pipeline: Draft → In Review → Approved → Published.',
    href: '/content-review',
    cta: 'Review Content',
    color: (d) => d ? 'text-emerald-400' : 'text-emerald-600',
    bg: (d) => d ? 'bg-emerald-500/10' : 'bg-emerald-100',
  },
  {
    icon: Wand2,
    title: '5. Creative Tools',
    description: 'Generate images from text, edit existing images with AI, create videos from prompts, or turn a still image into a video. All powered by Gemini and Grok with automatic fallback.',
    href: '/creative',
    cta: 'Open Studio',
    color: (d) => d ? 'text-pink-400' : 'text-pink-600',
    bg: (d) => d ? 'bg-pink-500/10' : 'bg-pink-100',
  },
  {
    icon: Database,
    title: '6. Knowledge Base',
    description: 'Upload brand guides, PDFs, and reference documents. The AI uses this knowledge to generate content that matches the client\'s tone, terminology, and brand guidelines.',
    href: '/knowledge',
    cta: 'Add Knowledge',
    color: (d) => d ? 'text-cyan-400' : 'text-cyan-600',
    bg: (d) => d ? 'bg-cyan-500/10' : 'bg-cyan-100',
  },
  {
    icon: Search,
    title: '7. Research & References',
    description: 'Run AI-powered research on any topic with real sources. Browse visual references and mood boards to inspire your creative direction.',
    href: '/research',
    cta: 'Start Research',
    color: (d) => d ? 'text-orange-400' : 'text-orange-600',
    bg: (d) => d ? 'bg-orange-500/10' : 'bg-orange-100',
  },
  {
    icon: Bot,
    title: '8. AI Assistant',
    description: 'A floating chat assistant available on every page. Ask questions about your clients, get content suggestions, brainstorm ideas, or get help navigating the platform.',
    href: '/',
    cta: 'Click the chat icon →',
    color: (d) => d ? 'text-violet-400' : 'text-violet-600',
    bg: (d) => d ? 'bg-violet-500/10' : 'bg-violet-100',
  },
];

function WalkthroughSection({ isDark, glass, glassStatic, textPrimary, textSecondary, textMuted }: {
  isDark: boolean; glass: string; glassStatic: string; textPrimary: string; textSecondary: string; textMuted: string;
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(WALKTHROUGH_KEY) !== 'false'; } catch { return true; }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(WALKTHROUGH_KEY, String(next)); } catch {}
  };

  return (
    <motion.div {...fadeUp(0.5)}>
      <div className={`rounded-2xl overflow-hidden ${glassStatic}`}>
        {/* Header — always visible */}
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse Radix walkthrough' : 'Expand Radix walkthrough'}
          className={`w-full flex items-center justify-between p-6 text-left cursor-pointer transition-colors ${isDark ? 'hover:bg-white/[0.02]' : 'hover:bg-slate-50'}`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
              <BookOpen className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${textPrimary}`}>{t('page.dashboard.how_radix_works')}</h3>
              <p className={`text-[11px] ${textMuted}`}>A step-by-step guide to every section</p>
            </div>
          </div>
          {open
            ? <ChevronUp className={`w-4 h-4 ${textMuted}`} />
            : <ChevronDown className={`w-4 h-4 ${textMuted}`} />
          }
        </button>

        {/* Expandable content */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={motionBase}
              className="overflow-hidden"
            >
              <div className={`px-6 pb-6 border-t ${isDark ? 'border-white/[0.04]' : 'border-slate-100'}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-5">
                  {WALKTHROUGH_STEPS.map((step, i) => (
                    <motion.div
                      key={step.title}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...motionBase, delay: i * 0.04 }}
                    >
                      <Link
                        to={step.href}
                        className={`group block rounded-xl p-4 border transition-all duration-200 ${isDark ? 'bg-white/[0.02] border-white/[0.04] hover:border-white/[0.1] hover:bg-white/[0.04]' : 'bg-slate-50 border-slate-300 hover:border-slate-400 hover:bg-white hover:shadow-sm'}`}
                      >
                        <div className="flex gap-3">
                          <div className={`w-10 h-10 rounded-xl ${step.bg(isDark)} flex items-center justify-center shrink-0 mt-0.5`}>
                            <step.icon className={`w-5 h-5 ${step.color(isDark)}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold mb-1 transition-colors ${isDark ? 'text-zinc-200 group-hover:text-white' : 'text-slate-900 group-hover:text-slate-950'}`}>
                              {step.title}
                            </p>
                            <p className={`text-xs leading-relaxed mb-2 ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                              {step.description}
                            </p>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${step.color(isDark)} transition-all`}>
                              {step.cta} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const { clients, currentClient, authenticated } = useClients();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [aiStats, setAiStats] = useState<AiStats | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    dashboardApi.stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
    dashboardApi.aiStats()
      .then(setAiStats)
      .catch(() => setAiStats(null));
    dashboardApi.insights()
      .then(setInsights)
      .catch(() => setInsights(null));
    dashboardApi.activity()
      .then(setActivity)
      .catch(() => setActivity(null));
    authApi.me()
      .then((me) => setUserName(me?.name ?? null))
      .catch(() => setUserName(null));
  }, [authenticated]);

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const heroGreeting = greeting(new Date().getHours(), userName?.split(' ')[0]);

  const totalPosts = stats?.content.totalPosts || 0;
  const approvedPosts = stats?.content.byStatus.approved || 0;
  const approvalRate = totalPosts > 0 ? Math.round((approvedPosts / totalPosts) * 100) : 0;

  // Glass card base classes — light mode uses solid white + clear shadow for depth
  const glass = isDark
    ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.05]'
    : 'bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md shadow-sm transition-shadow';
  const glassStatic = isDark
    ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.06]'
    : 'bg-white border border-slate-200 shadow-sm';

  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-zinc-400' : 'text-slate-600';
  const textMuted = isDark ? 'text-zinc-600' : 'text-slate-500';
  const textDim = isDark ? 'text-zinc-700' : 'text-slate-400';

  // Skeleton loader — delegates to the token-driven primitive so theme
  // cycling (dark / light / studio) works without per-class overrides.
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <TokenSkeleton className={className} radius="md" />
  );

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* ─── ROW 1: Hero CTA + Welcome ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* ─── Editorial masthead — Dashboard front door ─────────────
            Deliberate POV departure from the gradient-bloom hero template
            used on Research/AIDesign/ContentPieces/BrandKit. Magazine
            masthead vocabulary: Libre Bodoni headline with a scribed amber
            rule, JetBrains Mono caption strip, asymmetric weight, hairline
            geometry instead of rounded glass. Front-door surface earns the
            distinctive treatment.
            ──────────────────────────────────────────────────────────── */}
        <motion.div {...fadeUp(0)} className="col-span-12 lg:col-span-8">
          <Link
            to="/brief"
            aria-label="Start a new brief"
            className="group relative block overflow-hidden cursor-pointer"
            style={{
              background: 'var(--color-bg-elevated)',
              borderTop: '1px solid var(--color-border)',
              borderRight: '1px solid var(--color-border)',
              borderBottom: '1px solid var(--color-border)',
              borderLeft: '3px solid var(--color-accent)',
            }}
          >
            {/* Top caption strip — issue-number masthead vocabulary. Mono
                + uppercase + wide tracking + thin hairline below. */}
            <div
              className="flex items-center justify-between gap-4 px-6 lg:px-10 py-3 border-b font-mono"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <span className="text-[10px] uppercase tracking-[0.28em]" style={{ color: 'var(--color-fg-subtle)' }}>
                Radix · Vol. 02 · No. {String(Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)).padStart(3, '0')}
              </span>
              <span className="text-[10px] uppercase tracking-[0.28em] hidden sm:inline" style={{ color: 'var(--color-fg-subtle)' }}>
                {currentDate}
              </span>
            </div>

            {/* Body — asymmetric: headline + lede on the left, action
                slug on the right, generous vertical breathing room. */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] items-end gap-6 px-6 lg:px-10 py-8 lg:py-12">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--color-fg-muted)' }}>
                  {heroGreeting}{currentClient?.name ? ` · ${currentClient.name}` : ''}
                </p>
                <h1
                  className="font-display mt-3 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[0.95] tracking-tight"
                  style={{ color: 'var(--color-fg)' }}
                >
                  <span className="relative inline-block">
                    Today
                    {/* Hand-drawn-style underline — single SVG stroke,
                        not a div bar. Skew + slight wobble gives it the
                        scribed feel that breaks the AI-grid look. */}
                    <svg
                      aria-hidden="true"
                      className="absolute -bottom-1 left-0 w-full"
                      viewBox="0 0 200 8"
                      preserveAspectRatio="none"
                      style={{ height: '0.45em' }}
                    >
                      <path
                        d="M2,5 Q50,1 100,4 T198,3"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>{' '}
                  on Radix.
                </h1>
                <p
                  className="mt-5 max-w-lg text-[15px] leading-[1.55]"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400 }}
                >
                  Brief in. Calendar out. Brand-true captions, visuals, and a
                  publish-ready month — one prompt away.
                </p>
              </div>

              {/* Right-rail action — a vertical slug, not a glowing pill.
                  Number + label + arrow stacked editorially. On hover the
                  arrow inks across instead of pulsing. */}
              <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--color-fg-subtle)' }}>
                  ↪ Section 01
                </span>
                <span
                  className="font-display text-2xl sm:text-3xl font-semibold leading-none"
                  style={{ color: 'var(--color-fg)' }}
                >
                  Start a brief
                </span>
                <span className="inline-flex items-center gap-2 mt-1 font-mono text-[10px] uppercase tracking-[0.22em] transition-all group-hover:gap-3"
                  style={{ color: 'var(--color-accent)' }}
                >
                  Compose
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </div>

            {/* Bottom hairline metrics strip — paper-of-record vibe */}
            <div
              className="grid grid-cols-3 sm:grid-cols-4 border-t font-mono text-[10px] uppercase tracking-[0.22em]"
              style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg-subtle)' }}
            >
              <div className="px-6 lg:px-10 py-3 border-r" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <span style={{ color: 'var(--color-fg-muted)' }}>Total</span>{' '}
                <span style={{ color: 'var(--color-fg)' }} className="font-semibold tabular-nums">{loading ? '—' : totalPosts}</span>{' '}posts
              </div>
              <div className="px-6 lg:px-10 py-3 border-r" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <span style={{ color: 'var(--color-fg-muted)' }}>Approved</span>{' '}
                <span style={{ color: 'var(--color-fg)' }} className="font-semibold tabular-nums">{approvalRate}%</span>
              </div>
              <div className="px-6 lg:px-10 py-3 sm:border-r" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <span style={{ color: 'var(--color-fg-muted)' }}>Clients</span>{' '}
                <span style={{ color: 'var(--color-fg)' }} className="font-semibold tabular-nums">{loading ? '—' : (stats?.clients?.total ?? 0)}</span>
              </div>
              <div className="hidden sm:flex px-6 lg:px-10 py-3 items-center gap-2">
                <span className="inline-flex w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-success)' }} aria-hidden="true" />
                <span style={{ color: 'var(--color-success)' }}>AI live</span>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Right column: Quick Stat + Latest Activity (greeting moved into hero on 2026-04-27,
            split into two tiles 2026-04-27 to balance the hero's vertical mass) */}
        <motion.div {...fadeUp(0.1)} className="col-span-12 lg:col-span-4 flex flex-col gap-5">
          {/* Top tile — total posts */}
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            {loading || stats == null ? (
              <div className="space-y-3"><Skeleton className="h-4 w-20" /><SkeletonTile isDark={isDark} /><Skeleton className="h-3 w-32" /></div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-amber-500/10' : 'bg-amber-100'}`}>
                    <Zap className={`w-4 h-4 ${isDark ? 'text-amber-500' : 'text-amber-600'}`} />
                  </div>
                  {stats.content.totalMonths > 0 && (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                      {stats.content.totalMonths} {stats.content.totalMonths === 1 ? 'month' : 'months'}
                    </span>
                  )}
                </div>
                {/* eyebrow → hero number: matches the stat-card standard for a cohesive dashboard */}
                <p className={`text-[11px] uppercase tracking-[0.14em] font-semibold ${textMuted}`}>{t('page.dashboard.total_posts')}</p>
                <div className={`mt-1 text-[34px] leading-none font-black tabular-nums ${textPrimary}`}>
                  <AnimatedNumber value={totalPosts} />
                </div>
              </>
            )}
          </div>

          {/* Bottom tile — latest activity peek (fills the dead space + gives an
              entry point straight to the most recent month from row 1) */}
          <Link
            to={(() => {
              const list: any[] = (stats?.activity.recentMonths as any[]) || [];
              const m = list.find((x) => !SMOKE_RE.test(x.month || ''));
              const briefId = m?.briefId || m?.brief_id || m?.id;
              return m ? `/calendar?month=${encodeURIComponent(m.month)}${briefId ? `&brief=${encodeURIComponent(briefId)}` : ''}` : '/calendar';
            })()}
            className={`rounded-2xl p-6 group transition-all duration-200 cursor-pointer ${glass}`}
          >
            {loading || stats == null ? (
              <div className="space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-32" /><Skeleton className="h-3 w-40" /></div>
            ) : (() => {
              const recent = stats.activity.recentMonths?.find((m: any) => !SMOKE_RE.test(m.month || ''));
              if (!recent) {
                return (
                  <div className="h-full flex flex-col justify-center">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
                      <Sparkles className={`w-4 h-4 ${textMuted}`} />
                    </div>
                    <p className={`text-sm font-medium ${textPrimary}`}>{t('page.dashboard.no_activity')}</p>
                    <p className={`text-xs mt-1 ${textMuted}`}>{t('page.dashboard.no_activity_sub')}</p>
                  </div>
                );
              }
              return (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-blue-500/10' : 'bg-blue-100'}`}>
                      <Activity className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-700'}`} />
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}>{t('page.dashboard.label_latest')}</span>
                  </div>
                  <p className={`text-base font-semibold transition-colors ${isDark ? 'text-zinc-100 group-hover:text-white' : 'text-slate-800 group-hover:text-slate-900'}`}>{recent.month}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-xs ${textMuted}`}>{recent.postCount} posts · {getRelativeTime(recent.createdAt)}</p>
                    <ArrowRight className={`w-3.5 h-3.5 transition-all duration-200 group-hover:translate-x-0.5 ${isDark ? 'text-zinc-700 group-hover:text-zinc-400' : 'text-slate-300 group-hover:text-slate-500'}`} />
                  </div>
                </>
              );
            })()}
          </Link>
        </motion.div>
      </div>

      {/* ─── ROW 1b: Action Center + Smart Insights ─── */}
      {insights && (insights.actionCenter.totalActions > 0 || insights.insights.length > 0) && (
        <motion.div {...fadeUp(0.12)}>
          <div className="grid grid-cols-12 gap-5">

            {/* Action Center — only show if there are actions */}
            {insights.actionCenter.totalActions > 0 && (
              <div className={`col-span-12 ${insights.insights.length > 0 ? 'lg:col-span-5' : ''} rounded-2xl p-5 border ${isDark ? 'bg-amber-500/[0.04] border-amber-500/20' : 'bg-amber-50 border-amber-300'}`}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-amber-500/15' : 'bg-amber-100'}`}>
                    <Bell className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-700'}`} />
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>{t('page.dashboard.needs_attention')}</h3>
                    <p className={`text-[11px] ${isDark ? 'text-amber-400/70' : 'text-amber-700/80'}`}>{insights.actionCenter.totalActions} item{insights.actionCenter.totalActions !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {insights.actionCenter.pendingReview > 0 && (
                    <Link to="/content-review" className={`flex items-center justify-between p-3 rounded-lg transition-colors ${isDark ? 'bg-white/[0.03] hover:bg-white/[0.06]' : 'bg-white hover:bg-amber-50/50'} border ${isDark ? 'border-white/[0.04]' : 'border-amber-200'} cursor-pointer group`}>
                      <div className="flex items-center gap-2">
                        <Layers className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-700'}`} />
                        <span className={`text-sm ${textPrimary}`}>{insights.actionCenter.pendingReview} post{insights.actionCenter.pendingReview !== 1 ? 's' : ''} need revision</span>
                      </div>
                      <ArrowRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform ${isDark ? 'text-zinc-500' : 'text-amber-700'}`} />
                    </Link>
                  )}
                  {insights.actionCenter.draftsStuck > 0 && (
                    <Link to="/content-review?filter=draft" className={`flex items-center justify-between p-3 rounded-lg transition-colors ${isDark ? 'bg-white/[0.03] hover:bg-white/[0.06]' : 'bg-white hover:bg-amber-50/50'} border ${isDark ? 'border-white/[0.04]' : 'border-amber-200'} cursor-pointer group`}>
                      <div className="flex items-center gap-2">
                        <Clock className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-700'}`} />
                        <span className={`text-sm ${textPrimary}`}>{insights.actionCenter.draftsStuck} draft{insights.actionCenter.draftsStuck !== 1 ? 's' : ''} stuck 7+ days</span>
                      </div>
                      <ArrowRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform ${isDark ? 'text-zinc-500' : 'text-amber-700'}`} />
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Smart Insights */}
            {insights.insights.length > 0 && (
              <div className={`col-span-12 ${insights.actionCenter.totalActions > 0 ? 'lg:col-span-7' : ''} rounded-2xl p-5 ${glassStatic}`}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-violet-500/10' : 'bg-violet-100'}`}>
                    <Lightbulb className={`w-4 h-4 ${isDark ? 'text-violet-400' : 'text-violet-700'}`} />
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>{t('page.dashboard.smart_insights')}</h3>
                    <p className={`text-[11px] ${textMuted}`}>{t('page.dashboard.smart_insights_sub')}</p>
                  </div>
                </div>
                <motion.div className="space-y-2" variants={{ animate: { transition: { staggerChildren: 0.06 } } }} initial="initial" animate="animate">
                  {insights.insights.map((ins) => {
                    const colors = {
                      positive: { dot: 'bg-emerald-500', text: isDark ? 'text-emerald-400' : 'text-emerald-700', bg: isDark ? 'bg-emerald-500/[0.04]' : 'bg-emerald-50', border: isDark ? 'border-emerald-500/15' : 'border-emerald-200' },
                      warning: { dot: 'bg-amber-500', text: isDark ? 'text-amber-400' : 'text-amber-700', bg: isDark ? 'bg-amber-500/[0.04]' : 'bg-amber-50', border: isDark ? 'border-amber-500/15' : 'border-amber-200' },
                      info: { dot: 'bg-blue-500', text: isDark ? 'text-blue-400' : 'text-blue-700', bg: isDark ? 'bg-blue-500/[0.04]' : 'bg-blue-50', border: isDark ? 'border-blue-500/15' : 'border-blue-200' },
                    }[ins.type];
                    const Icon = ins.type === 'positive' ? TrendingUp : ins.type === 'warning' ? AlertTriangle : Sparkles;
                    return (
                      <motion.div
                        key={`${ins.type}:${ins.text}`}
                        variants={{ initial: { opacity: 0, x: -8 }, animate: { opacity: 1, x: 0 } }}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${colors.bg} ${colors.border}`}
                      >
                        <Icon className={`w-4 h-4 ${colors.text} mt-0.5 shrink-0`} />
                        <p className={`text-xs ${textPrimary} leading-relaxed`}>{ins.text}</p>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── ROW 2: Stat Cards — Bento 4x1 ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || stats == null ? (
          Array.from({ length: 4 }).map((_, i) => (
            <motion.div key={i} {...fadeUp(0.15 + i * 0.05)} className={`rounded-2xl p-5 ${glassStatic}`}>
              <div className="space-y-3"><Skeleton className="h-4 w-16" /><SkeletonTile isDark={isDark} /></div>
            </motion.div>
          ))
        ) : (
          (() => {
            const knowledgeItems = stats.knowledge.totalItems || 0;
            const lowApproval = totalPosts > 0 && approvalRate < 50; // M6
            const tiles = [
              { key: 'clients', icon: Users, label: 'Clients', value: stats.clients.total ?? 0, sub: stats.clients.withBrief ? `${stats.clients.withBrief} with brief` : '', color: isDark ? 'text-blue-400' : 'text-blue-700', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-100' },
              { key: 'calendars', icon: Calendar, label: 'Calendars', value: stats.content.totalMonths ?? 0, sub: '', color: isDark ? 'text-purple-400' : 'text-purple-700', bg: isDark ? 'bg-purple-500/10' : 'bg-purple-100' },
              {
                key: 'approval',
                icon: lowApproval ? AlertTriangle : CheckCircle2,
                label: 'Approval',
                value: `${approvalRate}%`,
                sub: lowApproval
                  ? 'Needs attention'
                  : approvalRate >= 80 ? 'Healthy' : approvalRate > 0 ? 'Needs review' : '—',
                color: lowApproval ? (isDark ? 'text-red-400' : 'text-red-700') : (isDark ? 'text-emerald-400' : 'text-emerald-700'),
                bg: lowApproval ? (isDark ? 'bg-red-500/10' : 'bg-red-100') : (isDark ? 'bg-emerald-500/10' : 'bg-emerald-100'),
                href: '/content-review',
                alert: lowApproval,
              },
              { key: 'knowledge', icon: Database, label: 'Knowledge', value: knowledgeItems, sub: stats.knowledge.totalChunks ? `${stats.knowledge.totalChunks} chunks` : '', color: isDark ? 'text-amber-400' : 'text-amber-700', bg: isDark ? 'bg-amber-500/10' : 'bg-amber-100', zeroCta: knowledgeItems === 0 },
            ];
            return tiles.map((stat, i) => {
              const inner = (
                <>
                  <div className="p-5 pb-3">
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                        <stat.icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                      {stat.sub && (
                        <span className={`text-[10px] font-semibold ${stat.color} ${stat.bg} px-2 py-0.5 rounded-full`}>{stat.sub}</span>
                      )}
                    </div>
                    {/* M1: Knowledge zero-state inline CTA in place of the big "0" */}
                    {stat.zeroCta ? (
                      <>
                        <Link to="/knowledge" className="text-sm font-semibold text-amber-400 hover:text-amber-300">+ Add knowledge</Link>
                        <p className={`text-xs mt-1 ${textMuted}`}>{t('page.dashboard.upload_briefs')}</p>
                      </>
                    ) : (
                      <>
                        {/* eyebrow label → hero number: stronger visual hierarchy */}
                        <p className={`text-[11px] uppercase tracking-[0.14em] font-semibold ${textMuted}`}>{stat.label}</p>
                        <div className={`mt-1 text-[34px] leading-none font-black tabular-nums ${stat.alert ? 'text-red-400' : textPrimary}`}>
                          {typeof stat.value === 'number' ? <AnimatedNumber value={stat.value} /> : (stat.value ?? '—')}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Full-bleed graph footer — the "premium metric card" signature. */}
                  {typeof stat.value === 'number' && stat.value > 0 && !stat.zeroCta && (
                    <div className="h-10">
                      <Sparkline data={trendSeries(stat.value)} color={stat.alert ? '#ef4444' : '#10b981'} height={40} />
                    </div>
                  )}
                </>
              );
              // M6: wrap approval tile in Link when below threshold
              if (stat.href) {
                return (
                  <motion.div key={stat.key} {...fadeUp(0.15 + i * 0.05)}>
                    <Link to={stat.href} className={`block rounded-2xl overflow-hidden ${glassStatic}`}>
                      {inner}
                    </Link>
                  </motion.div>
                );
              }
              return (
                <motion.div key={stat.key} {...fadeUp(0.15 + i * 0.05)} className={`rounded-2xl overflow-hidden ${glassStatic}`}>
                  {inner}
                </motion.div>
              );
            });
          })()
        )}
      </div>

      {/* ─── ROW 2b: AI Engine (Bento layout — Tier 1 #1) ─── */}
      {aiStats && aiStats.totalCalls > 0 && (
        <motion.div {...fadeUp(0.25)}>
          <BentoGrid columns={12} gap="base">

            {/* AI Overview */}
            <BentoTile colSpan={4} accent pad="lg">
              <h3 className={`text-sm font-semibold flex items-center gap-2 mb-5 ${textPrimary}`}>
                <Cpu className={`w-4 h-4 ${textSecondary}`} /> AI Engine
              </h3>
              <div className="space-y-4">
                <div>
                  <p className={`text-[11px] uppercase tracking-[0.14em] font-semibold ${textMuted}`}>{t('page.dashboard.total_calls')}</p>
                  <div className={`mt-1 text-[34px] leading-none font-black tabular-nums ${textPrimary}`}>
                    <AnimatedNumber value={aiStats.totalCalls} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className={`rounded-xl p-3 border ${isDark ? 'bg-white/[0.03] border-white/[0.04]' : 'bg-slate-100 border-slate-300'}`}>
                    <div className={`text-base font-bold tabular-nums ${textPrimary}`}>{formatTokens(aiStats.totalTokens)}</div>
                    <p className={`text-[10px] font-medium ${isDark ? 'text-zinc-500' : 'text-slate-600'}`}>Tokens</p>
                  </div>
                  <div className={`rounded-xl p-3 border ${isDark ? 'bg-emerald-500/[0.05] border-emerald-500/15' : 'bg-emerald-50 border-emerald-300'}`}>
                    <div className={`text-base font-bold tabular-nums flex items-center gap-0.5 ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      <DollarSign className="w-3 h-3" />
                      <span>{formatUsd(estimateCostUsd(aiStats.providers)).replace('$', '')}</span>
                    </div>
                    <p className={`text-[10px] font-medium ${isDark ? 'text-emerald-400/70' : 'text-emerald-700/80'}`}>Est. cost</p>
                  </div>
                  <div className={`rounded-xl p-3 border ${isDark ? 'bg-white/[0.03] border-white/[0.04]' : 'bg-slate-100 border-slate-300'}`}>
                    <div className={`text-base font-bold tabular-nums flex items-center gap-1 ${textPrimary}`}>
                      {aiStats.totalErrors > 0 && <AlertTriangle className={`w-3 h-3 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />}
                      {aiStats.totalCalls > 0
                        ? Math.round(((aiStats.totalCalls - aiStats.totalErrors) / aiStats.totalCalls) * 100)
                        : 100}%
                    </div>
                    <p className={`text-[10px] font-medium ${isDark ? 'text-zinc-500' : 'text-slate-600'}`}>Success</p>
                  </div>
                </div>
                {aiStats.totalFallbacks > 0 && (
                  <div className={`flex items-center gap-2 text-[11px] font-medium px-3 py-2 rounded-lg ${isDark ? 'bg-amber-500/5 text-amber-400/80 border border-amber-500/10' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {aiStats.totalFallbacks} fallback{aiStats.totalFallbacks !== 1 ? 's' : ''} activated
                  </div>
                )}
              </div>
            </BentoTile>

            {/* Per-provider cards */}
            <BentoTile colSpan={8} pad="sm" static>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {aiStats.providers.map((p, i) => {
                const meta = PROVIDER_META[p.provider] || { label: p.provider, color: (d: boolean) => d ? 'text-zinc-400' : 'text-slate-600', bg: (d: boolean) => d ? 'bg-white/5' : 'bg-slate-50' };
                return (
                  <motion.div
                    key={p.provider}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
                    className={`rounded-2xl p-5 border transition-all duration-200 ${isDark ? 'bg-white/[0.03] backdrop-blur-xl border-white/[0.06]' : 'bg-white border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-bold ${meta.color(isDark)}`}>{meta.label}</span>
                      <span
                        role="status"
                        aria-label={`${meta.label} health: ${p.successRate >= 80 ? 'healthy' : p.successRate >= 50 ? 'degraded' : 'unhealthy'} (${p.successRate}% success)`}
                        title={`${p.successRate}% success rate`}
                        className={`w-2 h-2 rounded-full ${p.successRate >= 80 ? (isDark ? 'bg-emerald-400' : 'bg-emerald-500') : p.successRate >= 50 ? (isDark ? 'bg-amber-400' : 'bg-amber-500') : (isDark ? 'bg-red-400' : 'bg-red-500')} animate-pulse motion-reduce:animate-none`}
                      />
                    </div>

                    <div className={`text-xl font-bold tabular-nums ${textPrimary}`}>{p.calls}</div>
                    <p className={`text-[11px] mb-3 ${isDark ? 'text-zinc-600' : 'text-slate-500'}`}>calls</p>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px]">
                        <span className={isDark ? 'text-zinc-500' : 'text-slate-600'}>Latency</span>
                        <span className={`font-mono font-medium ${isDark ? 'text-zinc-300' : 'text-slate-800'}`}>{p.avgLatencyMs}ms</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className={isDark ? 'text-zinc-500' : 'text-slate-600'}>Tokens</span>
                        <span className={`font-mono font-medium ${isDark ? 'text-zinc-300' : 'text-slate-800'}`}>{formatTokens(p.totalTokens)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className={isDark ? 'text-zinc-500' : 'text-slate-600'}>Success</span>
                        <span className={`font-mono font-semibold ${p.successRate >= 80 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : (isDark ? 'text-amber-400' : 'text-amber-600')}`}>{p.successRate}%</span>
                      </div>
                    </div>

                    {Object.keys(p.tasks).length > 0 && (
                      <div
                        role="img"
                        aria-label={`Task breakdown: ${Object.entries(p.tasks).map(([t, c]) => `${t} ${c}`).join(', ')}`}
                        className={`mt-3 flex gap-0.5 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}
                      >
                        {Object.entries(p.tasks).map(([task, count]) => (
                          <motion.div
                            key={task}
                            initial={{ width: 0 }}
                            animate={{ width: `${(count / p.calls) * 100}%` }}
                            transition={{ duration: 0.8, delay: 0.6 }}
                            className={`h-full ${TASK_COLORS[task] || 'bg-zinc-500'} first:rounded-l-full last:rounded-r-full`}
                            title={`${task}: ${count}`}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
              </div>
            </BentoTile>
          </BentoGrid>
        </motion.div>
      )}

      {/* ─── ROW 2b.5: Provider router visualization (Tier 3 #10) ─── */}
      {/* Always render: AIProviderRouter has empty-state placeholders for fresh telemetry. */}
      <motion.div {...fadeUp(0.27)}>
        <BentoGrid columns={12} gap="base">
          {/* Orbital tile uses AnimatedGradientBorder instead of BentoTile so the
              accent ring rotates around the diagram — Tier 4 #4 visual hook. */}
          <div className="col-span-12 lg:col-span-5">
            <AnimatedGradientBorder
              radius={16}
              thickness={1.5}
              durationSec={9}
              innerBg="var(--color-surface)"
            >
              <div className="relative overflow-hidden p-6">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    background:
                      'radial-gradient(circle at 0% 0%, var(--color-accent-subtle), transparent 55%)',
                  }}
                />
                <div className="relative">
                  <h3 className={`text-sm font-semibold flex items-center gap-2 mb-2 ${textPrimary}`}>
                    <Cpu className={`w-4 h-4 ${textSecondary}`} /> Routing chain
                  </h3>
                  <p className={`text-[11px] mb-3 ${textMuted}`}>
                    {aiStats && aiStats.totalCalls > 0
                      ? 'Live fallback orbit — primary first, hot-swap on failure.'
                      : 'Idle — diagram lights up once requests start flowing.'}
                  </p>
                  <div className="flex justify-center">
                    <AIProviderRouter providers={aiStats?.providers ?? []} size={260} />
                  </div>
                </div>
              </div>
            </AnimatedGradientBorder>
          </div>
          <BentoTile colSpan={7} pad="lg" static>
            <h3 className={`text-sm font-semibold flex items-center gap-2 mb-3 ${textPrimary}`}>
              <ShieldCheck className={`w-4 h-4 ${textSecondary}`} /> Why this matters
            </h3>
            <ul className={`space-y-2 text-[12.5px] ${textPrimary}`}>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0" style={{ background: 'var(--color-accent)' }} />
                <span><span className="font-semibold">Primary:</span> Gemini handles all text + image + video by default.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0" style={{ background: 'var(--color-accent)' }} />
                <span><span className="font-semibold">Fallback:</span> Grok takes over within milliseconds on Gemini outage or rate-limit.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0" style={{ background: 'var(--color-accent)' }} />
                <span><span className="font-semibold">Tertiary:</span> Kimi for long-context (200k+ tokens) text-only requests.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0" style={{ background: 'var(--color-accent)' }} />
                <span>Per-org budget gate refuses any call that would exceed the monthly cap.</span>
              </li>
            </ul>
          </BentoTile>
        </BentoGrid>
      </motion.div>

      {/* ─── ROW 2c: Token Efficiency ─── */}
      {aiStats && aiStats.tasks.length > 0 && (
        <motion.div {...fadeUp(0.28)} className={`rounded-2xl p-6 ${glassStatic}`}>
          <h3 className={`text-sm font-semibold flex items-center gap-2 mb-5 ${textPrimary}`}>
            <Gauge className={`w-4 h-4 ${textSecondary}`} /> Token Efficiency
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {aiStats.tasks.map((t) => (
              <div key={t.task} className={`rounded-xl p-4 border transition-all duration-200 ${isDark ? 'bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08]' : 'bg-slate-50 border-slate-300 hover:border-slate-400 hover:shadow-sm'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${TASK_COLORS[t.task] || 'bg-zinc-500'}`} aria-hidden="true" />
                  <span className={`text-[11px] font-semibold capitalize ${isDark ? 'text-zinc-400' : 'text-slate-700'}`}>{t.task.replace('_', ' ')}</span>
                </div>
                <div className={`text-lg font-bold tabular-nums ${textPrimary}`}>{formatTokens(t.totalTokens)}</div>
                <div className="flex flex-wrap justify-between gap-2 mt-1">
                  <span className={`text-[11px] ${isDark ? 'text-zinc-600' : 'text-slate-500'}`}>{t.calls} calls</span>
                  <span className={`text-[11px] font-mono ${isDark ? 'text-zinc-600' : 'text-slate-500'}`}>{t.avgLatencyMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─── ROW 3: Platform Mix + Activity + Quick Actions ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Platform breakdown */}
        <motion.div {...fadeUp(0.3)} className="col-span-12 lg:col-span-5">
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                <BarChart3 className={`w-4 h-4 ${textSecondary}`} /> Platform Mix
              </h3>
              <Link to="/calendar" className={`text-[10px] hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer ${textMuted}`}>
                View <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            {loading ? <div className="space-y-4">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-6 w-full" />)}</div> : (() => {
              const platforms = stats?.content.byPlatform || {};
              const total = Object.values(platforms).reduce((a, b) => a + b, 0) || 1;
              const colors: Record<string, string> = {
                Instagram: 'bg-gradient-to-r from-pink-500 to-rose-400', TikTok: 'bg-gradient-to-r from-zinc-400 to-zinc-300',
                LinkedIn: 'bg-gradient-to-r from-blue-500 to-blue-400', X: 'bg-gradient-to-r from-sky-500 to-sky-400',
                Facebook: 'bg-gradient-to-r from-indigo-500 to-indigo-400',
              };
              // Solid dot colors paired with each gradient bar — gives the legend
              // affordance (which color = which platform) without needing a separate
              // legend block.
              const dots: Record<string, string> = {
                Instagram: 'bg-pink-500', TikTok: 'bg-zinc-300',
                LinkedIn: 'bg-blue-500', X: 'bg-sky-500', Facebook: 'bg-indigo-500',
              };
              const entries = Object.entries(platforms).sort(([,a], [,b]) => b - a);
              if (entries.length === 0) return <p className={`text-xs text-center py-6 ${textMuted}`}>{t('page.dashboard.no_posts')}</p>;
              return (
                <div className="space-y-4">
                  {entries.map(([platform, count]) => {
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={platform}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className={`flex items-center gap-2 ${textSecondary}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${dots[platform] || 'bg-amber-500'}`} aria-hidden="true" />
                            {platform}
                          </span>
                          <span className={`flex items-baseline gap-2 tabular-nums`}>
                            <span className={`text-[10px] ${textMuted}`}>{pct}%</span>
                            <span className={`font-semibold ${textPrimary}`}>{count}</span>
                          </span>
                        </div>
                        <div className={`h-2 w-full rounded-full overflow-hidden ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max((count / total) * 100, 8)}%` }}
                            transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
                            className={`h-full rounded-full ${colors[platform] || 'bg-amber-500'}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </motion.div>

        {/* Real activity feed — driven by AuditLog (everything users actually do) */}
        <motion.div {...fadeUp(0.35)} className="col-span-12 lg:col-span-4">
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <h3 className={`text-sm font-semibold flex items-center gap-2 mb-5 ${textPrimary}`}>
              <Clock className={`w-4 h-4 ${textSecondary}`} /> Recent Activity
            </h3>
            {loading || activity === null ? (
              <div className="space-y-4">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : activity.length === 0 ? (
              <p className={`text-xs text-center py-6 ${textMuted}`}>{t('page.dashboard.no_activity_short')}</p>
            ) : (
              <motion.div className="space-y-1" variants={{ animate: { transition: { staggerChildren: 0.04 } } }} initial="initial" animate="animate">
                {activity.slice(0, 6).map((entry) => {
                  const desc = describeActivity(entry);
                  const Icon = desc.icon;
                  const inner = (
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isDark ? 'bg-white/[0.04] group-hover:bg-white/[0.08]' : 'bg-slate-100 group-hover:bg-slate-200'}`}>
                        <Icon className={`w-4 h-4 ${desc.color(isDark)}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate transition-colors ${isDark ? 'text-zinc-300 group-hover:text-white' : 'text-slate-800 group-hover:text-slate-900'}`}>{desc.label}</p>
                        <p className={`text-[10px] ${textMuted}`}>{getRelativeTime(entry.createdAt)}</p>
                      </div>
                    </div>
                  );
                  return (
                    <motion.div key={entry.id} variants={{ initial: { opacity: 0, x: -6 }, animate: { opacity: 1, x: 0 } }}>
                      {desc.href ? (
                        <Link to={desc.href} className={`block p-3 rounded-xl transition-all duration-200 cursor-pointer group ${isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50'}`}>
                          {inner}
                        </Link>
                      ) : (
                        <div className={`p-3 rounded-xl ${isDark ? '' : ''}`}>{inner}</div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div {...fadeUp(0.4)} className="col-span-12 lg:col-span-3 flex flex-col gap-3">
          {[
            { label: 'Get Started', href: '/onboarding', icon: Sparkles, desc: 'Onboarding steps', color: isDark ? 'text-emerald-400' : 'text-emerald-700', bg: isDark ? 'bg-emerald-500/10' : 'bg-emerald-100', ring: 'group-hover:ring-emerald-500/30' },
            { label: 'Review Content', href: '/content-review', icon: Layers, desc: 'Approve pieces', color: isDark ? 'text-purple-400' : 'text-purple-700', bg: isDark ? 'bg-purple-500/10' : 'bg-purple-100', ring: 'group-hover:ring-purple-500/30' },
            { label: 'Calendar', href: '/calendar', icon: Calendar, desc: 'View schedule', color: isDark ? 'text-blue-400' : 'text-blue-700', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-100', ring: 'group-hover:ring-blue-500/30' },
            { label: 'Creative Tools', href: '/creative', icon: Wand2, desc: 'Generate visuals', color: isDark ? 'text-amber-400' : 'text-amber-700', bg: isDark ? 'bg-amber-500/10' : 'bg-amber-100', ring: 'group-hover:ring-amber-500/30' },
          ].map((action) => (
            <Link
              key={action.label}
              to={action.href}
              className={`flex items-center gap-3 rounded-2xl p-4 group transition-all duration-200 cursor-pointer flex-1 ${glass}`}
            >
              <div className={`w-11 h-11 rounded-xl ${action.bg} flex items-center justify-center shrink-0 ring-1 ring-transparent ${action.ring} transition-all duration-200`}>
                <action.icon className={`w-5 h-5 ${action.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold transition-colors ${isDark ? 'text-zinc-200 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-900'}`}>{action.label}</p>
                <p className={`text-[11px] ${textMuted}`}>{action.desc}</p>
              </div>
              <ArrowRight className={`w-3.5 h-3.5 transition-all duration-200 group-hover:translate-x-0.5 ${isDark ? 'text-zinc-700 group-hover:text-zinc-400' : 'text-slate-300 group-hover:text-slate-500'}`} />
            </Link>
          ))}
        </motion.div>
      </div>

      {/* ─── ROW 4: Client Overview ─── */}
      {clients.length > 0 && (
        <motion.div {...fadeUp(0.45)}>
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                <Users className={`w-4 h-4 ${textSecondary}`} /> Clients
              </h3>
              <Link to="/clients" className={`text-[10px] hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer ${textMuted}`}>
                Manage <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {clients.slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  to={`/calendar?client=${c.id}`}
                  className={`rounded-xl p-4 transition-all duration-200 cursor-pointer group ${isDark ? 'bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.04]' : 'bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-white'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold ${isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                      {c.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate transition-colors ${isDark ? 'text-zinc-200 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-900'}`}>{c.name}</p>
                      <p className={`text-[10px] ${textMuted}`}>{c.industry || 'No industry set'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && clients.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title={t('page.dashboard.no_clients_title')}
          description={t('page.dashboard.no_clients_body')}
          primary={
            <Link
              to="/clients"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer"
              style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
            >
              <Users className="w-4 h-4" /> Add Client
            </Link>
          }
        />
      )}

      {/* ─── Visual Showcase + Trend ─── */}
      {insights && (insights.visualShowcase.length > 0 || insights.trends.last7Days > 0) && (
        <motion.div {...fadeUp(0.48)}>
          <div className="grid grid-cols-12 gap-5">

            {/* Visual Showcase — 8 most recent assets */}
            {insights.visualShowcase.length > 0 && (
              <div className={`col-span-12 ${insights.trends.last7Days > 0 ? 'lg:col-span-8' : ''} rounded-2xl p-6 ${glassStatic}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                    <ImageIcon className={`w-4 h-4 ${textSecondary}`} /> Recent Creations
                  </h3>
                  <Link to="/gallery" className={`text-[10px] hover:text-amber-500 transition-colors flex items-center gap-1 cursor-pointer ${textMuted}`}>
                    Open Gallery <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                  {insights.visualShowcase.map((asset, i) => {
                    const isVideo = asset.mimeType.startsWith('video/');
                    return (
                      <Link
                        key={asset.id}
                        to="/gallery"
                        className={`relative aspect-square rounded-lg overflow-hidden border group cursor-pointer transition-all ${isDark ? 'border-white/[0.06] hover:border-white/[0.15]' : 'border-slate-200 hover:border-slate-400 hover:shadow-md'}`}
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        {isVideo ? (
                          <>
                            <video src={asset.fileUrl} className="w-full h-full object-cover bg-black" preload="metadata" muted />
                            <div className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/70 backdrop-blur-sm">
                              <VideoIcon className="w-2.5 h-2.5 text-white" />
                            </div>
                          </>
                        ) : (
                          <img src={asset.thumbUrl || asset.fileUrl} alt={asset.name} loading="lazy" className="w-full h-full object-cover" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        {asset.clientName && (
                          <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-[9px] text-white font-semibold truncate">{asset.clientName}</p>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trend card — 30-day sparkline */}
            {insights.trends.last7Days > 0 && (
              <div className={`col-span-12 ${insights.visualShowcase.length > 0 ? 'lg:col-span-4' : ''} rounded-2xl p-6 ${glassStatic}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                    <TrendingUp className={`w-4 h-4 ${textSecondary}`} /> Activity Trend
                  </h3>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>30d</span>
                </div>
                <div className="flex items-baseline gap-3 mb-4">
                  <div className={`text-3xl font-black tabular-nums ${textPrimary}`}>
                    <AnimatedNumber value={insights.trends.last7Days} />
                  </div>
                  <div className="flex items-center gap-1">
                    {insights.trends.postsTrend >= 0 ? (
                      <TrendingUp className={`w-3.5 h-3.5 ${insights.trends.postsTrend > 0 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : textMuted}`} />
                    ) : (
                      <TrendingDown className={`w-3.5 h-3.5 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
                    )}
                    <span className={`text-xs font-semibold ${insights.trends.postsTrend > 0 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : insights.trends.postsTrend < 0 ? (isDark ? 'text-red-400' : 'text-red-600') : textMuted}`}>
                      {insights.trends.postsTrend > 0 ? '+' : ''}{insights.trends.postsTrend}%
                    </span>
                  </div>
                </div>
                <p className={`text-[11px] ${textMuted} mb-3`}>Posts in last 7 days vs prior 7</p>
                <div className="w-full">
                  <Sparkline
                    data={insights.trends.sparkline.map(d => d.posts)}
                    color={isDark ? '#a78bfa' : '#7c3aed'}
                    height={40}
                    width={300}
                  />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── Walkthrough / How It Works ─── */}
      <WalkthroughSection isDark={isDark} glass={glass} glassStatic={glassStatic} textPrimary={textPrimary} textSecondary={textSecondary} textMuted={textMuted} />
    </div>
  );
}
