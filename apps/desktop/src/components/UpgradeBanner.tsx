/**
 * UpgradeBanner — top-rail nudge for free-tier orgs.
 *
 * Reads the active org's `plan` from the JWT payload (same source the
 * OrgSwitcher uses). Renders a quiet hairline banner only when the plan
 * is free; auto-hides on paid tiers. Click dismisses for the session.
 *
 * Editorial signature: monochrome surface, single accent dot, one CTA,
 * no gradient. Designed to live just inside <main>.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionUI } from '../lib/motion';

const FREE_PLAN_VALUES = new Set(['', 'free', 'trial', 'FREE', 'TRIAL', 'starter', 'STARTER']);
const SESSION_DISMISS_KEY = 'radix:upgrade-banner:dismissed';

function decodeActiveOrgPlan(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('radix-token') || localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    const org = payload?.activeOrg || payload?.org || null;
    return typeof org?.plan === 'string' ? org.plan : null;
  } catch {
    return null;
  }
}

export function UpgradeBanner() {
  const [plan, setPlan] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPlan(decodeActiveOrgPlan());
    setDismissed(sessionStorage.getItem(SESSION_DISMISS_KEY) === '1');
    function refresh() { setPlan(decodeActiveOrgPlan()); }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  const isFree = plan != null && FREE_PLAN_VALUES.has(plan);
  if (!isFree || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={motionUI}
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
            style={{
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent)',
            }}
          >
            <Sparkles size={12} />
          </span>
          <p className="truncate text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
            <span style={{ color: 'var(--color-fg)' }} className="font-medium">You're on the free plan.</span>
            <span className="mx-1.5 opacity-50">·</span>
            <span>Upgrade for higher AI limits, image &amp; video generation, and team seats.</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link
            to="/settings/billing"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-fg-on-accent)',
            }}
          >
            Upgrade
          </Link>
          <button
            type="button"
            aria-label="Dismiss upgrade banner for this session"
            onClick={() => {
              sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
              setDismissed(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--color-surface-hover)]"
            style={{ color: 'var(--color-fg-subtle)' }}
          >
            <X size={12} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default UpgradeBanner;
