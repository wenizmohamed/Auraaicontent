// Org members + pending invitations management.  OWNER/ADMIN of the
// active org sees the full UI (invite form, copy link, revoke); other
// roles see members read-only.  Backed by /api/orgs/:orgId/members and
// /api/orgs/:orgId/invitations.

import { useEffect, useMemo, useState } from 'react';
import { invitationsApi, orgsApi, type PendingInvite } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { t } from '../i18n';
import { Users, Mail, Trash2, Copy, AlertCircle, Check, UserPlus, UserX } from 'lucide-react';

type Member = { id: string; role: string; createdAt: string; user: { id: string; email: string; name: string } };
type Role = 'ADMIN' | 'EDITOR' | 'VIEWER';

function decodeOrg(): { orgId: string | null; orgRole: string | null; userId: string | null } {
  try {
    const tok = localStorage.getItem('radix_auth_token');
    if (!tok) return { orgId: null, orgRole: null, userId: null };
    const payload = JSON.parse(atob(tok.split('.')[1]));
    return { orgId: payload.orgId ?? null, orgRole: payload.orgRole ?? null, userId: payload.userId ?? null };
  } catch { return { orgId: null, orgRole: null, userId: null }; }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export default function Members() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { orgId, orgRole, userId: callerUserId } = useMemo(decodeOrg, []);
  const isPrivileged = orgRole === 'OWNER' || orgRole === 'ADMIN';

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('EDITOR');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const ownerCount = members.filter((m) => m.role === 'OWNER').length;

  async function refresh() {
    if (!orgId) return;
    setError(null);
    try {
      const [m, i] = await Promise.all([
        orgsApi.members(orgId),
        isPrivileged ? invitationsApi.list(orgId) : Promise.resolve([] as PendingInvite[]),
      ]);
      setMembers(m as Member[]);
      setInvites(i);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !inviteEmail) return;
    setSubmitting(true); setError(null);
    try {
      await invitationsApi.create(orgId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    if (!orgId) return;
    try { await invitationsApi.revoke(orgId, id); await refresh(); }
    catch (e: any) { setError(e?.message || 'Revoke failed'); }
  }

  async function removeMember(m: Member) {
    if (!orgId) return;
    const name = m.user.name || m.user.email;
    if (!window.confirm(fill(t('members.remove_confirm'), { name }))) return;
    setRemoving(m.user.id); setError(null);
    try {
      await orgsApi.removeMember(orgId, m.user.id);
      // If you removed yourself, your access just evaporated — bounce to login.
      if (m.user.id === callerUserId) {
        localStorage.removeItem('radix_auth_token');
        localStorage.removeItem('radix_refresh_token');
        window.location.href = '/';
        return;
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Remove failed');
    } finally {
      setRemoving(null);
    }
  }

  function canRemove(m: Member): boolean {
    if (!isPrivileged) return false;
    if (m.role === 'OWNER' && orgRole !== 'OWNER') return false;            // ADMIN can't touch OWNER
    if (m.role === 'OWNER' && ownerCount <= 1) return false;                // last OWNER guard
    return true;
  }

  function inviteUrl(token: string) { return `${window.location.origin}/invite/${token}`; }
  function copyLink(token: string) {
    try { navigator.clipboard.writeText(inviteUrl(token)); setCopied(token); setTimeout(() => setCopied(null), 1500); } catch {}
  }

  const card = isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-white border border-slate-200 shadow-sm';
  const text = isDark ? 'text-white' : 'text-slate-900';
  const sub = isDark ? 'text-zinc-400' : 'text-slate-500';
  const input = isDark
    ? 'bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-zinc-500 focus:border-amber-500/50'
    : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-amber-500';
  const btn = 'bg-amber-500 hover:bg-amber-600 text-white';
  const ghost = isDark ? 'hover:bg-white/[0.05] text-zinc-400 hover:text-zinc-200' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700';

  if (!orgId) {
    return (
      <div className={`p-8 max-w-2xl mx-auto ${text}`}>
        <div className={`${card} rounded-2xl p-6 flex gap-3 items-start`}>
          <AlertCircle className={isDark ? 'text-amber-400' : 'text-amber-600'} />
          <div className="text-sm">No active organization on this session. Try logging out and back in.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>{t('nav.settings')}</div>
        <h1 className={`text-2xl font-bold mt-1 ${text}`}>{t('page.members.title')}</h1>
        <p className={`mt-2 text-sm ${sub}`}>{t('page.members.subtitle')}</p>
      </header>

      {error && (
        <div className={`${card} rounded-2xl p-4 flex gap-3 items-start`}>
          <AlertCircle className={isDark ? 'text-red-400 mt-0.5' : 'text-red-600 mt-0.5'} size={18} />
          <div className={`text-sm ${text}`}>{error}</div>
        </div>
      )}

      {isPrivileged && (
        <section className={`${card} rounded-2xl p-5`}>
          <div className={`flex items-center gap-2 ${text} font-semibold mb-3`}>
            <UserPlus size={16} />
            <span>{t('members.invite_heading')}</span>
          </div>
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              required
              placeholder={t('members.email_placeholder')}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={`flex-1 px-3 py-2 rounded-xl text-sm outline-none transition-colors ${input}`}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className={`px-3 py-2 rounded-xl text-sm outline-none ${input}`}
            >
              <option value="ADMIN">{t('members.role_admin')}</option>
              <option value="EDITOR">{t('members.role_editor')}</option>
              <option value="VIEWER">{t('members.role_viewer')}</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all ${btn} disabled:opacity-50 cursor-pointer`}
            >
              {submitting ? t('members.sending') : t('members.send_invite')}
            </button>
          </form>
        </section>
      )}

      {isPrivileged && (
        <section className={`${card} rounded-2xl overflow-hidden`}>
          <div className={`px-5 py-3 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'} flex items-center gap-2`}>
            <Mail size={16} className={sub} />
            <h2 className={`text-sm font-semibold ${text}`}>{t('members.pending_heading')} <span className={sub}>({invites.length})</span></h2>
          </div>
          {invites.length === 0 ? (
            <div className={`px-5 py-8 text-center text-sm ${sub}`}>{t('members.no_pending')}</div>
          ) : (
            <ul>
              {invites.map((inv) => (
                <li key={inv.id} className={`px-5 py-3 flex items-center gap-3 ${isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}`}>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${text} truncate`}>{inv.email}</div>
                    <div className={`text-[11px] uppercase tracking-wider ${sub} mt-0.5`}>
                      {inv.role} · {t('members.expires_at')} {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(inv.token)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${ghost}`}
                    title={inviteUrl(inv.token)}
                  >
                    {copied === inv.token ? <Check size={12} /> : <Copy size={12} />}
                    {copied === inv.token ? t('members.copied') : t('members.copy_link')}
                  </button>
                  <button
                    onClick={() => revoke(inv.id)}
                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-slate-400 hover:text-red-600'}`}
                    title={t('members.revoke')}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={`${card} rounded-2xl overflow-hidden`}>
        <div className={`px-5 py-3 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'} flex items-center gap-2`}>
          <Users size={16} className={sub} />
          <h2 className={`text-sm font-semibold ${text}`}>{t('members.members_heading')} <span className={sub}>({members.length})</span></h2>
        </div>
        {loading ? (
          <div className={`px-5 py-8 text-center text-sm ${sub}`}>{t('invite.loading')}</div>
        ) : (
          <ul>
            {members.map((m) => {
              const isSelf = m.user.id === callerUserId;
              const showRemove = canRemove(m);
              return (
                <li key={m.id} className={`px-5 py-3 flex items-center gap-3 ${isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}`}>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${text} truncate flex items-center gap-2`}>
                      <span className="truncate">{m.user.name || m.user.email}</span>
                      {isSelf && <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${isDark ? 'bg-white/[0.04] text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{t('members.you')}</span>}
                    </div>
                    <div className={`text-[11px] ${sub} mt-0.5 truncate`}>{m.user.email}</div>
                  </div>
                  {isPrivileged && !(m.role === 'OWNER' && orgRole !== 'OWNER') && !(m.role === 'OWNER' && ownerCount <= 1) ? (
                    <select
                      value={m.role}
                      onChange={async (e) => {
                        const next = e.target.value as 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
                        try { await orgsApi.setMemberRole(orgId!, m.user.id, next); await refresh(); }
                        catch (err: any) { setError(err?.message || 'Role change failed'); }
                      }}
                      className={`text-[11px] uppercase tracking-wider px-2 py-1 rounded-md outline-none cursor-pointer ${
                        m.role === 'OWNER' ? (isDark ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-amber-100 text-amber-700 border border-amber-200')
                        : m.role === 'ADMIN' ? (isDark ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30' : 'bg-sky-100 text-sky-700 border border-sky-200')
                        : (isDark ? 'bg-white/[0.04] text-zinc-400 border border-white/[0.08]' : 'bg-slate-100 text-slate-600 border border-slate-200')
                      }`}
                    >
                      {orgRole === 'OWNER' && <option value="OWNER">OWNER</option>}
                      <option value="ADMIN">ADMIN</option>
                      <option value="EDITOR">EDITOR</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  ) : (
                    <span className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md ${
                      m.role === 'OWNER' ? (isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-700')
                      : m.role === 'ADMIN' ? (isDark ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-100 text-sky-700')
                      : (isDark ? 'bg-white/[0.04] text-zinc-400' : 'bg-slate-100 text-slate-600')
                    }`}>{m.role}</span>
                  )}
                  {showRemove && (
                    <button
                      onClick={() => removeMember(m)}
                      disabled={removing === m.user.id}
                      title={t('members.remove')}
                      className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-50 ${isDark ? 'hover:bg-red-500/10 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-slate-400 hover:text-red-600'}`}
                    >
                      <UserX size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
