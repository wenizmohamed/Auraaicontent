/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter, BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { ClientProvider, useClients } from './lib/client-context';
import { readJson } from './lib/safe-storage';

// Use HashRouter for Electron (file:// protocol), BrowserRouter for web
const isElectron = !!window.electron?.isDesktop;
const Router = isElectron ? HashRouter : BrowserRouter;
import { StoreProvider, useStore } from './lib/store';
import { LayoutDashboard, Calendar, ImagePlus, Image as ImageIcon, Video, Search, UserCircle, ChevronLeft, ChevronRight, FileText, Palette, Layers, Wand2, FolderOpen, Radio, Building2, AlertCircle } from 'lucide-react';

// Phase 8.1 — every page lazy-loaded into its own chunk, prefetched on
// hover later. Cuts the initial bundle from ~1MB to ~250KB gzipped.
const Dashboard         = lazy(() => import('./pages/Dashboard'));
const ContentCalendar   = lazy(() => import('./pages/ContentCalendar'));
const Login             = lazy(() => import('./pages/Login'));
const Onboarding        = lazy(() => import('./pages/Onboarding'));
const VideoAnalysis     = lazy(() => import('./pages/VideoAnalysis'));
const Research          = lazy(() => import('./pages/Research'));
const Profile           = lazy(() => import('./pages/Profile'));
const Studio            = lazy(() => import('./pages/Studio'));
const RadixAssistant    = lazy(() => import('./pages/RadixAssistant'));
const TopicDesk         = lazy(() => import('./pages/TopicDesk'));
const DesignTextures    = lazy(() => import('./pages/DesignTextures'));
const ContentPieces     = lazy(() => import('./pages/ContentPieces'));
const Knowledge         = lazy(() => import('./pages/Knowledge'));
const AIDesignGenerator = lazy(() => import('./pages/AIDesignGenerator'));
const VisualReferences  = lazy(() => import('./pages/VisualReferences'));
const Gallery           = lazy(() => import('./pages/Gallery'));
const BriefInput        = lazy(() => import('./pages/BriefInput'));
const ContentReview     = lazy(() => import('./pages/ContentReview'));
const Clients           = lazy(() => import('./pages/Clients'));
const CreativeTools     = lazy(() => import('./pages/CreativeTools'));
const Admin             = lazy(() => import('./pages/Admin'));
const Billing           = lazy(() => import('./pages/Billing'));
const Members           = lazy(() => import('./pages/Members'));
const AcceptInvite      = lazy(() => import('./pages/AcceptInvite'));
const Workspace         = lazy(() => import('./pages/Workspace'));
const Agent             = lazy(() => import('./pages/Agent'));

import MobileMenu from './components/MobileMenu';
import OrgSwitcher from './components/OrgSwitcher';
import LocaleToggle from './components/LocaleToggle';
import { ThemeProvider, useTheme } from './lib/theme-context';
import { ToastProvider } from './lib/toast-context';
import { t } from './i18n';
import { Sun, Moon, Sparkles } from 'lucide-react';
import { CommandPalette } from './components/CommandPalette';
import { RouteSkeleton, ShellSkeleton } from './components/RouteSkeleton';
import { ShortcutCheatSheet } from './components/ShortcutCheatSheet';
import { TooltipProvider, Tooltip } from './components/ui/Tooltip';
import { useShortcut } from './lib/shortcuts';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';

// Email allowlist for the Team page (mirrors server-side TEAM_ADMIN_EMAILS).
// Anyone not listed here doesn't see the nav item AND gets bounced from the
// route — the backend enforces this independently, so client-side hiding is
// strictly UX (not a security boundary).
const TEAM_ADMIN_EMAILS = ['weni.mohamed@gmail.com'];

function getCallerEmail(): string | null {
  try {
    const tok = localStorage.getItem('radix_auth_token');
    if (!tok) return null;
    return JSON.parse(atob(tok.split('.')[1])).email ?? null;
  } catch { return null; }
}
function isTeamAdmin(): boolean {
  const e = getCallerEmail();
  return !!e && TEAM_ADMIN_EMAILS.includes(e.toLowerCase());
}

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { generatedImages, isLoading, error } = useStore();
  const { theme, toggleTheme } = useTheme();
  const showTeam = isTeamAdmin();
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Onboarding tour — fires once per browser per JWT-orgId on first authed
  // visit. Lazy-imported so driver.js stays out of the initial bundle.
  useEffect(() => {
    function decodeOrg(): string | null {
      try {
        const token = localStorage.getItem('radix.access_token');
        if (!token) return null;
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.orgId ?? null;
      } catch { return null; }
    }
    const orgId = decodeOrg();
    if (!orgId) return;
    const t = setTimeout(() => {
      import('./lib/onboarding-tour').then(({ runOnboardingTour }) => {
        runOnboardingTour({ orgId });
      }).catch(() => { /* ignore */ });
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  // Central keyboard shortcuts — discoverable via "?" cheat sheet.
  useShortcut({
    id: 'palette.open',
    keys: 'mod+k',
    label: 'Open command palette',
    group: 'General',
    allowInInputs: true,
    onTrigger: () => setCmdkOpen(true),
  });
  useShortcut({
    id: 'sidebar.toggle',
    keys: 'mod+b',
    label: 'Toggle sidebar',
    group: 'View',
    onTrigger: () => setIsCollapsed(c => !c),
  });
  useShortcut({
    id: 'theme.cycle',
    keys: 'mod+shift+l',
    label: 'Cycle theme (dark / light / studio)',
    group: 'Theme',
    onTrigger: () => toggleTheme(),
  });

  const navigation: { name: string; href: string; icon: any; prefetch?: () => Promise<unknown> }[] = [
    { name: t('nav.dashboard'), href: '/',                     icon: LayoutDashboard, prefetch: () => import('./pages/Dashboard') },
    { name: t('nav.workspace'), href: '/workspace/content',    icon: Layers,          prefetch: () => import('./pages/Workspace') },
    { name: t('nav.clients'),   href: '/clients',              icon: Building2,       prefetch: () => import('./pages/Clients') },
    { name: t('nav.brief'),     href: '/brief',                icon: FileText,        prefetch: () => import('./pages/BriefInput') },
    { name: t('nav.review'),    href: '/content-review',       icon: Layers,          prefetch: () => import('./pages/ContentReview') },
    { name: t('nav.calendar'),  href: '/calendar',             icon: Calendar,        prefetch: () => import('./pages/ContentCalendar') },
    { name: t('nav.creative'),  href: '/creative',             icon: Wand2,           prefetch: () => import('./pages/CreativeTools') },
    { name: t('nav.gallery'),   href: '/gallery',              icon: ImageIcon,       prefetch: () => import('./pages/Gallery') },
    ...(showTeam ? [{ name: t('nav.members'), href: '/settings/members', icon: UserCircle, prefetch: () => import('./pages/Members') }] : []),
    { name: t('nav.billing'),   href: '/settings/billing',     icon: UserCircle,      prefetch: () => import('./pages/Billing') },
  ];

  // Studio is a dark high-contrast palette; treat it as "dark chrome" for layout ternaries.
  const isDark = theme !== 'light';
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Studio';

  return (
    <div className={`min-h-screen flex font-sans ${isDark ? 'bg-[#050508]' : 'bg-slate-100'}`}>
      {/* Mobile drawer — hamburger + slide-in nav, hidden on lg+ */}
      <MobileMenu navigation={navigation} isDark={isDark} toggleTheme={toggleTheme} />

      {/* Sidebar — Glassmorphic, desktop only (lg+) */}
      <div
        className={`${isCollapsed ? 'w-[72px]' : 'w-[260px]'} ${
          isDark
            ? 'bg-[#0a0a0f]/80 backdrop-blur-2xl border-r border-white/[0.06]'
            : 'bg-white/80 backdrop-blur-2xl border-r border-slate-200/80 shadow-lg'
        } hidden lg:flex flex-col transition-all duration-300 relative z-sticky`}
      >
        {/* Collapse Toggle */}
        <Tooltip content={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} shortcut="⌘B" side="right">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`absolute -right-3 top-7 z-30 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg ${
              isDark ? 'bg-zinc-800 border border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white' : 'bg-white border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </Tooltip>

        {/* Logo */}
        <div className={`h-[72px] flex items-center ${isCollapsed ? 'justify-center px-2' : 'px-5'} border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200/60'}`}>
          {isCollapsed ? (
            <img src="/radix-logo.jpg" alt="Radix" className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10" />
          ) : (
            <div className="flex items-center gap-3">
              <img src="/radix-logo.jpg" alt="Radix" className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10" />
              <div>
                <span className={`text-lg font-black tracking-[0.3em] uppercase ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  RADIX
                </span>
                <div className={`text-[9px] font-semibold uppercase tracking-[0.2em] ${isDark ? 'text-amber-500/70' : 'text-amber-600/70'}`}>
                  AI Content Planner
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ⌘K trigger — Vercel/Raycast pattern */}
        <div className={`px-3 pt-3 ${isCollapsed ? 'pb-1' : 'pb-2'}`}>
          <button
            type="button"
            onClick={() => setCmdkOpen(true)}
            aria-label={t('cmdk.trigger')}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition-colors cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] hover:bg-white/[0.07] text-zinc-500 hover:text-zinc-200 border border-white/[0.06]'
                : 'bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 border border-slate-200'
            } ${isCollapsed ? 'justify-center' : ''}`}
          >
            <Search size={14} className="shrink-0" />
            {!isCollapsed && (
              <>
                <span className="flex-1 truncate text-left">{t('cmdk.trigger')}</span>
                <kbd className={`hidden md:inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[9px] ${isDark ? 'border-white/10 text-zinc-500' : 'border-slate-300 text-slate-500'}`}>⌘K</kbd>
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                onMouseEnter={() => { item.prefetch?.().catch(() => {}); }}
                onFocus={() => { item.prefetch?.().catch(() => {}); }}
                className={`group flex items-center px-3 py-2.5 text-[13px] font-medium rounded-xl transition-all duration-200 relative cursor-pointer ${
                  isActive
                    ? isDark
                      ? 'text-white bg-white/[0.08] shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]'
                      : 'text-slate-900 bg-amber-50 shadow-sm'
                    : isDark
                      ? 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                } ${isCollapsed ? 'justify-center px-0' : ''}`}
                title={isCollapsed ? item.name : undefined}
              >
                {isActive && (
                  <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full ${isDark ? 'bg-amber-500' : 'bg-amber-500'}`} />
                )}
                <item.icon className={`${isCollapsed ? '' : 'mr-3'} h-[18px] w-[18px] transition-all duration-200 ${
                  isActive ? isDark ? 'text-amber-400' : 'text-amber-600' : isDark ? 'group-hover:text-zinc-300' : 'group-hover:text-slate-700'
                }`} />
                {!isCollapsed && <span className="flex-1">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: Org switcher + Locale + Theme + Profile */}
        <div className={`p-3 border-t space-y-1 ${isDark ? 'border-white/[0.06]' : 'border-slate-200/60'}`}>
          <OrgSwitcher collapsed={isCollapsed} />
          <LocaleToggle collapsed={isCollapsed} />
          {/* Theme Toggle — Pill Switch */}
          <Tooltip content={`Cycle theme · current: ${themeLabel}`} shortcut="⌘⇧L" side="right" enabled={isCollapsed}>
          <button
            onClick={toggleTheme}
            aria-label={`Cycle theme. Current: ${themeLabel}`}
            className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              isDark ? 'hover:bg-white/[0.04] text-zinc-500 hover:text-zinc-300' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
            }`}
          >
            <div className={`relative w-12 h-5 rounded-full transition-colors duration-300 ${theme === 'dark' ? 'bg-zinc-800' : theme === 'studio' ? 'bg-white/10' : 'bg-amber-100'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 flex items-center justify-center ${theme === 'dark' ? 'left-0.5 bg-zinc-600' : theme === 'studio' ? 'left-[14px] bg-white' : 'left-[28px] bg-amber-500'}`}>
                {theme === 'dark' ? <Moon size={10} className="text-zinc-300" /> : theme === 'studio' ? <Sparkles size={10} className="text-black" /> : <Sun size={10} className="text-white" />}
              </div>
            </div>
            {!isCollapsed && <span className="text-[13px]">{themeLabel}</span>}
          </button>
          </Tooltip>

          {/* Profile */}
          <Link to="/profile" className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
            isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-100'
          }`}>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
              isDark ? 'bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-400 ring-1 ring-amber-500/20' : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
            }`}>
              MS
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-medium truncate ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>Mohamed S.</p>
                <p className={`text-[10px] truncate ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>Radix Media</p>
              </div>
            )}
          </Link>
        </div>
      </div>
      
      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden relative ${isDark ? 'bg-[#08080c]' : 'bg-slate-50'}`}>
        <main className="flex-1 overflow-y-auto p-8 relative">
          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                <p className="text-violet-400 font-medium animate-pulse">Loading data...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
              Error: {error}
            </div>
          )}
          {children}
        </main>
        
        {/* Global Floating Chat Widget — lazy + null fallback so it never blocks */}
        <Suspense fallback={null}>
          <RadixAssistant />
        </Suspense>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />

      {/* "?" keyboard shortcut cheat sheet */}
      <ShortcutCheatSheet />

      {/* Sonner toasts — token-aware */}
      <Toaster
        theme={theme === 'light' ? 'light' : 'dark'}
        position="top-right"
        closeButton
        richColors
        toastOptions={{
          style: {
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-fg)',
            borderRadius: '12px',
          },
        }}
      />
    </div>
  );
}

// Unified resolver: env > electron hint > localStorage > same-origin (prod)
// > 127.0.0.1:8080 (dev / fallback).  Was a one-off inline fallback ladder
// that hardcoded 127.0.0.1:8080 into prod bundles → VPS DevTools flooded
// with ERR_CONNECTION_REFUSED (2026-04-23 Weni recording).
import { API_URL } from './lib/api-url';
const BUILD_TIME = new Date().toISOString();
const IS_ELECTRON = !!window.electron?.isDesktop;

function DevBanner() {
  const { serverOnline, authenticated, selectedClientId, authError } = useClients();
  const lastCrash = readJson<any>('radix_last_crash', null);
  const isDev = import.meta.env.DEV;
  const lane = IS_ELECTRON ? 'desktop' : (window.location.hostname === 'localhost' ? 'local_web' : 'vps');
  if (!isDev) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-debug bg-zinc-900/95 border-t border-zinc-800 px-4 py-1.5 flex items-center gap-4 text-[10px] font-mono text-zinc-500">
      <span className="text-violet-400 font-bold">{lane.toUpperCase()}</span>
      <span className={serverOnline ? 'text-emerald-400' : 'text-red-400'}>{serverOnline ? 'API: ON' : 'API: OFF'}</span>
      <span className={authenticated ? 'text-emerald-400' : 'text-red-400'}>{authenticated ? 'AUTH: OK' : 'AUTH: NO'}</span>
      {authError && <span className="text-red-400">ERR: {authError.slice(0, 40)}</span>}
      <span className="text-zinc-600">→ {API_URL}</span>
      <span className="text-zinc-600">client: {selectedClientId?.slice(0, 12) || 'none'}</span>
      <span className="text-zinc-600">route: {location.pathname}</span>
      {lastCrash && <span className="text-orange-400">CRASH: {lastCrash.msg?.slice(0, 40)}</span>}
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading, serverOnline, authError } = useClients();
  const location = useLocation();
  // Invite-acceptance landing renders outside the gated layout — recipients
  // need to see the org/role preview before they're forced through Login.
  if (location.pathname.startsWith('/invite/')) {
    return (
      <Suspense fallback={<ShellSkeleton />}>
        <Routes><Route path="/invite/:token" element={<AcceptInvite />} /></Routes>
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Connecting...</p>
        </div>
      </div>
    );
  }

  if (!serverOnline) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mb-5 shadow-[0_0_40px_-10px_rgba(239,68,68,0.35)]">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Backend offline</h2>
          <p className="text-zinc-500 text-sm mb-6 max-w-sm mx-auto leading-relaxed">
            {authError || 'The Radix backend server is not reachable. Make sure it is running and try again.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white font-medium rounded-xl transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <Suspense fallback={<ShellSkeleton />}>
        <Login />
      </Suspense>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
    <ToastProvider>
    <StoreProvider>
      <ClientProvider>
      <Router>
        <AuthGate>
          <Layout>
            <Suspense fallback={<RouteSkeleton />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              {/* Phase 3 — three-pane workspace shell. Opt-in route during
                  the IA migration; legacy /clients /calendar etc. keep working
                  until each surface is fully ported into the shell. */}
              <Route path="/workspace" element={<Workspace />} />
              <Route path="/workspace/:surface" element={<Workspace />} />
              <Route path="/workspace/:surface/:itemId" element={<Workspace />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/brief" element={<BriefInput />} />
              <Route path="/content-review" element={<ContentReview />} />
              <Route path="/topics" element={<TopicDesk />} />
              <Route path="/textures" element={<DesignTextures />} />
              <Route path="/calendar" element={<ContentCalendar />} />
              <Route path="/creative" element={<CreativeTools />} />
              {/* Legacy routes redirect to the unified Creative Studio */}
              <Route path="/image-gen" element={<Navigate to="/creative?tab=text-to-image" replace />} />
              <Route path="/image-edit" element={<Navigate to="/creative?tab=image-edit" replace />} />
              <Route path="/text-to-video" element={<Navigate to="/creative?tab=text-to-video" replace />} />
              <Route path="/image-to-video" element={<Navigate to="/creative?tab=image-to-video" replace />} />
              <Route path="/pieces" element={<ContentPieces />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/ai-design" element={<AIDesignGenerator />} />
              <Route path="/references" element={<VisualReferences />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/video" element={<VideoAnalysis />} />
              <Route path="/research" element={<Research />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/agent" element={<Agent />} />
              <Route path="/settings/billing" element={<Billing />} />
              <Route path="/settings/members" element={isTeamAdmin() ? <Members /> : <Navigate to="/" replace />} />
              <Route path="/invite/:token" element={<AcceptInvite />} />
              {/* Catch-all → bounce to Dashboard. Beats rendering blank for any
                  typo'd or stale URL (e.g. /dashboard, /home, /admin). */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Layout>
        </AuthGate>
      </Router>
      <DevBanner />
      </ClientProvider>
    </StoreProvider>
    </ToastProvider>
    </TooltipProvider>
    </ThemeProvider>
    </QueryClientProvider>
  );
}
