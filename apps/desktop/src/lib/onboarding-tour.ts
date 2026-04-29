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

const STORAGE_KEY = 'radix.onboarding.completed';

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
          description: 'Your bilingual AR/EN content calendar OS for Gulf-region agencies. Let\'s take a 30-second tour.',
        },
      },
      {
        element: 'a[href="/clients"]',
        popover: {
          title: '1. Add a brand',
          description: 'Each client keeps its own brief, knowledge base, and asset library.',
        },
      },
      {
        element: 'a[href="/brief"]',
        popover: {
          title: '2. Write the brief',
          description: 'Tell Radix the brand voice, channels, products, and approval flow. The richer the brief, the smarter every later generation.',
        },
      },
      {
        element: 'a[href="/calendar"]',
        popover: {
          title: '3. Generate a calendar',
          description: 'One click → a full month of posts across your channels. Hijri + Gregorian dual-display, GCC holidays auto-flagged.',
        },
      },
      {
        element: '[aria-label="Search or ask Radix…"], button[title*="Search"]',
        popover: {
          title: 'Pro tip — ⌘K everywhere',
          description: 'Press ⌘K (Ctrl+K on Windows) anywhere to jump between surfaces, switch theme, or change locale. ? opens the keyboard shortcuts cheat sheet.',
        },
      },
    ],
  });

  d.drive();
}

export function resetOnboardingTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
