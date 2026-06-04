// Standalone invite-acceptance landing.  The link in the invite email
// hits /invite/:token; this page previews the org + role, requires the
// invitee to be logged in as the matching email, and on accept redirects
// them into the newly-joined org's dashboard.
//
// No auth header is sent on the preview call — the backend treats GET
// /api/invitations/:token as public.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { invitationsApi, type InvitePreview, orgsApi } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { t } from '../i18n';
import { Mail, Building2, AlertCircle, Check, LogIn, UserPlus, Calendar, Sparkles, Users } from 'lucide-react';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);

  const isLoggedIn = !!localStorage.getItem('radix_auth_token');

  useEffect(() => {
    if (!token) { setError('Missing invitation token'); setLoading(false); return; }
    invitationsApi.preview(token)
      .then(setPreview)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    if (!token) return;
    setAccepting(true); setError(null);
    try {
      const r = await invitationsApi.accept(token);
      // Switch the active org so the next call lands in the new tenant
      // and a fresh JWT carries the new orgId.
      try { await orgsApi.switch(r.orgId); } catch { /* user can manually switch later */ }
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (e: any) {
      setError(e?.message || 'Failed to accept invitation');
      setAccepting(false);
    }
  }

  // Persist the invite across the auth round-trip: the token is replayed by
  // App's Layout once authenticated, and the email is read by Login to pre-fill
  // (and lock) the address so it matches the invite the backend checks against.
  function stashInvite() {
    try {
      localStorage.setItem('radix.pendingInvite', token!);
      if (preview?.email) localStorage.setItem('radix.inviteEmail', preview.email);
    } catch { /* ignore */ }
  }

  const card = isDark ? 'bg-white/[0.04] border border-white/[0.08]' : 'bg-white border border-slate-200 shadow-xl';
  const text = isDark ? 'text-white' : 'text-slate-900';
  const sub = isDark ? 'text-zinc-400' : 'text-slate-500';
  const accent = isDark ? 'text-amber-400' : 'text-amber-600';

  // What a new member gets — reinforces the value at the moment of joining
  // (Jasper-style welcoming onboarding). Bilingual line is first-class for Gulf.
  const perks = [
    { icon: Calendar, label: 'Plan & schedule content across every channel' },
    { icon: Sparkles, label: 'Generate on-brand posts with AI — Arabic & English' },
    { icon: Users, label: 'Review, comment, and approve together' },
  ];

  return (
    <div className={`relative min-h-screen flex items-center justify-center p-6 overflow-hidden ${isDark ? 'bg-zinc-950' : 'bg-slate-50'}`}>
      {/* Branded gradient hero backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        background: isDark
          ? 'radial-gradient(60rem 40rem at 50% -10%, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 60%)'
          : 'radial-gradient(60rem 40rem at 50% -10%, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent 60%)',
      }} />
      <div className={`relative ${card} rounded-3xl p-8 max-w-md w-full`}>
        {/* Wordmark */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl overflow-hidden border" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)' }}>
            <img src="./radix-dna.jpg" alt="Radix" className="w-full h-full object-cover" />
          </div>
          <span className="text-sm font-black tracking-tight" style={{ color: 'var(--color-fg)' }}>RADIX</span>
        </div>

        <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>{t('invite.eyebrow')}</div>
        <h1 className={`text-2xl font-black mt-1 tracking-tight ${text}`}>
          {preview ? `Join ${preview.org.name}` : t('invite.title')}
        </h1>

        {loading && (
          <div className={`mt-6 ${sub}`}>{t('invite.loading')}</div>
        )}

        {error && !preview && (
          <div className={`mt-6 flex gap-3 items-start`}>
            <AlertCircle className={isDark ? 'text-red-400 mt-0.5' : 'text-red-600 mt-0.5'} size={18} />
            <div className={`text-sm ${text}`}>{error}</div>
          </div>
        )}

        {preview && !done && (
          <>
            <div className={`mt-6 space-y-3 text-sm ${text}`}>
              <div className="flex items-center gap-2">
                <Building2 size={16} className={accent} />
                <span className="font-semibold">{preview.org.name}</span>
                <span className={`text-xs ${sub} uppercase tracking-wider`}>· {preview.org.plan}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={16} className={sub} />
                <span className={sub}>{t('invite.for')}: </span>
                <span className="font-medium">{preview.email}</span>
              </div>
              <div className={`text-xs ${sub}`}>
                {t('invite.join_as')} <span className="uppercase tracking-wider font-medium">{preview.role}</span>.
                {' '}{t('invite.expires')} {new Date(preview.expiresAt).toLocaleDateString()}.
              </div>
            </div>

            {/* What you'll get */}
            <ul className="mt-5 space-y-2.5">
              {perks.map((p) => (
                <li key={p.label} className={`flex items-center gap-2.5 text-[13px] ${text}`}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0"
                    style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                    <p.icon className="w-3.5 h-3.5" />
                  </span>
                  {p.label}
                </li>
              ))}
            </ul>

            {error && (
              <div className={`mt-4 flex gap-2 items-start text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {isLoggedIn ? (
              <button
                onClick={accept}
                disabled={accepting}
                style={{ color: '#fff' }}
                className="mt-6 w-full py-2.5 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-600 transition-all duration-200 disabled:opacity-50 cursor-pointer"
              >
                {accepting ? t('invite.accepting') : t('invite.accept')}
              </button>
            ) : (
              <div className="mt-6 space-y-3">
                <div className={`text-sm ${sub}`}>
                  {fill(t('invite.signin_prompt'), { email: preview.email })}
                </div>
                {/* Primary: brand-new recipients need an obvious way to register.
                    Stash the token (replayed post-auth in App's Layout) and the
                    invited email (Login pre-fills + locks it, since the backend
                    requires the logged-in email to match the invite). */}
                {/* NOTE: do NOT use the `text-white` utility here — index.css has
                    `html.light .text-white { color:#0f172a !important }`, which would
                    make dark-button labels invisible in light mode. Force color inline. */}
                <Link
                  to="/login?mode=signup"
                  style={{ color: '#fff' }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 transition-all duration-200 cursor-pointer"
                  onClick={stashInvite}
                >
                  <UserPlus size={14} />
                  {t('invite.create_account')}
                </Link>
                <Link
                  to="/login?mode=signin"
                  style={{ color: '#fff' }}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${
                    isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-slate-900 hover:bg-slate-800'
                  } transition-all duration-200 cursor-pointer`}
                  onClick={stashInvite}
                >
                  <LogIn size={14} />
                  {t('invite.have_account')}
                </Link>
              </div>
            )}
          </>
        )}

        {done && (
          <div className={`mt-6 flex gap-3 items-start`}>
            <Check className={isDark ? 'text-emerald-400 mt-0.5' : 'text-emerald-600 mt-0.5'} size={18} />
            <div className={`text-sm ${text}`}>
              {fill(t('invite.joined'), { org: preview?.org.name ?? '' })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
