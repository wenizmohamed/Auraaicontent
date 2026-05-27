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
          title: 'Welcome to Radix',
          description: 'Your bilingual AR/EN content calendar OS for Gulf-region agencies. 45-second tour — covers every part of the app.',
        },
      },
      {
        element: 'nav[aria-label="Primary"]',
        popover: {
          title: 'Sidebar — grouped',
          description: 'Five groups: <b>Today</b> (dashboard + workspace), <b>Strategy</b> (clients, briefs, brand kit, knowledge, research), <b>Create</b> (calendar, all generation tools, gallery), <b>Distribute</b> (integrations + history), <b>Settings</b>. Click any group header to collapse.',
        },
      },
      {
        element: 'a[href="/clients"]',
        popover: {
          title: 'Strategy → 1. Add a brand',
          description: 'Each client keeps its own brief, knowledge base, brand kit, and asset library.',
        },
      },
      {
        element: 'a[href="/brand-kit"]',
        popover: {
          title: 'Strategy → 2. Brand Kit',
          description: 'Logos, colors, fonts, voice rules — feeds every AI generation so output is on-brand by default.',
        },
      },
      {
        element: 'a[href="/brief"]',
        popover: {
          title: 'Strategy → 3. Write the brief',
          description: 'Voice, channels, products, approvers. Richer brief = smarter generations.',
        },
      },
      {
        element: 'a[href="/calendar"]',
        popover: {
          title: 'Create → 4. Generate a calendar',
          description: 'One click → a full month of posts across your channels. Hijri + Gregorian dual-display, GCC holidays auto-flagged.',
        },
      },
      {
        element: 'a[href="/creative"], a[href="/ai-design"]',
        popover: {
          title: 'Create → AI tools',
          description: 'Creative Tools (image + video), AI Design (layouts), Copywriting, Visual References, Gallery — all in the Create group.',
        },
      },
      {
        element: 'a[href="/integrations"]',
        popover: {
          title: 'Distribute → Connect platforms',
          description: 'Wire up Meta, TikTok, and LinkedIn so approved posts publish straight from Radix at their scheduled time.',
        },
      },
      {
        element: '[aria-label="Search or ask Radix…"], button[title*="Search"]',
        popover: {
          title: 'Pro tip — ⌘K everywhere',
          description: 'Press <b>⌘K</b> (Ctrl+K) anywhere to jump between any of the 30+ surfaces, switch theme, change locale, or restart this tour. <b>?</b> shows all keyboard shortcuts.',
        },
      },
    ],
  });

  d.drive();
}

export function resetOnboardingTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
