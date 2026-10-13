import { StrictMode, Component, type ReactNode } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// i18n self-initializes from localStorage and sets <html lang/dir>. Imported
// here (before <App />) so React mounts with the correct direction already
// applied. Pre-paint sync also lives in index.html for first-frame correctness.
import './i18n';

// Phase 7.1 — runtime a11y audit in dev only. axe-core attaches to React's
// reconciler and logs WCAG violations to the browser console as you click
// through the app. Tree-shaken from prod builds via the import.meta.env.DEV gate.
if (import.meta.env.DEV) {
  import('@axe-core/react').then(({ default: axe }) => {
    axe(React, ReactDOM, 1000);
  }).catch(() => { /* dev-only, fail silent */ });
}

// Global error handlers — catch crashes that happen outside React
window.onerror = (msg, source, line, col, err) => {
  const crash = { msg: String(msg), source, line, col, stack: err?.stack, time: new Date().toISOString() };
  console.error('[CRASH]', crash);
  try { localStorage.setItem('radix_last_crash', JSON.stringify(crash)); } catch {}
};

window.onunhandledrejection = (e) => {
  const crash = { msg: String(e.reason?.message || e.reason), stack: e.reason?.stack, time: new Date().toISOString() };
  console.error('[UNHANDLED REJECTION]', crash);
  try { localStorage.setItem('radix_last_crash', JSON.stringify(crash)); } catch {}
};

// Every page is a lazy chunk and deploys replace dist/ with `rsync --delete`,
// so a tab opened before a deploy can't load the next page it navigates to
// ("Failed to fetch dynamically imported module" / Safari "Importing a module
// script failed") and lands on the crash screen. Reload once onto the new
// build instead. The session flag stops a reload loop if an asset is really
// missing; it clears after a healthy boot so a later deploy is covered too.
const CHUNK_RELOAD_FLAG = 'radix_chunk_reload';
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  } catch { return; }
  event.preventDefault();
  window.location.reload();
});
setTimeout(() => { try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG); } catch { /* noop */ } }, 10_000);

// React Error Boundary
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    const crash = { msg: error.message, stack: error.stack, component: info?.componentStack, time: new Date().toISOString() };
    console.error('[REACT CRASH]', crash);
    try { localStorage.setItem('radix_last_crash', JSON.stringify(crash)); } catch {}
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#0a0a0a', color: '#fff', minHeight: '100vh', padding: 40, fontFamily: 'monospace' }}>
          <h1 style={{ color: '#ef4444', fontSize: 24, marginBottom: 16 }}>App crashed</h1>
          <pre style={{ color: '#f97316', whiteSpace: 'pre-wrap', marginBottom: 24 }}>{this.state.error.message}</pre>
          <pre style={{ color: '#71717a', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 24 }}>{this.state.error.stack}</pre>
          <button
            onClick={() => { localStorage.clear(); location.reload(); }}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
          >
            Clear Storage &amp; Reload
          </button>
          <button
            onClick={() => location.reload()}
            style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', padding: '12px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 14, marginLeft: 12 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
