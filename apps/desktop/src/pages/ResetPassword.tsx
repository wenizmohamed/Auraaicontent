// Standalone password-reset landing. The link in the reset email hits
// /reset-password/:token; this page lets the user set a new password and, on
// success, sends them to the sign-in screen. Renders outside the auth gate —
// the user is logged out by definition. The token is consumed server-side; no
// auth header is needed (POST /api/auth/reset-password is public).

import { useState, type FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { authApi } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { Loader2, AlertCircle, CheckCircle2, ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';

const MIN_PASSWORD = 6;

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) { setError('Missing reset token.'); return; }
    if (password.length < MIN_PASSWORD) { setError(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => { nav('/login?mode=signin'); }, 1600);
    } catch (err: any) {
      setError(err?.message || 'Could not reset password. The link may have expired.');
      setSubmitting(false);
    }
  }

  const card = isDark ? 'bg-white/[0.04] border border-white/[0.08]' : 'bg-white border border-slate-200 shadow-xl';
  const text = isDark ? 'text-white' : 'text-slate-900';
  const sub = isDark ? 'text-zinc-400' : 'text-slate-500';

  return (
    <div className={`relative min-h-screen flex items-center justify-center p-6 overflow-hidden ${isDark ? 'bg-zinc-950' : 'bg-slate-50'}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(60rem 40rem at 50% -10%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 60%)',
      }} />
      <div className={`relative ${card} rounded-3xl p-8 max-w-md w-full`}>
        {/* Wordmark */}
        <div className="flex items-center gap-2 mb-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
            <KeyRound size={16} />
          </span>
          <span className="text-sm font-black tracking-tight" style={{ color: 'var(--color-fg)' }}>RADIX</span>
        </div>

        <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>Password reset</div>
        <h1 className={`text-2xl font-black mt-1 tracking-tight ${text}`}>Choose a new password</h1>

        {done ? (
          <div className="mt-6 flex gap-3 items-start">
            <CheckCircle2 className={isDark ? 'text-emerald-400 mt-0.5' : 'text-emerald-600 mt-0.5'} size={18} />
            <div className={`text-sm ${text}`}>
              Password updated. Taking you to sign in…
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <PasswordField id="reset-pw" label={`New password (min ${MIN_PASSWORD})`} value={password} onChange={setPassword} show={show} onToggle={() => setShow(s => !s)} autoFocus isDark={isDark} />
            <PasswordField id="reset-pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} show={show} onToggle={() => setShow(s => !s)} isDark={isDark} />

            {error && (
              <div className={`flex gap-2 items-start text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Updating…</>) : (<>Update password <ArrowRight className="h-4 w-4" /></>)}
            </button>

            <div className="text-center">
              <Link to="/login?mode=signin" className="text-[12px] font-medium" style={{ color: 'var(--color-accent)' }}>
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoFocus, isDark }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoFocus?: boolean;
  isDark: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={`mb-1.5 block text-[10px] font-medium uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          autoFocus={autoFocus}
          required
          minLength={MIN_PASSWORD}
          placeholder="••••••••"
          className="w-full rounded-xl border px-3.5 py-2.5 pr-10 text-[13px] transition-colors focus:outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg)' }}
          onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-accent)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-border-subtle)'; }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
          style={{ color: 'var(--color-fg-subtle)' }}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}
