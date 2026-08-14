/**
 * Onboarding tour — thin wrapper around driver.js with token-driven popover
 * styling. Fires once per org per browser via localStorage gate.
 *
 * Trigger:
 *   import { runOnboardingTour } from '@/lib/onboarding-tour';
 *   useEffect(() => { runOnboardingTour({ orgId: currentOrg.id }); }, [currentOrg.id]);
 */
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

// .v2 bumped 2026-05-27 with the IA redesign (grouped sidebar +
// Strategy/Create/Distribute split). Existing users re-see the tour once.
const STORAGE_KEY = 'radix.onboarding.completed.v2';

interface RunOpts {
  orgId: string;
  /** Override to re-run the tour even if already completed. */
  force?: boolean;
}

function alreadyCompleted(orgId: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const completed = JSON.parse(raw) as Record<string, boolean>;
    return !!completed[orgId];
  } catch { return false; }
}

function markCompleted(orgId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const completed = raw ? JSON.parse(raw) : {};
    completed[orgId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  } catch { /* ignore */ }
}

export function runOnboardingTour({ orgId, force = false }: RunOpts) {
  if (!force && alreadyCompleted(orgId)) return;
  // Collision guard: don't fire over the full-page /onboarding wizard — the two
  // first-run systems used to stack. GuideWidget (persistent checklist) is the
  // primary; this driver.js tour is the on-demand deep-dive.
  if (!force && typeof window !== 'undefined' && window.location.pathname.startsWith('/onboarding')) return;

  const d = driver({
    showProgress: true,
    overlayColor: 'rgba(0,0,0,0.65)',
    popoverClass: 'radix-driver-popover',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Done',
    onDestroyed: () => markCompleted(orgId),
    steps: [
      {
        element: 'a[href="/"]',
        popover: {
          title: 'Welcome to AURAAI',
          description: 'Your bilingual AR/EN content calendar OS for Gulf-region agencies. 45-second tour. Covers every part of the app.',
        },
      },
      {
        element: 'a[href="/clients"]',
        popover: {
          title: 'Strategy → Add a brand',
          description: 'Each client keeps its own brief, knowledge base, brand kit (logos, colors, voice. Feeds every AI generation), and asset library.',
        },
      },
      {
        element: 'a[href="/brief"]',
        popover: {
          title: 'Strategy → Write the brief',
          description: 'Voice, channels, products, approvers. Richer brief = smarter generations.',
        },
      },
      {
        element: 'a[href="/calendar"]',
        popover: {
          title: 'Plan → Generate a calendar',
          description: 'One click → a full month of posts across your channels. Hijri + Gregorian dual-display, GCC holidays auto-flagged.',
        },
      },
      {
        element: 'a[href="/creative"], a[href="/ai-design"]',
        popover: {
          title: 'Create → AI tools',
          description: 'Creative Tools (image + video), AI Design, Copywriting, Studio. Gallery + References live under Library.',
        },
      },
      {
        element: 'a[href="/integrations"]',
        popover: {
          title: 'Distribute → Connect platforms',
          description: 'Wire up Meta, TikTok, and LinkedIn so approved posts publish straight from AURAAI at their scheduled time.',
        },
      },
      {
        element: '[aria-label="Search or ask AURAAI…"], button[title*="Search"]',
        popover: {
          title: 'Pro tip. ⌘K everywhere',
          description: 'Press <b>⌘K</b> (Ctrl+K) to <b>search your content</b>find any client, post, or piece by name, plus jump between surfaces, run actions, switch theme/locale. <b>?</b> shows all shortcuts.',
        },
      },
    ],
  });

  d.drive();
}

export function resetOnboardingTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
