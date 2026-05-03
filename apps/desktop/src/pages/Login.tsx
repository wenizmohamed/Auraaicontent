/**
 * Login — editorial split-pane auth page.
 *
 * Left rail (max ~520px): branded form card with mode toggle, multi-step
 * transitions between sign-in / sign-up. Right rail (hidden < lg): full-bleed
 * brand panel with Bodoni "Radix" wordmark and a quiet paper-shader texture.
 *
 * All form logic preserved from the previous flat layout; only chrome changed.
 */
import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { useClients } from '../lib/client-context';
import { motionUI, motionBase } from '../lib/motion';
import { AnimatedHeading } from '../components/ui/AnimatedHeading';
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

export default function Login() {
  const { login, register, authError } = useClients();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(() => localStorage.getItem('radix_last_email') ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('radix_remember_me') === '1');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      if (rememberMe) {
        try { localStorage.setItem('radix_last_email', email.trim()); } catch {}
      } else {
        try { localStorage.removeItem('radix_last_email'); } catch {}
      }
      if (mode === 'signin') {
        await login(email.trim(), password, rememberMe);
      } else {
        await register(email.trim(), password, name.trim() || email.split('@')[0], rememberMe);
      }
    } catch (err: any) {
      setLocalError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const err = localError || authError;

  return (
    <div
      className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      style={{ background: 'var(--color-bg)' }}
    >
      {/* ─── Left: form ─── */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionBase}
          className="w-full max-w-[420px]"
        >
          {/* Brand mark — small at top of form */}
          <div className="mb-10 flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
              }}
            >
              <Sparkles size={16} />
            </span>
            <span className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
              Radix
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-[34px] font-bold leading-tight tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--color-fg-muted)' }}>
            {mode === 'signin'
              ? 'Sign in to your content workspace.'
              : 'Free 14-day trial. No card required.'}
          </p>

          {/* Mode toggle — segmented */}
          <div
            className="mt-8 flex gap-1 rounded-xl border p-1"
            style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-surface)' }}
          >
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setLocalError(null); }}
                className="flex-1 rounded-lg py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--color-bg-elevated)' : 'transparent',
                  color: mode === m ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                  boxShadow: mode === m ? '0 1px 0 0 rgba(0,0,0,0.06)' : undefined,
                }}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <AnimatePresence mode="wait">
              {mode === 'signup' && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={motionUI}
                  className="overflow-hidden"
                >
                  <Field id="login-name" label="Name" type="text" autoComplete="name" required value={name} onChange={setName} placeholder="Your name" />
                </motion.div>
              )}
            </AnimatePresence>

            <Field id="login-email" label="Email" type="email" autoComplete="email" required value={email} onChange={setEmail} placeholder="you@example.com" />
            <Field id="login-password" label="Password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={setPassword} placeholder="••••••••" />

            <label className="flex items-center gap-2 select-none cursor-pointer text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-3.5 w-3.5 rounded cursor-pointer"
                style={{ accentColor: 'var(--color-accent)' }}
              />
              <span>
                Remember me
                <span className="ml-1.5" style={{ color: 'var(--color-fg-subtle)' }}>(30 days)</span>
              </span>
            </label>

            {err && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={motionUI}
                className="flex items-start gap-2 rounded-xl border px-3 py-2"
                style={{
                  background: 'var(--color-danger-subtle, rgba(239,68,68,0.08))',
                  borderColor: 'var(--color-danger, rgba(239,68,68,0.3))',
                  color: 'var(--color-danger, #f87171)',
                }}
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-[12px]">{err}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-fg-on-accent)',
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : (
                <>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>
            Internal tool · contact admin for account issues
          </p>
        </motion.div>
      </div>

      {/* ─── Right: brand panel ─── */}
      <aside
        className="relative hidden lg:flex items-center justify-center overflow-hidden border-l"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
        }}
        aria-hidden
      >
        {/* Quiet paper texture (no shader; pure CSS for zero-cost ambient) */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 30% 20%, var(--color-accent-subtle), transparent 50%), radial-gradient(circle at 70% 80%, var(--color-accent-subtle), transparent 55%)',
            opacity: 0.5,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0, transparent 24px, var(--color-border-subtle) 24px, var(--color-border-subtle) 25px)',
            opacity: 0.18,
          }}
        />

        <div className="relative max-w-[440px] px-12 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...motionBase, delay: 0.1 }}
          >
            <p
              className="mb-3 text-[10px] font-semibold uppercase tracking-[0.32em]"
              style={{ color: 'var(--color-fg-subtle)' }}
            >
              AI Content Operating System
            </p>
            <AnimatedHeading
              lines={['Generate.', 'Schedule.', 'Ship.']}
              className="font-display text-[64px] font-bold leading-[0.96] tracking-tight"
              style={{ color: 'var(--color-fg)' }}
              stagger={0.18}
              delay={0.15}
            />
            <p
              className="mx-auto mt-6 max-w-[340px] text-[14px] leading-relaxed"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              One workspace for briefs, calendar, and AI-generated posts —
              tuned for agencies running multiple brands.
            </p>
          </motion.div>

          <motion.div
            className="mt-12"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...motionBase, delay: 0.9 }}
          >
            <MarqueeLogos
              label="Trusted by agencies across MENA"
              items={TRUSTED_AGENCIES}
              durationSec={42}
            />
          </motion.div>
        </div>
      </aside>
    </div>
  );
}

function Field({ id, label, type, autoComplete, required, minLength, value, onChange, placeholder }: {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full rounded-xl border px-3.5 py-2.5 text-[13px] transition-colors focus:outline-none"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-fg)',
        }}
        onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-accent)'; }}
        onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-border-subtle)'; }}
      />
    </div>
  );
}
