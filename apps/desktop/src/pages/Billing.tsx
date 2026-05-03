/**
 * Billing — three-tier hairline pricing surface.
 *
 * HextaUI-pattern cards adapted to radixcontent semantic tokens. Hairline
 * border, accent on the recommended tier (border + Check icon), single CTA
 * per tier. Hover lift via framer-motion. Manage-subscription row beneath.
 *
 * Behavior unchanged from the original: billingApi.checkout(plan) → Stripe
 * Checkout, billingApi.portal() → Stripe Customer Portal.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { billingApi } from '../lib/backend-api';
import { t } from '../i18n';
import { Check, AlertCircle, ExternalLink, CreditCard, Sparkles } from 'lucide-react';
import { motionUI, motionBase } from '../lib/motion';
import { MarqueeLogos } from '../components/ui/MarqueeLogos';

const TRUSTED_AGENCIES = [
  'Al Fardan Studio',
  'Hadid Creative',
  'Madinat Atelier',
  'Karam Communications',
  'Northbound Brand Co.',
  'Riyadh Field Notes',
  'Bait al-Sard',
  'Studio Levant',
];

interface Plan {
  id: 'starter' | 'studio' | 'agency';
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$49',
    cadence: '/mo',
    description: 'For solo operators trying Radix on one brand.',
    features: ['1 client workspace', '50 AI generations / mo', '25 image generations', 'Single seat'],
  },
  {
    id: 'studio',
    name: 'Studio',
    price: '$149',
    cadence: '/mo',
    description: 'Most agencies pick this. Five brands, five seats.',
    features: ['5 client workspaces', '300 AI generations / mo', '200 image generations', '5 seats', 'Review links + exports'],
    highlight: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '$399',
    cadence: '/mo',
    description: 'High-volume teams running 10+ brands.',
    features: ['20 client workspaces', '2000 AI generations / mo', '1500 image generations', 'Unlimited seats', 'Priority models', 'WhatsApp export'],
  },
];

export default function Billing() {
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

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--color-fg-subtle)' }}>
          {t('nav.settings')}
        </p>
        <h1 className="mt-1 font-display text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
          {t('page.billing.title')}
        </h1>
        <p className="mt-2 max-w-prose text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
          14-day trial included. Cancel any time from the Stripe customer portal.
        </p>
      </header>

      {err && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionUI}
          className="flex items-start gap-2 rounded-xl border p-3"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border-subtle)',
          }}
        >
          <AlertCircle size={16} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
          <p className="text-[13px]" style={{ color: 'var(--color-fg)' }}>{err}</p>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PLANS.map((p, i) => {
          const isHl = !!p.highlight;
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionBase, delay: 0.05 + i * 0.05 }}
              whileHover={{ y: -2 }}
              className="relative flex flex-col rounded-2xl border p-6"
              style={{
                background: isHl ? 'var(--color-bg-elevated)' : 'var(--color-surface)',
                borderColor: isHl ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                boxShadow: isHl ? '0 12px 40px -24px rgba(0,0,0,0.5)' : undefined,
              }}
            >
              {isHl && (
                <span
                  className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    background: 'var(--color-accent)',
                    color: 'var(--color-fg-on-accent)',
                  }}
                >
                  <Sparkles size={10} /> Recommended
                </span>
              )}

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--color-fg-subtle)' }}>
                  {p.name}
                </p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-[36px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
                    {p.price}
                  </span>
                  <span className="text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
                    {p.cadence}
                  </span>
                </div>
                <p className="mt-2 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
                  {p.description}
                </p>
              </div>

              <ul className="mt-5 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--color-fg)' }}>
                    <Check size={14} style={{ color: 'var(--color-accent)', marginTop: 2 }} className="flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => checkout(p.id)}
                disabled={busy !== null}
                className="mt-6 w-full rounded-xl py-2.5 text-[12.5px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                style={{
                  background: isHl ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
                  color: isHl ? 'var(--color-fg-on-accent)' : 'var(--color-fg)',
                  border: isHl ? 'none' : '1px solid var(--color-border-subtle)',
                }}
              >
                {busy === p.id ? 'Opening checkout…' : `Choose ${p.name}`}
              </button>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.3 }}
        className="flex items-center justify-between rounded-2xl border p-5"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--color-fg)' }}>
            <CreditCard size={14} style={{ color: 'var(--color-fg-muted)' }} />
            Manage existing subscription
          </div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
            Update payment method, view invoices, cancel via Stripe.
          </p>
        </div>
        <button
          onClick={portal}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-semibold transition-all cursor-pointer disabled:opacity-50"
          style={{
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-fg)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          {busy === 'portal' ? 'Opening…' : 'Open portal'}
          <ExternalLink size={12} />
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...motionBase, delay: 0.45 }}
        className="pt-6"
      >
        <MarqueeLogos
          label="Trusted by agencies running 5+ brands"
          items={TRUSTED_AGENCIES}
          durationSec={42}
        />
      </motion.div>
    </div>
  );
}
