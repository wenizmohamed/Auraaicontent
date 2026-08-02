// Org switcher dropdown — shown in sidebar bottom, above Profile.
// Lists every org the user is a member of and re-issues a JWT scoped
// to the chosen org via /api/auth/switch-org. Hidden when the user
// only belongs to one org.

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { orgsApi, setAuthToken, type OrgMembership } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';

interface Props { collapsed: boolean }

export default function OrgSwitcher({ collapsed }: Props) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    orgsApi.list().then((rows) => {
      setMemberships(rows);
      // Read active org from JWT payload (decoded client-side, no verification needed for display).
      try {
        const token = localStorage.getItem('radix_auth_token');
        if (token) {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload?.orgId) setActiveOrgId(payload.orgId);
        }
      } catch { /* legacy token, no orgId — no active org displayed */ }
    }).catch(() => { /* unauthenticated, hide */ });
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (memberships.length === 0) return null;
  const active = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0];

  async function pick(orgId: string) {
    if (orgId === activeOrgId || switching) { setOpen(false); return; }
    setSwitching(true);
    try {
      const r = await orgsApi.switch(orgId);
      setAuthToken(r.token);
      setActiveOrgId(r.activeOrgId);
      setOpen(false);
      // Reload so all client-context-cached data refetches against the new scope.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  if (memberships.length === 1 && collapsed) {
    return (
      <div
        className={`flex items-center justify-center px-3 py-2 rounded-xl ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}
        title={active.org.name}
      >
        <Building2 size={16} />
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => memberships.length > 1 && setOpen((v) => !v)}
        disabled={memberships.length === 1}
        className={`flex items-center w-full ${collapsed ? 'justify-center' : 'gap-2'} px-3 py-2 rounded-xl transition-all duration-200 ${
          memberships.length > 1 ? 'cursor-pointer' : 'cursor-default'
        } ${isDark ? 'hover:bg-white/[0.04] text-zinc-400 hover:text-zinc-200' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'}`}
        title={collapsed ? active.org.name : undefined}
      >
        <Building2 size={16} className="shrink-0" />
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[12px] font-semibold truncate">{active.org.name}</div>
              <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>{active.org.plan} · {active.role.toLowerCase()}</div>
            </div>
            {memberships.length > 1 && <ChevronDown size={12} />}
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute bottom-full left-0 right-0 mb-2 rounded-xl shadow-2xl z-50 overflow-hidden ${
            isDark ? 'bg-[#15151c] border border-white/10' : 'bg-white border border-slate-200 shadow-slate-300/50'
          }`}
        >
          <div className={`px-3 py-2 text-[10px] uppercase tracking-wider ${isDark ? 'text-zinc-500 border-b border-white/[0.06]' : 'text-slate-500 border-b border-slate-200'}`}>
            Switch organization
          </div>
          {memberships.map((m) => (
            <button
              key={m.orgId}
              onClick={() => pick(m.orgId)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${
                m.orgId === activeOrgId
                  ? isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700'
                  : isDark ? 'hover:bg-white/[0.04] text-zinc-300' : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <Building2 size={14} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate">{m.org.name}</div>
                <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>{m.org.plan} · {m.role.toLowerCase()}</div>
              </div>
              {m.orgId === activeOrgId && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
