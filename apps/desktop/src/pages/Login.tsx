import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { useClients } from '../lib/client-context';
import { useTheme } from '../lib/theme-context';

export default function Login() {
  const { login, register, authError } = useClients();
  const { theme } = useTheme();
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
      // Persist the email we'll prefill next time — only if the user opted in.
      // Passwords never touch localStorage; only the JWT (which the backend
      // scopes by lifetime via rememberMe).
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
    <div className={`min-h-screen flex items-center justify-center p-6 ${theme === 'light' ? 'bg-slate-100' : 'bg-zinc-950'}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4 shadow-[0_0_40px_-10px_rgba(245,158,11,0.35)]">
            <Sparkles className="w-7 h-7 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">Radix</h1>
          <p className="text-sm text-zinc-500">AI Content Planner</p>
        </div>

        {/* Card */}
        <div className={`rounded-2xl p-6 border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#111] border-white/10'}`}>
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl mb-6">
            <button
              type="button"
              onClick={() => { setMode('signin'); setLocalError(null); }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${
                mode === 'signin' ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setLocalError(null); }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${
                mode === 'signup' ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="login-name" className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Name</label>
                <input
                  id="login-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors duration-200"
                  placeholder="Your name"
                />
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors duration-200"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors duration-200"
                placeholder="••••••••"
              />
            </div>

            {/* Remember me — 30-day JWT vs 24-hour. Opt-in because long-lived
                access tokens are a tradeoff: convenience ↔ credential lifespan. */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-zinc-900 text-amber-500 focus:ring-2 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
              />
              <span>
                Remember me on this device
                <span className="ml-1 text-[10px] text-zinc-600">(30 days)</span>
              </span>
            </label>

            {err && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded-xl transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                <>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-6">
          Internal tool — contact admin for account issues
        </p>
      </motion.div>
    </div>
  );
}
