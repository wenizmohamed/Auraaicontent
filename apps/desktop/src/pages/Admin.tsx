// Cross-org admin dashboard. Gated server-side on STAFF_EMAILS — non-staff
// users get 403 here and the route returns null so the page silently no-ops.
// Surfaces MRR, ARR, AI cost vs revenue, and per-org breakdown.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  adminApi,
  type AdminMetrics,
  type AdminOrg,
  type AdminUsageByUser,
  type AdminUsageByDay,
  type AdminUsageTotals,
  type AdminAuditLogEntry,
} from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { t } from '../i18n';
import { Building2, DollarSign, TrendingUp, AlertCircle, Users, Boxes, Calendar as CalendarIcon, Download, Activity, BarChart3, FileText, Trash2 } from 'lucide-react';

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtUsdPrecise(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}
function fmtDateTime(s: string): string {
  try {
    const d = new Date(s);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch { return s; }
}
function firstOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Admin() {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.metrics(), adminApi.orgs()])
      .then(([m, o]) => { setMetrics(m); setOrgs(o); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const card = isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-white border border-slate-200 shadow-sm';
  const text = isDark ? 'text-white' : 'text-slate-900';
  const sub = isDark ? 'text-zinc-400' : 'text-slate-500';
  const numeric = isDark ? 'text-amber-400' : 'text-amber-600';

  // ─── Usage reporting state (orgId + date range drives 4 endpoints) ──────
  const [usageOrgId, setUsageOrgId] = useState<string>('');
  const [usageFrom, setUsageFrom] = useState<string>(firstOfMonthIso());
  const [usageTo, setUsageTo] = useState<string>(todayIso());
  const [usageTotals, setUsageTotals] = useState<AdminUsageTotals | null>(null);
  const [usageByUser, setUsageByUser] = useState<AdminUsageByUser[]>([]);
  const [usageByDay, setUsageByDay] = useState<AdminUsageByDay[]>([]);
  const [auditLog, setAuditLog] = useState<AdminAuditLogEntry[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Default the org dropdown to the first org once orgs load.
  useEffect(() => {
    if (!usageOrgId && orgs.length > 0) setUsageOrgId(orgs[0].id);
  }, [orgs, usageOrgId]);

  // Delete a workspace (org). Destructive + cascading — confirm hard. The backend
  // also blocks the primary org and the currently-signed-in org as a backstop.
  async function handleDeleteOrg(o: AdminOrg) {
    const ok = window.confirm(
      `Delete the workspace "${o.name}"?\n\n` +
      `This permanently removes it and ALL its data: ${o.clients} client(s), ` +
      `${o.calendars} calendar(s), ${o.seats} member(s), and every post/asset/usage record.\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await adminApi.deleteOrg(o.id);
      setOrgs((prev) => prev.filter((x) => x.id !== o.id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete workspace');
    }
  }

  // Refetch all 4 endpoints whenever org/from/to changes (300ms debounce
  // so dragging the date input doesn't fire a request per keystroke).
  useEffect(() => {
    if (!usageOrgId) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const params = { orgId: usageOrgId, from: usageFrom, to: usageTo };
      setUsageLoading(true);
      setUsageError(null);
      Promise.all([
        adminApi.usageTotals(params),
        adminApi.usageByUser(params),
        adminApi.usageByDay(params),
        adminApi.auditLog({ ...params, limit: 50 }),
      ])
        .then(([totals, byUser, byDay, audit]) => {
          setUsageTotals(totals);
          setUsageByUser([...byUser].sort((a, b) => b.costUsd - a.costUsd));
          setUsageByDay(byDay);
          setAuditLog(audit);
        })
        .catch((err: Error) => setUsageError(err.message))
        .finally(() => setUsageLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [usageOrgId, usageFrom, usageTo]);

  const topModelName = useMemo(() => {
    if (!usageTotals?.topModels?.length) return '—';
    return usageTotals.topModels[0].model;
  }, [usageTotals]);

  async function handleExportCsv() {
    if (!usageOrgId) return;
    setExportBusy(true);
    try {
      await adminApi.usageExportCsv({ orgId: usageOrgId, from: usageFrom, to: usageTo });
    } catch (err: any) {
      setUsageError(err?.message || 'CSV export failed');
    } finally {
      setExportBusy(false);
    }
  }

  const inputCls = isDark
    ? 'bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-500'
    : 'bg-white border border-slate-300 text-slate-900 placeholder-slate-400';

  if (loading) return <div className={`p-8 ${sub}`}>Loading admin metrics…</div>;
  if (error) {
    return (
      <div className={`p-8 max-w-2xl mx-auto ${text}`}>
        <div className={`${card} rounded-2xl p-6 flex gap-3 items-start`}>
          <AlertCircle className={isDark ? 'text-red-400' : 'text-red-600'} />
          <div>
            <div className="font-semibold">Admin access required</div>
            <div className={`text-sm mt-1 ${sub}`}>{error}</div>
            <div className={`text-xs mt-3 ${sub}`}>
              The admin dashboard is gated on STAFF_EMAILS in server env. Add your email to that list to view cross-org metrics.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <header>
        <div className={`text-xs uppercase tracking-[0.2em] ${sub}`}>Internal · Staff only</div>
        <h1 className={`text-2xl font-bold mt-1 ${text}`}>{t('page.admin.title')}</h1>
      </header>

      {metrics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<DollarSign size={16} />} label="MRR (subscription revenue)" value={fmtUsd(metrics.mrr)} foot={`ARR ${fmtUsd(metrics.arr)} — what clients pay us`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<TrendingUp size={16} />} label="AI cost (this month)" value={fmtUsd(metrics.monthAiCostUsd)} foot={`${metrics.monthAiCalls} calls · ${fmtTokens(metrics.monthAiTokens)} tokens`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<DollarSign size={16} />} label="Net margin (mo)" value={fmtUsd(metrics.monthGrossMarginUsd)} foot={`MRR − AI cost`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<Users size={16} />} label="Total seats" value={String(metrics.totalSeats)} foot={`${metrics.paidOrgs} paying · ${metrics.trialOrgs} trial`} />
          </div>
          <div className={`${card} rounded-xl px-4 py-3 text-[12px] ${sub} flex gap-2 items-start`}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <span className={isDark ? 'text-amber-400' : 'text-amber-700'}>Note —</span>{' '}
              AI cost data is reliable from <strong>2026-05-08 18:00 UTC</strong> onward. 12 callsites were silently
              unbilled before that fix; earlier months/orgs showing <strong>$0</strong> are undercounted, not zero-spend.
              Going forward every call writes a UsageEvent row with orgId + userId + clientId.
            </div>
          </div>
        </>
      )}

      <section className={`${card} rounded-2xl overflow-hidden`}>
        <div className={`px-5 py-3 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'} flex items-center gap-2`}>
          <Boxes size={16} className={sub} />
          <h2 className={`text-sm font-semibold ${text}`}>Organizations</h2>
        </div>
        <table className={`w-full text-sm ${text}`}>
          <thead className={`${isDark ? 'bg-white/[0.02] text-zinc-400' : 'bg-slate-50 text-slate-500'} text-[11px] uppercase tracking-wider`}>
            <tr>
              <th className="text-left px-5 py-2.5">Organization</th>
              <th className="text-left px-3 py-2.5">Plan</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th className="text-right px-3 py-2.5">MRR</th>
              <th className="text-right px-3 py-2.5">Seats</th>
              <th className="text-right px-3 py-2.5">Clients</th>
              <th className="text-right px-3 py-2.5"><CalendarIcon size={12} className="inline" /> Months</th>
              <th className="text-left px-5 py-2.5">Created</th>
              <th className="text-right px-5 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr><td colSpan={9} className={`px-5 py-8 text-center ${sub}`}>No orgs yet.</td></tr>
            )}
            {orgs.map((o) => (
              <tr key={o.id} className={isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                <td className="px-5 py-3">
                  <div className="font-semibold">{o.name}</div>
                  <div className={`text-[11px] ${sub}`}>{o.slug}</div>
                </td>
                <td className={`px-3 py-3 uppercase text-[11px] tracking-wider ${o.plan === 'agency' ? numeric : sub}`}>{o.plan}</td>
                <td className={`px-3 py-3 text-[11px] ${o.status === 'active' ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : sub}`}>{o.status}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtUsd(o.mrr)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{o.seats}</td>
                <td className="px-3 py-3 text-right tabular-nums">{o.clients}</td>
                <td className="px-3 py-3 text-right tabular-nums">{o.calendars}</td>
                <td className={`px-5 py-3 text-[12px] ${sub}`}>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right">
                  {o.slug === 'radix-media' ? (
                    <span className={`text-[11px] ${sub}`}>primary</span>
                  ) : (
                    <button
                      onClick={() => handleDeleteOrg(o)}
                      title={`Delete workspace "${o.name}"`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer hover:bg-[color:var(--color-danger-subtle)]"
                      style={{ color: 'var(--color-danger)' }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Usage reports — finance ────────────────────────────── */}
      <section className={`${card} rounded-2xl overflow-hidden`}>
        <div className={`px-5 py-3 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'} flex items-center gap-2`}>
          <BarChart3 size={16} className={sub} />
          <h2 className={`text-sm font-semibold ${text}`}>Usage reports — finance</h2>
        </div>

        {/* Filter bar */}
        <div className={`px-5 py-3 border-b ${isDark ? 'border-white/[0.06]' : 'border-slate-200'} flex flex-wrap gap-3 items-end`}>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] uppercase tracking-wider ${sub}`}>Organization</label>
            <select
              value={usageOrgId}
              onChange={(e) => setUsageOrgId(e.target.value)}
              className={`${inputCls} rounded-lg px-3 py-1.5 text-sm`}
            >
              {orgs.length === 0 && <option value="">No orgs</option>}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] uppercase tracking-wider ${sub}`}>From</label>
            <input
              type="date"
              value={usageFrom}
              onChange={(e) => setUsageFrom(e.target.value)}
              className={`${inputCls} rounded-lg px-3 py-1.5 text-sm`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] uppercase tracking-wider ${sub}`}>To</label>
            <input
              type="date"
              value={usageTo}
              onChange={(e) => setUsageTo(e.target.value)}
              className={`${inputCls} rounded-lg px-3 py-1.5 text-sm`}
            />
          </div>
          <button
            onClick={handleExportCsv}
            disabled={!usageOrgId || exportBusy}
            className={`ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${
              isDark
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Download size={14} />
            {exportBusy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        {usageError && (
          <div className={`px-5 py-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{usageError}</div>
        )}
        {usageLoading && !usageTotals && (
          <div className={`px-5 py-6 text-sm ${sub}`}>Loading usage…</div>
        )}

        {/* Sub-section 1: Totals tiles */}
        {usageTotals && (
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-transparent">
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<Activity size={16} />} label="Calls" value={String(usageTotals.calls)} foot={`${Object.keys(usageTotals.byKind).length} kinds`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<Boxes size={16} />} label="Tokens / units" value={fmtTokens(usageTotals.units)} foot={`${usageTotals.units.toLocaleString()} raw`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<DollarSign size={16} />} label="Cost (USD)" value={fmtUsdPrecise(usageTotals.costUsd)} foot={`${Object.keys(usageTotals.byProvider).length} providers`} />
            <Tile card={card} text={text} sub={sub} num={numeric} icon={<TrendingUp size={16} />} label="Top model" value={topModelName} foot={usageTotals.topModels[0] ? fmtUsdPrecise(usageTotals.topModels[0].costUsd) : '—'} />
          </div>
        )}

        {/* Sub-section 2: Per user table */}
        <div className={`border-t ${isDark ? 'border-white/[0.06]' : 'border-slate-200'}`}>
          <div className={`px-5 py-2.5 flex items-center gap-2`}>
            <Users size={14} className={sub} />
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${text}`}>Per user</h3>
          </div>
          <table className={`w-full text-sm ${text}`}>
            <thead className={`${isDark ? 'bg-white/[0.02] text-zinc-400' : 'bg-slate-50 text-slate-500'} text-[11px] uppercase tracking-wider`}>
              <tr>
                <th className="text-left px-5 py-2.5">User</th>
                <th className="text-right px-3 py-2.5">Calls</th>
                <th className="text-right px-3 py-2.5">Tokens</th>
                <th className="text-right px-5 py-2.5">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {usageByUser.length === 0 && (
                <tr><td colSpan={4} className={`px-5 py-6 text-center ${sub}`}>{usageLoading ? '…' : 'No usage in range.'}</td></tr>
              )}
              {usageByUser.map((u) => (
                <tr key={u.userId ?? '__null__'} className={isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.userEmail || u.userName || '(unknown user)'}</div>
                    {u.userName && u.userEmail && <div className={`text-[11px] ${sub}`}>{u.userName}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{u.calls}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtTokens(u.units)}</td>
                  <td className={`px-5 py-3 text-right tabular-nums ${numeric}`}>{fmtUsdPrecise(u.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sub-section 3: Daily trend */}
        <div className={`border-t ${isDark ? 'border-white/[0.06]' : 'border-slate-200'}`}>
          <div className={`px-5 py-2.5 flex items-center gap-2`}>
            <CalendarIcon size={14} className={sub} />
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${text}`}>Daily trend</h3>
          </div>
          <table className={`w-full text-sm ${text}`}>
            <thead className={`${isDark ? 'bg-white/[0.02] text-zinc-400' : 'bg-slate-50 text-slate-500'} text-[11px] uppercase tracking-wider`}>
              <tr>
                <th className="text-left px-5 py-2.5">Date</th>
                <th className="text-right px-3 py-2.5">Calls</th>
                <th className="text-right px-5 py-2.5">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {usageByDay.length === 0 && (
                <tr><td colSpan={3} className={`px-5 py-6 text-center ${sub}`}>{usageLoading ? '…' : 'No daily activity.'}</td></tr>
              )}
              {usageByDay.map((d) => (
                <tr key={d.date} className={isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                  <td className={`px-5 py-2.5 text-[12px] ${sub}`}>{fmtDate(d.date)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.calls}</td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${numeric}`}>{fmtUsdPrecise(d.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sub-section 4: Per model breakdown (cost attribution by model) */}
        <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className={`px-5 py-2.5 flex items-center gap-2`}>
            <BarChart3 size={14} className={sub} />
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${text}`}>By model</h3>
          </div>
          {/* Semantic tokens (not raw zinc/slate) so the raw-color audit stays
              flat; tokens auto-switch on theme, so no isDark ternary needed. */}
          <table className={`w-full text-sm ${text}`}>
            <thead className="text-[11px] uppercase tracking-wider" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-fg-muted)' }}>
              <tr>
                <th className="text-left px-5 py-2.5">Model</th>
                <th className="text-right px-3 py-2.5">Calls</th>
                <th className="text-right px-5 py-2.5">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {(!usageTotals || usageTotals.topModels.length === 0) && (
                <tr><td colSpan={3} className={`px-5 py-6 text-center ${sub}`}>{usageLoading ? '…' : 'No model usage in range.'}</td></tr>
              )}
              {usageTotals?.topModels.map((m) => (
                <tr key={m.model} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-5 py-2.5 font-medium">{m.model}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.calls}</td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${numeric}`}>{fmtUsdPrecise(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sub-section 5: Activity feed (audit log) */}
        <div className={`border-t ${isDark ? 'border-white/[0.06]' : 'border-slate-200'}`}>
          <div className={`px-5 py-2.5 flex items-center gap-2`}>
            <FileText size={14} className={sub} />
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${text}`}>Activity feed</h3>
            <span className={`text-[11px] ${sub} ml-auto`}>last {auditLog.length}</span>
          </div>
          <table className={`w-full text-sm ${text}`}>
            <thead className={`${isDark ? 'bg-white/[0.02] text-zinc-400' : 'bg-slate-50 text-slate-500'} text-[11px] uppercase tracking-wider`}>
              <tr>
                <th className="text-left px-5 py-2.5">Time</th>
                <th className="text-left px-3 py-2.5">User</th>
                <th className="text-left px-3 py-2.5">Action</th>
                <th className="text-left px-5 py-2.5">Entity</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 && (
                <tr><td colSpan={4} className={`px-5 py-6 text-center ${sub}`}>{usageLoading ? '…' : 'No recent activity.'}</td></tr>
              )}
              {auditLog.map((a) => (
                <tr key={a.id} className={isDark ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                  <td className={`px-5 py-2.5 text-[12px] ${sub} tabular-nums`}>{fmtDateTime(a.createdAt)}</td>
                  <td className="px-3 py-2.5 text-[12px]">{a.userEmail || a.userId || '—'}</td>
                  <td className={`px-3 py-2.5 text-[12px] ${numeric}`}>{a.action}</td>
                  <td className={`px-5 py-2.5 text-[12px] ${sub}`}>
                    {a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ card, text, sub, num, icon, label, value, foot }: { card: string; text: string; sub: string; num: string; icon: React.ReactNode; label: string; value: string; foot: string }) {
  return (
    <div className={`${card} rounded-2xl p-5`}>
      <div className={`flex items-center gap-2 ${sub} text-[11px] uppercase tracking-wider`}>
        {icon}
        {label}
      </div>
      <div className={`text-3xl font-bold tabular-nums mt-2 ${num}`}>{value}</div>
      <div className={`text-[11px] mt-1 ${sub}`}>{foot}</div>
    </div>
  );
}
