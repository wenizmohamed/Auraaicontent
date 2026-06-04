import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';

// Theme: what the USER chose. Includes 'auto' which resolves at render.
export type Theme = 'auto' | 'dark' | 'light' | 'studio';
// Effective theme: what's actually applied to the DOM. No 'auto'.
export type EffectiveTheme = 'dark' | 'light' | 'studio';

interface ThemeContextType {
  /** The user's saved preference (may be 'auto'). */
  theme: Theme;
  /** What's actually applied right now ('auto' resolved to dark|light). */
  effectiveTheme: EffectiveTheme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'auto',
  effectiveTheme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

const VALID: Theme[] = ['auto', 'dark', 'light', 'studio'];

/**
 * Resolve 'auto' to a concrete theme using two signals:
 *   1. window.matchMedia('(prefers-color-scheme: dark|light)') if the user
 *      has expressed an OS preference — this is the modern standard.
 *   2. If matchMedia is unknown or `no-preference`, fall back to time-of-day:
 *      light from 06:00-18:00 local, dark otherwise. Catches users on older
 *      OSes / browsers that don't surface the scheme preference.
 *
 * 'studio' is never auto-selected — it's an opt-in monochrome mode for
 * design work.
 */
function resolveAuto(): EffectiveTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (mql.media !== 'not all') {
    // Browser supports the media query — trust the OS.
    return mql.matches ? 'dark' : 'light';
  }
  // Time-of-day fallback.
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('radix_theme');
      if (saved && (VALID as string[]).includes(saved)) return saved as Theme;
    } catch { /* ssr / locked storage */ }
    // New users start in auto so the app matches their OS out of the box.
    return 'auto';
  });

  const [autoResolved, setAutoResolved] = useState<EffectiveTheme>(() => resolveAuto());

  // Subscribe to OS preference changes ONLY while in auto mode.
  useEffect(() => {
    if (theme !== 'auto') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setAutoResolved(resolveAuto());
    // Compat: older Safari uses addListener
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if ((mql as any).addListener) (mql as any).addListener(onChange);
    // Also re-poll hourly to handle the time-of-day fallback rollover at 6/18.
    const t = setInterval(() => setAutoResolved(resolveAuto()), 60 * 60 * 1000);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else if ((mql as any).removeListener) (mql as any).removeListener(onChange);
      clearInterval(t);
    };
  }, [theme]);

  const effectiveTheme: EffectiveTheme = useMemo(() =>
    theme === 'auto' ? autoResolved : theme
  , [theme, autoResolved]);

  const firstThemeRun = useRef(true);
  useEffect(() => {
    try { localStorage.setItem('radix_theme', theme); } catch { /* ignore */ }
    const root = document.documentElement;
    // Smooth cross-fade on theme change; skip the initial mount so first paint is instant.
    let clear: number | undefined;
    if (!firstThemeRun.current) {
      root.classList.add('theme-switching');
      clear = window.setTimeout(() => root.classList.remove('theme-switching'), 360);
    } else {
      firstThemeRun.current = false;
    }
    root.classList.toggle('light', effectiveTheme === 'light');
    root.classList.toggle('dark', effectiveTheme === 'dark');
    root.classList.toggle('theme-studio', effectiveTheme === 'studio');
    // Tag the choice so CSS can react to auto-vs-manual if it wants.
    root.dataset.themeMode = theme;
    return () => { if (clear) window.clearTimeout(clear); };
  }, [theme, effectiveTheme]);

  // Cycle: auto → dark → light → studio → auto
  const toggleTheme = () => setThemeState(prev =>
    prev === 'auto' ? 'dark' :
    prev === 'dark' ? 'light' :
    prev === 'light' ? 'studio' : 'auto'
  );
  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
