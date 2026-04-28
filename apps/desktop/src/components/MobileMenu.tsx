import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Moon, Sun } from 'lucide-react';

export type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

interface MobileMenuProps {
  navigation: NavItem[];
  isDark: boolean;
  toggleTheme: () => void;
}

// Mobile-only sidebar drawer.  Desktop sidebar (>= lg breakpoint) lives in App.tsx.
// This drawer is invisible on lg+ via the `lg:hidden` on the trigger button.
export default function MobileMenu({ navigation, isDark, toggleTheme }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Close on route change so navigating from a nav link dismisses the drawer.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close on ESC + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Focus the close button on open for keyboard users.
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — visible only below lg breakpoint */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        className={`lg:hidden fixed top-4 left-4 z-sticky w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer transition-all ${
          isDark
            ? 'bg-zinc-900/85 backdrop-blur-md border border-white/10 text-white hover:bg-zinc-800'
            : 'bg-white/90 backdrop-blur-md border border-slate-200 text-slate-900 hover:bg-slate-50 shadow-md'
        }`}
      >
        <Menu className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="lg:hidden fixed inset-0 z-modal-backdrop bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.aside
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className={`relative h-full w-[260px] flex flex-col z-modal ${
                isDark
                  ? 'bg-[#0a0a0f] border-r border-white/[0.06]'
                  : 'bg-white border-r border-slate-200'
              }`}
            >
              {/* Brand row + close button */}
              <div className={`h-[72px] flex items-center justify-between px-5 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'}`}>
                <div className="flex items-center gap-3">
                  <img src="/radix-logo.jpg" alt="Radix" className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10" />
                  <div>
                    <span className={`text-base font-black tracking-[0.3em] uppercase ${isDark ? 'text-white' : 'text-slate-900'}`}>RADIX</span>
                    <div className={`text-[9px] font-semibold uppercase tracking-[0.2em] ${isDark ? 'text-amber-500/70' : 'text-amber-600/70'}`}>
                      AI Content Planner
                    </div>
                  </div>
                </div>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                    isDark ? 'text-zinc-400 hover:text-white hover:bg-white/[0.06]' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Nav links */}
              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`group flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all relative ${
                        active
                          ? isDark
                            ? 'bg-white/[0.08] text-white shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]'
                            : 'bg-amber-50 text-slate-900 shadow-sm'
                          : isDark
                            ? 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-amber-500" />
                      )}
                      <Icon className={`h-[18px] w-[18px] ${active ? 'text-amber-400' : ''}`} />
                      <span className="flex-1">{item.name}</span>
                    </Link>
                  );
                })}
              </nav>

              {/* Theme toggle pinned to bottom */}
              <div className={`p-3 border-t ${isDark ? 'border-white/[0.06]' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isDark ? 'hover:bg-white/[0.04] text-zinc-400 hover:text-zinc-200' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <div className={`relative w-9 h-5 rounded-full transition-colors duration-300 ${isDark ? 'bg-zinc-800' : 'bg-amber-100'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 flex items-center justify-center ${isDark ? 'left-0.5 bg-zinc-600' : 'left-[18px] bg-amber-500'}`}>
                      {isDark ? <Moon size={10} className="text-zinc-300" /> : <Sun size={10} className="text-white" />}
                    </div>
                  </div>
                  <span className="text-sm">{isDark ? 'Dark mode' : 'Light mode'}</span>
                </button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
