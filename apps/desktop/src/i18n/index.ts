// i18n bootstrap. Wired by main.tsx after Phase 3 install of i18next +
// react-i18next. Until those packages are installed this file compiles
// to a no-op shim so the rest of the app builds.
//
// Activate:
//   npm install i18next react-i18next i18next-browser-languagedetector
//   import './i18n' in main.tsx before <App />

import enResources from './en.json';
import arResources from './ar.json';

type Translations = Record<string, string>;
const RESOURCES: Record<'en' | 'ar', Translations> = {
  en: enResources as Translations,
  ar: arResources as Translations,
};

let activeLocale: 'en' | 'ar' = 'en';

export function setLocale(locale: 'en' | 'ar') {
  activeLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }
  try { localStorage.setItem('radix.locale', locale); } catch { /* ssr */ }
}

export function getLocale(): 'en' | 'ar' {
  return activeLocale;
}

export function t(key: string): string {
  return RESOURCES[activeLocale][key] ?? RESOURCES.en[key] ?? key;
}

// Initialize from localStorage on module load (client-side only).
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('radix.locale') as 'en' | 'ar' | null;
    if (saved === 'ar' || saved === 'en') setLocale(saved);
  } catch { /* localStorage unavailable */ }
}
