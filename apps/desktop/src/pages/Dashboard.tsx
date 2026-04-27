import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, FileText, Layers, Wand2, ArrowRight, Activity, CheckCircle2, Zap, Clock, ArrowUpRight, BarChart3, Users, Database, Sparkles, TrendingUp, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useClients } from '../lib/client-context';
import { dashboardApi, authApi, type DashboardStats } from '../lib/backend-api';
import { useTheme } from '../lib/theme-context';
import { greeting } from '../lib/greeting';

// Valid month format: "Month YYYY" e.g. "April 2026"
const VALID_MONTH_RE = /^[A-Z][a-z]+ \d{4}$/;
const SMOKE_RE = /^VPS Smoke|smoke/i;

function SkeletonTile({ isDark }: { isDark: boolean }) {
  return <div className={`h-8 w-16 rounded ${isDark ? 'bg-white/[0.05]' : 'bg-slate-200/60'} animate-pulse`} />;
}

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

function getRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const prevValueRef = useRef<number | null>(null);
  useEffect(() => {
    // L1: only animate when target actually changed
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;
    if (value === 0) { setDisplay(0); return; }
    const duration = 800;
    const steps = 30;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(Math.floor(current));
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display}</>;
}

export default function Dashboard() {
  const { clients, currentClient, authenticated } = useClients();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    dashboardApi.stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
    authApi.me()
      .then((me) => setUserName(me?.name ?? null))
      .catch(() => setUserName(null));
  }, [authenticated]);

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const heroGreeting = greeting(new Date().getHours(), userName?.split(' ')[0]);

  const totalPosts = stats?.content.totalPosts || 0;
  const approvedPosts = stats?.content.byStatus.approved || 0;
  const approvalRate = totalPosts > 0 ? Math.round((approvedPosts / totalPosts) * 100) : 0;

  // Glass card base classes
  const glass = isDark
    ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.05]'
    : 'bg-white/80 backdrop-blur-xl border border-slate-200/80 hover:border-slate-300 hover:shadow-md shadow-sm';
  const glassStatic = isDark
    ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.06]'
    : 'bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-sm';

  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-zinc-400' : 'text-slate-500';
  const textMuted = isDark ? 'text-zinc-600' : 'text-slate-400';
  const textDim = isDark ? 'text-zinc-700' : 'text-slate-300';

  // Skeleton loader
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse rounded-lg ${isDark ? 'bg-white/[0.04]' : 'bg-slate-200/60'} ${className}`} />
  );

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* ─── ROW 1: Hero CTA + Welcome ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Hero: New Brief CTA — Bento 2x1 */}
        <motion.div {...fadeUp(0)} className="col-span-12 lg:col-span-8">
          <Link
            to="/brief"
            className={`group relative block overflow-hidden rounded-2xl p-8 lg:p-10 cursor-pointer transition-all duration-300 ${glass}`}
          >
            {/* Ambient glow */}
            <div className={`absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl transition-all duration-700 ${isDark ? 'bg-amber-500/[0.04] group-hover:bg-amber-500/[0.08]' : 'bg-amber-200/20 group-hover:bg-amber-200/40'}`} />
            <div className={`absolute -bottom-24 -left-24 w-72 h-72 rounded-full blur-3xl ${isDark ? 'bg-blue-500/[0.03]' : 'bg-blue-100/30'}`} />

            <div className="relative z-10">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.15em] mb-6 ${isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                AI Ready
              </div>

              <h1 className={`text-3xl md:text-4xl lg:text-5xl font-black tracking-tight leading-[1.1] mb-4 ${textPrimary}`}>
                Create Content<br />
                <span className={textSecondary}>From Brief</span>
              </h1>

              <p className={`text-base max-w-md leading-relaxed mb-8 ${textSecondary}`}>
                Input your client brief. AI generates content pieces with captions, visuals, and hashtags — platform-optimized.
              </p>

              <div className={`inline-flex items-center gap-3 font-semibold text-sm group-hover:gap-4 transition-all duration-300 ${textPrimary}`}>
                <span className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${isDark ? 'bg-amber-500 text-black group-hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'bg-amber-500 text-white group-hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]'}`}>
                  <ArrowRight className="w-5 h-5" />
                </span>
                Start New Brief
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Right column: Welcome + Quick Stat */}
        <motion.div {...fadeUp(0.1)} className="col-span-12 lg:col-span-4 flex flex-col gap-5">
          <div className={`flex-1 flex flex-col justify-center rounded-2xl p-6 ${glassStatic}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] mb-2 ${textMuted}`}>{currentDate}</p>
            <h2 className={`text-2xl font-bold mb-1 ${textPrimary}`}>{heroGreeting}</h2>
            <p className={`text-sm ${textSecondary}`}>{currentClient?.name || 'Select a client'}</p>
          </div>

          <div className={`flex-1 rounded-2xl p-6 ${glassStatic}`}>
            {loading || stats == null ? (
              <div className="space-y-3"><Skeleton className="h-4 w-20" /><SkeletonTile isDark={isDark} /><Skeleton className="h-3 w-32" /></div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <Zap className="w-5 h-5 text-amber-500" />
                  {stats.content.totalMonths > 0 && (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                      {stats.content.totalMonths} months
                    </span>
                  )}
                </div>
                <div className={`text-3xl font-black tabular-nums ${textPrimary}`}>
                  <AnimatedNumber value={totalPosts} />
                </div>
                <p className={`text-xs mt-1 ${textMuted}`}>Total posts generated</p>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* ─── ROW 2: Stat Cards — Bento 4x1 ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || stats == null ? (
          Array.from({ length: 4 }).map((_, i) => (
            <motion.div key={i} {...fadeUp(0.15 + i * 0.05)} className={`rounded-2xl p-5 ${glassStatic}`}>
              <div className="space-y-3"><Skeleton className="h-4 w-16" /><SkeletonTile isDark={isDark} /></div>
            </motion.div>
          ))
        ) : (
          (() => {
            const knowledgeItems = stats.knowledge.totalItems || 0;
            const lowApproval = totalPosts > 0 && approvalRate < 50; // M6
            const tiles = [
              { key: 'clients', icon: Users, label: 'Clients', value: stats.clients.total ?? 0, sub: stats.clients.withBrief ? `${stats.clients.withBrief} with brief` : '', color: 'text-blue-400', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-50' },
              { key: 'calendars', icon: Calendar, label: 'Calendars', value: stats.content.totalMonths ?? 0, sub: '', color: 'text-purple-400', bg: isDark ? 'bg-purple-500/10' : 'bg-purple-50' },
              {
                key: 'approval',
                icon: lowApproval ? AlertTriangle : CheckCircle2,
                label: 'Approval',
                value: `${approvalRate}%`,
                // M2: guard against empty-label-no-value. Always show something.
                sub: lowApproval
                  ? 'Needs attention'
                  : approvalRate >= 80 ? 'Healthy' : approvalRate > 0 ? 'Needs review' : '—',
                color: lowApproval ? 'text-red-400' : 'text-emerald-400',
                bg: lowApproval ? (isDark ? 'bg-red-500/10' : 'bg-red-50') : (isDark ? 'bg-emerald-500/10' : 'bg-emerald-50'),
                href: '/content-review',
                alert: lowApproval,
              },
              { key: 'knowledge', icon: Database, label: 'Knowledge', value: knowledgeItems, sub: stats.knowledge.totalChunks ? `${stats.knowledge.totalChunks} chunks` : '', color: 'text-amber-400', bg: isDark ? 'bg-amber-500/10' : 'bg-amber-50', zeroCta: knowledgeItems === 0 },
            ];
            return tiles.map((stat, i) => {
              const inner = (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                    {stat.sub && (
                      <span className={`text-[10px] font-medium ${stat.color} ${stat.bg} px-2 py-0.5 rounded-full`}>{stat.sub}</span>
                    )}
                  </div>
                  {/* M1: Knowledge zero-state inline CTA in place of the big "0" */}
                  {stat.zeroCta ? (
                    <>
                      <Link to="/knowledge" className="text-xs text-amber-400 hover:text-amber-300">+ Add knowledge</Link>
                      <p className={`text-xs mt-1 ${textMuted}`}>Upload briefs, brand guides to personalize AI</p>
                    </>
                  ) : (
                    <>
                      <div className={`text-2xl font-black tabular-nums ${stat.alert ? 'text-red-400' : textPrimary}`}>
                        {typeof stat.value === 'number' ? <AnimatedNumber value={stat.value} /> : (stat.value ?? '—')}
                      </div>
                      <p className={`text-xs mt-1 ${textMuted}`}>{stat.label}</p>
                    </>
                  )}
                </>
              );
              // M6: wrap approval tile in Link when below threshold
              if (stat.href) {
                return (
                  <motion.div key={stat.key} {...fadeUp(0.15 + i * 0.05)}>
                    <Link to={stat.href} className={`block rounded-2xl p-5 ${glassStatic}`}>
                      {inner}
                    </Link>
                  </motion.div>
                );
              }
              return (
                <motion.div key={stat.key} {...fadeUp(0.15 + i * 0.05)} className={`rounded-2xl p-5 ${glassStatic}`}>
                  {inner}
                </motion.div>
              );
            });
          })()
        )}
      </div>

      {/* ─── ROW 3: Platform Mix + Activity + Quick Actions ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Platform breakdown */}
        <motion.div {...fadeUp(0.3)} className="col-span-12 lg:col-span-5">
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                <BarChart3 className={`w-4 h-4 ${textSecondary}`} /> Platform Mix
              </h3>
              <Link to="/calendar" className={`text-[10px] hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer ${textMuted}`}>
                View <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            {loading ? <div className="space-y-4">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-6 w-full" />)}</div> : (() => {
              const platforms = stats?.content.byPlatform || {};
              const total = Object.values(platforms).reduce((a, b) => a + b, 0) || 1;
              const colors: Record<string, string> = {
                Instagram: 'bg-gradient-to-r from-pink-500 to-rose-400', TikTok: 'bg-gradient-to-r from-zinc-400 to-zinc-300',
                LinkedIn: 'bg-gradient-to-r from-blue-500 to-blue-400', X: 'bg-gradient-to-r from-sky-500 to-sky-400',
                Facebook: 'bg-gradient-to-r from-indigo-500 to-indigo-400',
              };
              const entries = Object.entries(platforms).sort(([,a], [,b]) => b - a);
              if (entries.length === 0) return <p className={`text-xs text-center py-6 ${textMuted}`}>No posts yet</p>;
              return (
                <div className="space-y-4">
                  {entries.map(([platform, count]) => (
                    <div key={platform}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className={textSecondary}>{platform}</span>
                        <span className={`font-medium tabular-nums ${textPrimary}`}>{count}</span>
                      </div>
                      <div className={`h-2 w-full rounded-full overflow-hidden ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max((count / total) * 100, 8)}%` }}
                          transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
                          className={`h-full rounded-full ${colors[platform] || 'bg-amber-500'}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </motion.div>

        {/* Recent activity */}
        <motion.div {...fadeUp(0.35)} className="col-span-12 lg:col-span-4">
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <h3 className={`text-sm font-semibold flex items-center gap-2 mb-5 ${textPrimary}`}>
              <Clock className={`w-4 h-4 ${textSecondary}`} /> Recent Months
            </h3>
            {loading ? <div className="space-y-4">{Array.from({length:3}).map((_,i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : (() => {
              const rawMonths = stats?.activity.recentMonths || [];
              // H1: hide smoke-test months, mark any month that doesn't match the "Month YYYY" shape as [test]
              const months = rawMonths
                .filter((m: any) => !SMOKE_RE.test(m.month || ''))
                .map((m: any) => ({ ...m, _isTest: !VALID_MONTH_RE.test(m.month || '') }));
              // H3: detect duplicate month labels
              const labelCount: Record<string, number> = {};
              months.forEach((m: any) => { labelCount[m.month] = (labelCount[m.month] || 0) + 1; });
              if (months.length === 0) return <p className={`text-xs text-center py-6 ${textMuted}`}>No generated content yet</p>;
              return (
                <div className="space-y-2">
                  {months.map((m: any) => {
                    const isDup = labelCount[m.month] > 1;
                    const briefId = m.briefId || m.brief_id || m.id;
                    const briefName = m.briefName || m.brief_name;
                    const briefShort = briefId ? String(briefId).slice(0, 6) : '';
                    const href = `/calendar?month=${encodeURIComponent(m.month)}${briefId ? `&brief=${encodeURIComponent(briefId)}` : ''}`;
                    return (
                      <Link key={m.id} to={href}
                        className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer group ${isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50'}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isDark ? 'bg-white/[0.04] group-hover:bg-white/[0.08]' : 'bg-slate-100 group-hover:bg-slate-200'}`}>
                          <Activity className={`w-4 h-4 ${textMuted}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate transition-colors ${isDark ? 'text-zinc-300 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-900'}`}>
                            {m.month}{isDup && briefShort ? ` (#${briefShort})` : ''}
                            {m._isTest && <span className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${textMuted} ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>test</span>}
                          </p>
                          {isDup && briefName ? (
                            <p className={`text-[10px] ${textMuted}`}>{m.postCount} posts · {getRelativeTime(m.createdAt)} · {briefName}</p>
                          ) : (
                            <p className={`text-[10px] ${textMuted}`}>{m.postCount} posts · {getRelativeTime(m.createdAt)}</p>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          m.status === 'draft' ? isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-500' :
                          m.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>{m.status}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div {...fadeUp(0.4)} className="col-span-12 lg:col-span-3 flex flex-col gap-3">
          {[
            { label: 'Review Content', href: '/content-review', icon: Layers, desc: 'Approve pieces', color: 'text-purple-400', bg: isDark ? 'bg-purple-500/10' : 'bg-purple-50' },
            { label: 'Calendar', href: '/calendar', icon: Calendar, desc: 'View schedule', color: 'text-blue-400', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-50' },
            { label: 'Creative Tools', href: '/creative', icon: Wand2, desc: 'Generate visuals', color: 'text-amber-400', bg: isDark ? 'bg-amber-500/10' : 'bg-amber-50' },
          ].map((action) => (
            <Link
              key={action.label}
              to={action.href}
              className={`flex items-center gap-3 rounded-2xl p-4 group transition-all duration-200 cursor-pointer flex-1 ${glass}`}
            >
              <div className={`w-10 h-10 rounded-xl ${action.bg} flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105`}>
                <action.icon className={`w-4.5 h-4.5 ${action.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium transition-colors ${isDark ? 'text-zinc-200 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-900'}`}>{action.label}</p>
                <p className={`text-[10px] ${textMuted}`}>{action.desc}</p>
              </div>
              <ArrowRight className={`w-3.5 h-3.5 transition-all duration-200 group-hover:translate-x-0.5 ${isDark ? 'text-zinc-700 group-hover:text-zinc-400' : 'text-slate-300 group-hover:text-slate-500'}`} />
            </Link>
          ))}
        </motion.div>
      </div>

      {/* ─── ROW 4: Client Overview ─── */}
      {clients.length > 0 && (
        <motion.div {...fadeUp(0.45)}>
          <div className={`rounded-2xl p-6 ${glassStatic}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${textPrimary}`}>
                <Users className={`w-4 h-4 ${textSecondary}`} /> Clients
              </h3>
              <Link to="/clients" className={`text-[10px] hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer ${textMuted}`}>
                Manage <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {clients.slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  to={`/calendar?client=${c.id}`}
                  className={`rounded-xl p-4 transition-all duration-200 cursor-pointer group ${isDark ? 'bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.04]' : 'bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-white'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold ${isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                      {c.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate transition-colors ${isDark ? 'text-zinc-200 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-900'}`}>{c.name}</p>
                      <p className={`text-[10px] ${textMuted}`}>{c.industry || 'No industry set'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && clients.length === 0 && (
        <motion.div {...fadeUp(0.3)}>
          <div className={`rounded-2xl p-12 text-center ${glassStatic}`}>
            <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
              <Sparkles className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className={`text-lg font-bold mb-2 ${textPrimary}`}>No clients yet</h3>
            <p className={`text-sm mb-6 ${textSecondary}`}>Create your first client to start generating AI-powered content.</p>
            <Link to="/clients" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-black font-semibold text-sm hover:bg-amber-400 transition-colors cursor-pointer">
              <Users className="w-4 h-4" /> Add Client
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  );
}
