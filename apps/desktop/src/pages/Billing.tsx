// Billing settings page. Three plans + Manage Subscription button (the
// latter routes to the Stripe Customer Portal once the org has a stripeCustomerId).
// Returns 503 when STRIPE_SECRET_KEY isn't configured server-side — we
// surface that as a friendly "billing not enabled yet" message instead
// of a JSON error.

import { useState } from 'react';
import { billingApi } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { t } from '../i18n';
import { Check, AlertCircle, ExternalLink, CreditCard } from 'lucide-react';

interface Plan {
  id: 'starter' | 'studio' | 'agency';
  name: string;
  price: string;
  cadence: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$49',
    cadence: '/mo',
    features: ['1 client workspace', '50 AI generations / mo', '25 image generations', 'Single seat'],
  },
  {
    id: 'studio',
    name: 'Studio',
    price: '$149',
    cadence: '/mo',
    features: ['5 client workspaces', '300 AI generations / mo', '200 image generations', '5 seats', 'Review links + exports'],
    highlight: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '$399',
    cadence: '/mo',
    features: ['20 client workspaces', '2000 AI generations / mo', '1500 image generations', 'Unlimited seats', 'Priority models', 'WhatsApp export'],
  },
];

export default function Billing() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function checkout(plan: Plan['id']) {
    setBusy(plan); setErr(null);
    try {
      const r = await billingApi.checkout(plan);
      window.location.href = r.url;
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
      setBusy(null);
    }
  }

  async function portal() {
    setBusy('portal'); setErr(null);
    try {
      const r = await billingApi.portal();
      window.location.href = r.url;
    } catch (e: any) {
      setErr(e?.message || 'Portal not available — complete a checkout first.');
      setBusy(null);
    }
  }

  const text = isDark ? 'text-white' : 'text-slate-900';
  const sub = isDark ? 'text-zinc-400' : 'text-slate-500';
  const card = isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-white border border-slate-200 shadow-sm';
  const cardHl = isDark ? 'bg-amber-500/[0.04] border border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-amber-50 border border-amber-300 shadow-md';

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>{t('nav.settings')}</div>
        <h1 className={`text-2xl font-bold mt-1 ${text}`}>{t('page.billing.title')}</h1>
        <p className={`mt-2 text-sm ${sub}`}>14-day trial included. Cancel any time from the Stripe customer portal.</p>
      </header>

      {err && (
        <div className={`${card} rounded-2xl p-4 flex gap-3 items-start`}>
          <AlertCircle className={isDark ? 'text-amber-400 mt-0.5' : 'text-amber-600 mt-0.5'} size={18} />
          <div className={`text-sm ${text}`}>{err}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => (
          <div key={p.id} className={`${p.highlight ? cardHl : card} rounded-2xl p-6 flex flex-col`}>
            <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>{p.name}</div>
            <div className={`text-4xl font-bold mt-2 ${text}`}>
              {p.price}
              <span className={`text-sm font-medium ${sub}`}>{p.cadence}</span>
            </div>
            <ul className={`mt-5 space-y-2.5 text-sm ${text} flex-1`}>
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check size={14} className={`mt-1 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => checkout(p.id)}
              disabled={busy !== null}
              className={`mt-6 w-full py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 ${
                p.highlight
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : isDark ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {busy === p.id ? 'Opening checkout…' : `Choose ${p.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className={`${card} rounded-2xl p-5 flex items-center justify-between`}>
        <div>
          <div className={`text-sm font-semibold ${text} flex items-center gap-2`}>
            <CreditCard size={16} className={sub} />
            Manage existing subscription
          </div>
          <div className={`text-xs mt-1 ${sub}`}>Update payment method, view invoices, cancel via Stripe.</div>
        </div>
        <button
          onClick={portal}
          disabled={busy !== null}
          className={`px-4 py-2 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 flex items-center gap-2 ${
            isDark ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'
          }`}
        >
          {busy === 'portal' ? 'Opening…' : 'Open portal'}
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
