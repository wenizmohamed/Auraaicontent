/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { HashRouter, BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { ClientProvider, useClients } from './lib/client-context';
import { readJson } from './lib/safe-storage';

// Use HashRouter for Electron (file:// protocol), BrowserRouter for web
const isElectron = !!window.electron?.isDesktop;
const Router = isElectron ? HashRouter : BrowserRouter;
import { StoreProvider, useStore } from './lib/store';
import { LayoutDashboard, Calendar, ImagePlus, Image as ImageIcon, Video, Search, UserCircle, ChevronLeft, ChevronRight, FileText, Palette, Layers, Wand2, FolderOpen, Radio, Building2, AlertCircle } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ContentCalendar from './pages/ContentCalendar';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import VideoAnalysis from './pages/VideoAnalysis';
import Research from './pages/Research';
import Profile from './pages/Profile';
import Studio from './pages/Studio';
import RadixAssistant from './pages/RadixAssistant';
import TopicDesk from './pages/TopicDesk';
import DesignTextures from './pages/DesignTextures';
import ContentPieces from './pages/ContentPieces';
import Knowledge from './pages/Knowledge';
import AIDesignGenerator from './pages/AIDesignGenerator';
import VisualReferences from './pages/VisualReferences';
import BriefInput from './pages/BriefInput';
import ContentReview from './pages/ContentReview';
import Clients from './pages/Clients';
import CreativeTools from './pages/CreativeTools';
import { ThemeProvider, useTheme } from './lib/theme-context';
import { ToastProvider } from './lib/toast-context';
import { Sun, Moon } from 'lucide-react';

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { generatedImages, isLoading, error } = useStore();
  const { theme, toggleTheme } = useTheme();
  

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Clients', href: '/clients', icon: Building2 },
    { name: 'New Brief', href: '/brief', icon: FileText },
    { name: 'Review', href: '/content-review', icon: Layers },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Creative Tools', href: '/creative', icon: Wand2 },
  ];

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen flex font-sans ${isDark ? 'bg-[#050508]' : 'bg-slate-100'}`}>
      {/* Sidebar — Glassmorphic */}
      <div
        className={`${isCollapsed ? 'w-[72px]' : 'w-[260px]'} ${
          isDark
            ? 'bg-[#0a0a0f]/80 backdrop-blur-2xl border-r border-white/[0.06]'
            : 'bg-white/80 backdrop-blur-2xl border-r border-slate-200/80 shadow-lg'
        } flex flex-col transition-all duration-300 relative z-20`}
      >
        {/* Collapse Toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`absolute -right-3 top-7 z-30 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg ${
            isDark ? 'bg-zinc-800 border border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white' : 'bg-white border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
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

        {/* Bottom: Theme + Profile */}
        <div className={`p-3 border-t space-y-1 ${isDark ? 'border-white/[0.06]' : 'border-slate-200/60'}`}>
          {/* Theme Toggle — Pill Switch */}
          <button
            onClick={toggleTheme}
            className={`flex items-center w-full ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
              isDark ? 'hover:bg-white/[0.04] text-zinc-500 hover:text-zinc-300' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
            }`}
          >
            <div className={`relative w-9 h-5 rounded-full transition-colors duration-300 ${isDark ? 'bg-zinc-800' : 'bg-amber-100'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 flex items-center justify-center ${isDark ? 'left-0.5 bg-zinc-600' : 'left-[18px] bg-amber-500'}`}>
                {isDark ? <Moon size={10} className="text-zinc-300" /> : <Sun size={10} className="text-white" />}
              </div>
            </div>
            {!isCollapsed && <span className="text-[13px]">{isDark ? 'Dark' : 'Light'}</span>}
          </button>

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
        
        {/* Global Floating Chat Widget */}
        <RadixAssistant />
      </div>
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
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-zinc-900/95 border-t border-zinc-800 px-4 py-1.5 flex items-center gap-4 text-[10px] font-mono text-zinc-500">
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
    return <Login />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <StoreProvider>
      <ClientProvider>
      <Router>
        <AuthGate>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
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
              <Route path="/video" element={<VideoAnalysis />} />
              <Route path="/research" element={<Research />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/onboarding" element={<Onboarding />} />
            </Routes>
          </Layout>
        </AuthGate>
      </Router>
      <DevBanner />
      </ClientProvider>
    </StoreProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
