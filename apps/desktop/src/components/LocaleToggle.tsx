// EN ↔ AR locale toggle. Updates document.documentElement.dir + lang
// and persists the choice in localStorage. Reload picks up the new
// dir on first paint, but most components react to it on the fly via
// CSS logical properties (when present).

import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { setLocale as setI18nLocale, getLocale } from '../i18n';

interface Props { collapsed: boolean }

type Locale = 'en' | 'ar';

export default function LocaleToggle({ collapsed }: Props) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    setLocale(getLocale());
  }, []);

  function toggle() {
    const next: Locale = locale === 'en' ? 'ar' : 'en';
    // Cinematic AR↔EN flip — wedge made visible. The CSS class triggers a
    // 360ms scaleX horizontal flip on <body>; we kick the locale change at
    // mid-flip (180ms) so the reload's blank-frame falls inside the
    // animation, then the new layout settles into the second half.
    document.body.classList.add('locale-flipping');
    setLocale(next);
    setTimeout(() => {
      setI18nLocale(next);
      window.location.reload();
    }, 180);
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center w-full ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
        isDark ? 'hover:bg-white/[0.04] text-zinc-500 hover:text-zinc-300' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
      }`}
      title={collapsed ? `Switch to ${locale === 'en' ? 'Arabic' : 'English'}` : undefined}
    >
      <div className={`relative w-9 h-5 rounded-full transition-colors duration-300 ${isDark ? 'bg-zinc-800' : 'bg-amber-100'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 flex items-center justify-center ${
          locale === 'ar' ? 'left-[18px] bg-amber-500' : 'left-0.5 bg-zinc-600'
        }`}>
          <Languages size={10} className="text-white" />
        </div>
      </div>
      {!collapsed && <span className="text-[13px] uppercase tracking-wider">{locale === 'en' ? 'English' : 'العربية'}</span>}
    </button>
  );
}
