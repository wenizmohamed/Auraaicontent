import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Shield, Calendar, Sun, Moon, Lock,
  LogOut, Check, AlertCircle, Loader2, Eye, EyeOff,
} from 'lucide-react';
import { authApi, type MeRecord } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { useClients } from '../lib/client-context';
import { motionBase, motionInstant } from '../lib/motion';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleBadge(role: string): { label: string; classes: string } {
  const r = role.toLowerCase();
  if (r === 'admin' || r === 'owner') {
    return { label: 'Admin', classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }
  if (r === 'lead' || r === 'manager') {
    return { label: 'Lead', classes: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  }
  return { label: r.charAt(0).toUpperCase() + r.slice(1) || 'Member', classes: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' };
}

function formatJoined(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

type ToastKind = 'success' | 'error';
interface Toast { kind: ToastKind; msg: string; }

export default function Profile() {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useClients();

  const [me, setMe] = useState<MeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // identity edit
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  // password change
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwShowCurrent, setPwShowCurrent] = useState(false);
  const [pwShowNew, setPwShowNew] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  // sign-out armed-confirm
  const [signOutArmed, setSignOutArmed] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    authApi.me()
      .then(data => { if (alive) { setMe(data); setNameDraft(data.name); } })
      .catch(err => { if (alive) setLoadError(err?.message || 'Failed to load profile'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ESC to close password panel + disarm sign-out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pwOpen) setPwOpen(false);
      if (signOutArmed) setSignOutArmed(false);
      if (editing) { setEditing(false); setNameDraft(me?.name ?? ''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pwOpen, signOutArmed, editing, me?.name]);

  async function saveName() {
    if (!me) return;
    const trimmed = nameDraft.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      setToast({ kind: 'error', msg: 'Name must be 2–80 characters' });
      return;
    }
    if (trimmed === me.name) { setEditing(false); return; }
    setSavingName(true);
    try {
      const updated = await authApi.updateMe({ name: trimmed });
      setMe(updated);
      setEditing(false);
      setToast({ kind: 'success', msg: 'Profile updated' });
    } catch (err: any) {
      setToast({ kind: 'error', msg: err?.message || 'Failed to update profile' });
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwNew.length < 6) { setToast({ kind: 'error', msg: 'New password must be at least 6 characters' }); return; }
    if (pwNew !== pwConfirm) { setToast({ kind: 'error', msg: 'New passwords do not match' }); return; }
    if (pwCurrent === pwNew) { setToast({ kind: 'error', msg: 'New password must differ from current' }); return; }
    setSavingPw(true);
    try {
      await authApi.changePassword(pwCurrent, pwNew);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setPwOpen(false);
      setToast({ kind: 'success', msg: 'Password changed — other sessions revoked' });
    } catch (err: any) {
      setToast({ kind: 'error', msg: err?.message || 'Failed to change password' });
    } finally {
      setSavingPw(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="h-8 w-48 rounded bg-white/[0.04] animate-pulse" />
        <div className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />
        <div className="h-32 rounded-2xl bg-white/[0.04] animate-pulse" />
        <div className="h-32 rounded-2xl bg-white/[0.04] animate-pulse" />
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-red-400">Failed to load profile</h2>
            <p className="text-sm text-zinc-400 mt-1">{loadError ?? 'Please refresh and try again.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const badge = roleBadge(me.role);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-16 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionBase}
      >
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-white tracking-tight">Profile</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage your account, security, and appearance.</p>
      </motion.div>

      {/* Identity card */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.05 }}
        className="glass-card p-6 sm:p-7"
        aria-labelledby="identity-heading"
      >
        <h2 id="identity-heading" className="sr-only">Identity</h2>
        <div className="flex items-start gap-5">
          <div
            className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-zinc-900 font-display font-bold text-2xl sm:text-3xl shadow-lg shadow-amber-500/20"
            aria-label={`Avatar for ${me.name}`}
          >
            {initials(me.name)}
          </div>

          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <label htmlFor="name-input" className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</label>
                <input
                  id="name-input"
                  type="text"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  maxLength={80}
                  autoFocus
                  className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-white placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none transition-colors"
                  placeholder="Your name"
                  onKeyDown={e => e.key === 'Enter' && saveName()}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={savingName}
                    className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 text-zinc-900 text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setNameDraft(me.name); }}
                    className="cursor-pointer px-3.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-xl sm:text-2xl font-display font-semibold text-white truncate">{me.name}</h3>
                    <p className="text-sm text-zinc-400 mt-0.5 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      <span className="truncate">{me.email}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="cursor-pointer text-xs font-medium px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 transition-colors"
                  >
                    Edit name
                  </button>
                </div>

                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${badge.classes}`}>
                    <Shield className="w-3 h-3" />
                    {badge.label}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                    <Calendar className="w-3 h-3" />
                    Joined {formatJoined(me.createdAt)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </motion.section>

      {/* Appearance */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.1 }}
        className="glass-card p-6 sm:p-7"
        aria-labelledby="appearance-heading"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 id="appearance-heading" className="text-base font-display font-semibold text-white flex items-center gap-2">
              {theme === 'dark' ? <Moon className="w-4 h-4 text-amber-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
              Appearance
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Currently using {theme === 'dark' ? 'dark' : 'light'} mode.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Toggle dark mode"
            className={`cursor-pointer relative inline-flex h-7 w-12 flex-shrink-0 rounded-full transition-colors duration-200 ${
              theme === 'dark' ? 'bg-amber-500' : 'bg-zinc-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-flex items-center justify-center h-5 w-5 mt-1 transform rounded-full bg-white shadow transition-transform duration-200 ${
                theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
              }`}
            >
              {theme === 'dark'
                ? <Moon className="w-3 h-3 text-amber-500" />
                : <Sun className="w-3 h-3 text-amber-500" />}
            </span>
          </button>
        </div>
      </motion.section>

      {/* Security */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.15 }}
        className="glass-card p-6 sm:p-7"
        aria-labelledby="security-heading"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 id="security-heading" className="text-base font-display font-semibold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              Security
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Change your password. Other active sessions will be signed out.
            </p>
          </div>
          {!pwOpen && (
            <button
              type="button"
              onClick={() => setPwOpen(true)}
              className="cursor-pointer text-xs font-medium px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 transition-colors"
            >
              Change password
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {pwOpen && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={motionInstant}
              onSubmit={changePassword}
              className="mt-5 space-y-4 overflow-hidden"
            >
              <PasswordField
                id="pw-current"
                label="Current password"
                value={pwCurrent}
                onChange={setPwCurrent}
                show={pwShowCurrent}
                onToggle={() => setPwShowCurrent(v => !v)}
                autoFocus
              />
              <PasswordField
                id="pw-new"
                label="New password (min 6)"
                value={pwNew}
                onChange={setPwNew}
                show={pwShowNew}
                onToggle={() => setPwShowNew(v => !v)}
              />
              <div>
                <label htmlFor="pw-confirm" className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Confirm new password</label>
                <input
                  id="pw-confirm"
                  type="password"
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-white placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none transition-colors"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingPw || !pwCurrent || !pwNew || !pwConfirm}
                  className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 text-zinc-900 text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {savingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Update password
                </button>
                <button
                  type="button"
                  onClick={() => { setPwOpen(false); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }}
                  className="cursor-pointer px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.section>

      {/* Sign out (danger zone) */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.2 }}
        className="glass-card p-6 sm:p-7 border-red-500/20"
        aria-labelledby="signout-heading"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 id="signout-heading" className="text-base font-display font-semibold text-white flex items-center gap-2">
              <LogOut className="w-4 h-4 text-red-400" />
              Sign out
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Revokes this session and returns to the login screen.
            </p>
          </div>
          {signOutArmed ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={logout}
                className="cursor-pointer text-xs font-semibold px-3.5 py-2 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
              >
                Yes, sign out
              </button>
              <button
                type="button"
                onClick={() => setSignOutArmed(false)}
                className="cursor-pointer text-xs font-medium px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSignOutArmed(true)}
              className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
        </div>
      </motion.section>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={motionInstant}
            role="status"
            aria-live="polite"
            className={`z-toast fixed bottom-6 right-6 max-w-sm rounded-xl px-4 py-3 shadow-2xl border flex items-start gap-2.5 ${
              toast.kind === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            {toast.kind === 'success'
              ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span className="text-sm">{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoFocus?: boolean;
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoFocus }: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete={id === 'pw-current' ? 'current-password' : 'new-password'}
          className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] pl-3 pr-10 py-2 text-white placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none transition-colors"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
