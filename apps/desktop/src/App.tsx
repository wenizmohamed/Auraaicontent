/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { HashRouter, BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';

// Use HashRouter for Electron (file:// protocol), BrowserRouter for web
const isElectron = !!(window as any).electron?.isDesktop;
const Router = isElectron ? HashRouter : BrowserRouter;
import { StoreProvider, useStore } from './lib/store';
import { LayoutDashboard, Calendar, ImagePlus, Image as ImageIcon, Video, Search, UserCircle, ChevronLeft, ChevronRight, FileText, Palette, Layers, Wand2, FolderOpen, Radio } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ContentCalendar from './pages/ContentCalendar';
import ImageGeneration from './pages/ImageGeneration';
import ImageEditing from './pages/ImageEditing';
import VideoAnalysis from './pages/VideoAnalysis';
import Research from './pages/Research';
import Profile from './pages/Profile';
import Studio from './pages/Studio';
import RadixAssistant from './pages/RadixAssistant';
import TopicDesk from './pages/TopicDesk';
import DesignTextures from './pages/DesignTextures';
import ContentPieces from './pages/ContentPieces';
import AIDesignGenerator from './pages/AIDesignGenerator';
import VisualReferences from './pages/VisualReferences';
import BriefInput from './pages/BriefInput';
import ContentReview from './pages/ContentReview';

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { generatedImages, isLoading, error } = useStore();
  

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'New Brief', href: '/brief', icon: FileText },
    { name: 'Review', href: '/content-review', icon: Layers },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Creative Tools', href: '/image-gen', icon: Wand2 },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 flex font-sans">
      {/* Sidebar */}
      <div 
        className={`${
          isCollapsed ? 'w-20' : 'w-64'
        } bg-[#050505] border-r border-white/5 flex flex-col transition-all duration-300 relative z-20 shadow-xl`}
      >
        {/* Toggle Button */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-6 bg-[#1a1a1a] border border-white/10 text-zinc-400 rounded-full p-1 hover:text-white hover:bg-white/10 transition-colors shadow-lg z-30"
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {/* Logo Area */}
        <div className={`h-20 flex items-center justify-center border-b border-white/5 ${isCollapsed ? 'px-2' : 'px-5'}`}>
          {isCollapsed ? (
            <img src="/radix-logo.jpg" alt="Radix" className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="flex items-center gap-3">
              <img src="/radix-logo.jpg" alt="Radix" className="w-10 h-10 rounded-lg object-cover" />
              <div>
                <span className="text-xl font-black tracking-[0.25em] text-white uppercase" style={{ fontFamily: "'Inter', sans-serif" }}>
                  RADIX
                </span>
                <div className="text-[9px] font-medium text-zinc-500 uppercase tracking-[0.2em]">
                  AI Content Planner
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 relative overflow-hidden ${
                  isActive 
                    ? 'text-white bg-white/10' 
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                } ${isCollapsed ? 'justify-center px-0' : ''}`}
                title={isCollapsed ? item.name : undefined}
              >
                {/* Active Indicator */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r-full" />
                )}

                <item.icon className={`${isCollapsed ? '' : 'mr-3'} h-5 w-5 transition-colors duration-200 ${isActive ? 'text-white' : 'group-hover:text-zinc-300'}`} />
                
                {!isCollapsed && <span className="flex-1">{item.name}</span>}
                
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="p-4 border-t border-white/5">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer`}>
            <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center text-white font-bold shrink-0">
              MS
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">Mohamed S.</p>
                <p className="text-xs text-zinc-500 truncate">Radix Media</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-[#0a0a0a]">
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

export default function App() {
  return (
    <StoreProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/brief" element={<BriefInput />} />
            <Route path="/content-review" element={<ContentReview />} />
            <Route path="/topics" element={<TopicDesk />} />
            <Route path="/textures" element={<DesignTextures />} />
            <Route path="/calendar" element={<ContentCalendar />} />
            <Route path="/image-gen" element={<ImageGeneration />} />
            <Route path="/image-edit" element={<ImageEditing />} />
            <Route path="/pieces" element={<ContentPieces />} />
            <Route path="/ai-design" element={<AIDesignGenerator />} />
            <Route path="/references" element={<VisualReferences />} />
            <Route path="/video" element={<VideoAnalysis />} />
            <Route path="/research" element={<Research />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </Layout>
      </Router>
    </StoreProvider>
  );
}
