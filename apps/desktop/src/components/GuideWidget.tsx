// GuideWidget — persistent Jasper-style activation guide.
//
// A floating companion (bottom-left, clear of the RadixAssistant chat widget
// at bottom-right) that opens a "Get started" checklist. Steps are driven by
// real app state where we have a cheap signal (brand count) and by per-org
// localStorage for the rest, with a manual check-off. Includes a one-click
// "Replay product tour" that re-fires the driver.js walkthrough.
//
// Distinct from onboarding-tour.ts: that's a one-time overlay; this is the
// always-available guide users can reopen to see what's left to do.
//
// NOTE: never use the `text-white` utility on solid buttons here — index.css
// has `html.light .text-white { color:#0f172a !important }` which would make
// labels invisible in light mode. Colors are set inline from tokens.

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, X, Check, ChevronRight, RotateCcw, Sparkles,
  Building2, Palette, FileText, Calendar, Plug,
} from 'lucide-react';
import { useClients } from '../lib/client-context';
import { useTheme } from '../lib/theme-context';
import { motionUI } from '../lib/motion';
import { Z } from '../lib/z-index';
import { runOnboardingTour } from '../lib/onboarding-tour';

type StepId = 'brand' | 'brandkit' | 'brief' | 'calendar' | 'connect';

interface Step {
  id: StepId;
  title: string;
  desc: string;
  href: string;
  icon: typeof Building2;
}

const STEPS: Step[] = [
  { id: 'brand',    title: 'Add your first brand',        desc: 'Each client gets its own brief, brand kit & asset library.', href: '/clients',      icon: Building2 },
  { id: 'brandkit', title: 'Set up the Brand Kit',         desc: 'Logos, colors & voice rules — feeds every AI generation.',    href: '/brand-kit',    icon: Palette },
  { id: 'brief',    title: 'Write a brief',                desc: 'Voice, channels, products. Richer brief = smarter output.',   href: '/brief',        icon: FileText },
  { id: 'calendar', title: 'Generate a content calendar',  desc: 'One click → a month of bilingual AR/EN posts.',               href: '/calendar',     icon: Calendar },
  { id: 'connect',  title: 'Connect a platform',           desc: 'Meta, TikTok & LinkedIn — publish on schedule.',              href: '/integrations', icon: Plug },
];

function decodeOrgId(): string {
  try {
    const tok = localStorage.getItem('radix_auth_token');
    if (!tok) return 'default';
    return JSON.parse(atob(tok.split('.')[1])).orgId ?? 'default';
  } catch { return 'default'; }
}

interface GuideState { dismissed: boolean; done: Partial<Record<StepId, boolean>>; }

function loadState(orgId: string): GuideState {
  try {
    const raw = localStorage.getItem(`radix.guide.v1.${orgId}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { dismissed: false, done: {} };
}

export default function GuideWidget() {
  const { clients } = useClients();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';
  const nav = useNavigate();

  const orgId = useMemo(decodeOrgId, []);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<GuideState>(() => loadState(orgId));

  const persist = useCallback((next: GuideState) => {
    setState(next);
    try { localStorage.setItem(`radix.guide.v1.${orgId}`, JSON.stringify(next)); } catch { /* ignore */ }
  }, [orgId]);

  // Real signal: a brand exists → step 1 is genuinely complete. Everything
  // else falls back to the manual/localStorage flag.
  const isDone = useCallback((id: StepId): boolean => {
    if (id === 'brand' && clients.length > 0) return true;
    return !!state.done[id];
  }, [clients.length, state.done]);

  const doneCount = STEPS.filter(s => isDone(s.id)).length;
  const total = STEPS.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  const toggleDone = (id: StepId) => {
    persist({ ...state, done: { ...state.done, [id]: !state.done[id] } });
  };

  const goTo = (id: StepId, href: string) => {
    // Navigating to a step's surface marks it started; we don't auto-complete
    // (honest progress) except where a real signal proves completion.
    nav(href);
    setOpen(false);
  };

  const dismiss = () => { persist({ ...state, dismissed: true }); setOpen(false); };
  const replayTour = () => { setOpen(false); runOnboardingTour({ orgId, force: true }); };

  if (state.dismissed) return null;

  // Tokenized chrome
  const panelBg = 'var(--color-bg-elevated)';
  const border = 'var(--color-border)';
  const fg = 'var(--color-fg)';
  const fgMuted = 'var(--color-fg-muted)';

  return (
    <>
      {/* Launcher — bottom-LEFT so it never collides with the chat widget. */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        transition={motionUI}
        style={{ zIndex: Z.widget }}
        className="fixed bottom-6 right-[5.5rem] w-14 h-14 rounded-full shadow-2xl cursor-pointer grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2"
        title={open ? 'Close guide' : `Get started — ${doneCount}/${total} done`}
        aria-label={open ? 'Close getting-started guide' : `Open getting-started guide, ${doneCount} of ${total} steps complete`}
        aria-expanded={open}
      >
        {/* Progress ring */}
        <svg viewBox="0 0 44 44" className="absolute inset-0 w-full h-full -rotate-90" aria-hidden>
          <circle cx="22" cy="22" r="20" fill="none" stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'} strokeWidth="3" />
          <circle
            cx="22" cy="22" r="20" fill="none"
            stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 20}
            strokeDashoffset={2 * Math.PI * 20 * (1 - doneCount / total)}
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        </svg>
        <span
          className="absolute inset-1 rounded-full grid place-items-center"
          style={{ background: 'linear-gradient(135deg, var(--color-accent-hover), var(--color-accent))' }}
        >
          {allDone
            ? <Sparkles className="w-5 h-5" style={{ color: 'var(--color-fg-on-accent)' }} />
            : <Compass className="w-5 h-5" style={{ color: 'var(--color-fg-on-accent)' }} />}
        </span>
        {/* Remaining-count badge */}
        {!allDone && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center shadow"
            style={{ background: 'var(--color-fg)', color: 'var(--color-bg-elevated)' }}
          >
            {total - doneCount}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={motionUI}
            style={{ zIndex: Z.widgetOpen, background: panelBg, borderColor: border, color: fg }}
            className="fixed bottom-24 right-6 w-[360px] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-8rem)] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            role="dialog"
            aria-label="Getting started guide"
          >
            {/* Header */}
            <div className="p-4 border-b" style={{ borderColor: border }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-[15px] font-bold" style={{ color: fg }}>
                    {allDone ? "You're all set 🎉" : 'Get started with Radix'}
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: fgMuted }}>
                    {allDone ? 'Every setup step is complete.' : `${doneCount} of ${total} steps complete`}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close guide"
                  className="shrink-0 w-7 h-7 grid place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                  style={{ color: fgMuted }}
                >
                  <X size={16} />
                </button>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'var(--color-accent)' }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={motionUI}
                />
              </div>
            </div>

            {/* Steps */}
            <div className="flex-1 overflow-y-auto p-2">
              {STEPS.map((step, i) => {
                const done = isDone(step.id);
                const realLocked = step.id === 'brand' && clients.length > 0; // can't un-check a real signal
                return (
                  <div
                    key={step.id}
                    className="group flex items-start gap-3 p-2.5 rounded-xl transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {/* Check toggle */}
                    <button
                      onClick={() => !realLocked && toggleDone(step.id)}
                      disabled={realLocked}
                      aria-label={done ? `Mark "${step.title}" not done` : `Mark "${step.title}" done`}
                      className="shrink-0 mt-0.5 w-5 h-5 rounded-full grid place-items-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] disabled:cursor-default"
                      style={{
                        background: done ? 'var(--color-accent)' : 'transparent',
                        borderColor: done ? 'var(--color-accent)' : 'var(--color-border-strong)',
                      }}
                    >
                      {done
                        ? <Check size={12} style={{ color: 'var(--color-fg-on-accent)' }} />
                        : <span className="text-[10px] font-bold" style={{ color: fgMuted }}>{i + 1}</span>}
                    </button>

                    {/* Body — clicking navigates to the surface */}
                    <button
                      onClick={() => goTo(step.id, step.href)}
                      className="flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] rounded-lg"
                    >
                      <div className="flex items-center gap-1.5">
                        <step.icon size={13} style={{ color: done ? fgMuted : 'var(--color-accent)' }} />
                        <span
                          className="text-[13px] font-semibold"
                          style={{ color: done ? fgMuted : fg, textDecoration: done ? 'line-through' : 'none' }}
                        >
                          {step.title}
                        </span>
                      </div>
                      <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: fgMuted }}>{step.desc}</p>
                    </button>

                    <ChevronRight size={15} className="shrink-0 mt-1 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: fgMuted }} />
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-3 border-t flex items-center justify-between gap-2" style={{ borderColor: border }}>
              <button
                onClick={replayTour}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                style={{ color: fg, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
              >
                <RotateCcw size={13} /> Replay tour
              </button>
              <button
                onClick={dismiss}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                style={{ color: fgMuted }}
              >
                {allDone ? 'Dismiss' : "Hide guide"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
