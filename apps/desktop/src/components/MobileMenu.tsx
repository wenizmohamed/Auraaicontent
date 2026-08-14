import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Moon, Sun, Sparkles, Monitor, Search, ChevronDown, Languages } from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { setLocale as setI18nLocale, getLocale } from '../i18n';

export type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

interface MobileMenuProps {
  navGroups: NavGroup[];
  /** Trigger handler for the ⌘K palette — mobile users tap the search icon. */
  onSearch?: () => void;
}

/**
 * Mobile-only sidebar drawer + top bar (visible below the lg breakpoint).
 * Desktop sidebar lives in App.tsx.
 *
 * Top bar exposes the high-frequency actions (search + theme) so mobile
 * users don't have to open the drawer for them. Drawer renders the new
 * grouped nav (Today / Strategy / Create / Distribute / Settings) to
 * match the desktop IA shipped in 6334cd8.
 */
export default function MobileMenu({ navGroups, onSearch }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const { theme, effectiveTheme, toggleTheme } = useTheme();
  const [locale, setLocale] = useState<'en' | 'ar'>('en');

  useEffect(() => { setLocale(getLocale()); }, []);

  // Close on route change so navigating from a nav link dismisses the drawer.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Close on ESC + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  // Per-group expand state, persisted (matches the desktop sidebar key).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('radix.nav.groups.v1');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { today: true, strategy: true, create: true, distribute: true, settings: true };
  });
  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('radix.nav.groups.v1', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  function toggleLocale() {
    const next: 'en' | 'ar' = locale === 'en' ? 'ar' : 'en';
    setLocale(next);
    setI18nLocale(next);
    window.location.reload();
  }

  // Theme icon for the top-bar quick toggle.
  const ThemeIcon =
    theme === 'auto'   ? Monitor :
    theme === 'dark'   ? Moon :
    theme === 'studio' ? Sparkles :
                         Sun;
  const themeLabel =
    theme === 'auto'   ? `Auto (${effectiveTheme})` :
    theme === 'dark'   ? 'Dark' :
    theme === 'studio' ? 'Studio' :
                         'Light';

  return (
    <>
      {/* Mobile top bar — visible only below lg. Sticky so it stays put
          while scrolling. Includes hamburger, brand, search, theme. */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-sticky h-14 flex items-center gap-2 px-3 border-b backdrop-blur-md"
        style={{
          background: 'color-mix(in oklch, var(--color-bg-elevated) 85%, transparent)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
          style={{ color: 'var(--color-fg)' }}
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link to="/" className="flex items-center gap-2 min-w-0 flex-1">
          <img src="/radix-logo.jpg?v=2" alt="" aria-hidden="true" className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10" />
          <span className="font-display text-sm font-black tracking-[0.22em] uppercase truncate" style={{ color: 'var(--color-fg)' }}>
            AURAAI
          </span>
        </Link>

        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search or run a command"
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <Search className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Cycle theme. Current: ${themeLabel}`}
          title={themeLabel}
          className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          <ThemeIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Spacer so content under the fixed top bar isn't covered */}
      <div className="lg:hidden h-14" aria-hidden="true" />

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
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="relative h-full w-[280px] flex flex-col z-modal border-r"
              style={{
                background: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-fg)',
              }}
            >
              {/* Brand row + close button */}
              <div
                className="h-[72px] flex items-center justify-between px-5 border-b shrink-0"
                style={{ borderColor: 'var(--color-border-subtle)' }}
              >
                <div className="flex items-center gap-3">
                  <img src="/radix-logo.jpg?v=2" alt="" aria-hidden="true" className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10" />
                  <div>
                    <span className="font-display text-base font-black tracking-[0.3em] uppercase" style={{ color: 'var(--color-fg)' }}>AURAAI</span>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--color-accent)' }}>
                      AI Content Planner
                    </div>
                  </div>
                </div>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[color:var(--color-surface-hover)]"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Grouped nav — matches the desktop sidebar */}
              <nav className="flex-1 px-3 py-3 space-y-3 overflow-y-auto" aria-label="Mobile primary">
                {navGroups.map(group => {
                  const isOpen = openGroups[group.id] !== false;
                  return (
                    <div key={group.id}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={isOpen}
                        aria-controls={`mnav-group-${group.id}`}
                        className="group/header flex items-center justify-between w-full px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors hover:text-[color:var(--color-fg)]"
                        style={{ color: 'var(--color-fg-subtle)' }}
                      >
                        <span>{group.label}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'} opacity-60`} />
                      </button>
                      {isOpen && (
                        <div id={`mnav-group-${group.id}`} className="space-y-0.5">
                          {group.items.map(item => {
                            const Icon = item.icon;
                            const active = location.pathname === item.href;
                            return (
                              <Link
                                key={item.name}
                                to={item.href}
                                className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative"
                                style={{
                                  background: active ? 'var(--color-surface-active)' : 'transparent',
                                  color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                                }}
                              >
                                {active && (
                                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ background: 'var(--color-accent)' }} />
                                )}
                                <Icon className="h-[18px] w-[18px]" />
                                <span className="flex-1">{item.name}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>

              {/* Bottom row — locale + theme cycle */}
              <div
                className="p-3 border-t space-y-1 shrink-0"
                style={{ borderColor: 'var(--color-border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={toggleLocale}
                  aria-label={`Switch to ${locale === 'en' ? 'Arabic' : 'English'}`}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  <Languages className="w-4 h-4" />
                  <span className="text-sm">{locale === 'en' ? 'English' : 'العربية'}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={`Cycle theme. Current: ${themeLabel}`}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  <ThemeIcon className="w-4 h-4" style={{ color: theme === 'auto' ? 'var(--color-accent)' : undefined }} />
                  <span className="text-sm">{themeLabel}</span>
                </button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
