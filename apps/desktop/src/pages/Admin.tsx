// Cross-org admin dashboard. Gated server-side on STAFF_EMAILS — non-staff
// users get 403 here and the route returns null so the page silently no-ops.
// Surfaces MRR, ARR, AI cost vs revenue, and per-org breakdown.

import { useEffect, useState } from 'react';
import { adminApi, type AdminMetrics, type AdminOrg } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { t } from '../i18n';
import { Building2, DollarSign, TrendingUp, AlertCircle, Users, Boxes, Calendar as CalendarIcon } from 'lucide-react';

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function Admin() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Tile card={card} text={text} sub={sub} num={numeric} icon={<DollarSign size={16} />} label="MRR" value={fmtUsd(metrics.mrr)} foot={`ARR ${fmtUsd(metrics.arr)}`} />
          <Tile card={card} text={text} sub={sub} num={numeric} icon={<TrendingUp size={16} />} label="Gross margin (mo)" value={fmtUsd(metrics.monthGrossMarginUsd)} foot={`AI cost ${fmtUsd(metrics.monthAiCostUsd)}`} />
          <Tile card={card} text={text} sub={sub} num={numeric} icon={<Building2 size={16} />} label="Paying orgs" value={String(metrics.paidOrgs)} foot={`${metrics.trialOrgs} on trial`} />
          <Tile card={card} text={text} sub={sub} num={numeric} icon={<Users size={16} />} label="Total seats" value={String(metrics.totalSeats)} foot={`${fmtTokens(metrics.monthAiTokens)} tokens (mo)`} />
        </div>
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
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr><td colSpan={8} className={`px-5 py-8 text-center ${sub}`}>No orgs yet.</td></tr>
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
              </tr>
            ))}
          </tbody>
        </table>
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
