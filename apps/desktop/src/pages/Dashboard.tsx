import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, FileText, Layers, Wand2, ArrowRight, Activity, CheckCircle2, Zap, Clock, ArrowUpRight, BarChart3, Users, Database, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useClients } from '../lib/client-context';
import { dashboardApi, type DashboardStats } from '../lib/backend-api';
import { Card, StatCard, EmptyState, LoadingSkeleton, StatusBadge } from '../components/ui';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
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

export default function Dashboard() {
  const { clients, currentClient, authenticated } = useClients();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authenticated) return;
    dashboardApi.stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [authenticated]);

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const totalPosts = stats?.content.totalPosts || 0;
  const approvedPosts = stats?.content.byStatus.approved || 0;
  const approvalRate = totalPosts > 0 ? Math.round((approvedPosts / totalPosts) * 100) : 0;

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* ─── ROW 1: Hero CTA + Date ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Hero: New Brief CTA */}
        <motion.div {...fadeUp(0)} className="col-span-12 lg:col-span-8">
          <Link
            to="/brief"
            className="group relative block overflow-hidden rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-8 lg:p-10 cursor-pointer transition-all duration-500 hover:border-white/[0.12]"
          >
            <div className="absolute -top-32 -right-32 w-80 h-80 bg-white/[0.03] rounded-full blur-3xl group-hover:bg-white/[0.06] transition-all duration-700" />
            <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-white/[0.02] rounded-full blur-3xl" />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                AI Ready
              </div>

              <h1 className="text-4xl lg:text-5xl font-black text-white tracking-tight leading-[1.1] mb-4">
                Create Content<br />
                <span className="text-zinc-500">From Brief</span>
              </h1>

              <p className="text-zinc-500 text-lg max-w-md leading-relaxed mb-8">
                Input your client brief. AI generates content pieces with captions, visuals, and hashtags — platform-optimized.
              </p>

              <div className="inline-flex items-center gap-3 text-white font-semibold text-sm group-hover:gap-4 transition-all duration-300">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white text-black">
                  <ArrowRight className="w-5 h-5" />
                </span>
                Start New Brief
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Right column: Date + Quick stat */}
        <motion.div {...fadeUp(0.1)} className="col-span-12 lg:col-span-4 flex flex-col gap-5">
          <Card className="flex-1 flex flex-col justify-center">
            <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-[0.2em] mb-2">{currentDate}</p>
            <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
            <p className="text-zinc-500 text-sm">{currentClient?.name || 'Select a client'}</p>
          </Card>

          <Card className="flex-1">
            {loading ? <LoadingSkeleton lines={2} /> : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <Zap className="w-5 h-5 text-amber-400" />
                  {stats && stats.content.totalMonths > 0 && (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      {stats.content.totalMonths} months
                    </span>
                  )}
                </div>
                <div className="text-3xl font-black text-white tabular-nums">{totalPosts}</div>
                <p className="text-xs text-zinc-600 mt-1">Total posts generated</p>
              </>
            )}
          </Card>
        </motion.div>
      </div>

      {/* ─── ROW 2: Stat Cards (real data) ─── */}
      <div className="grid grid-cols-12 gap-5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <motion.div key={i} {...fadeUp(0.15 + i * 0.05)} className="col-span-6 lg:col-span-3">
              <Card><LoadingSkeleton lines={2} /></Card>
            </motion.div>
          ))
        ) : (
          <>
            <motion.div {...fadeUp(0.15)} className="col-span-6 lg:col-span-3">
              <StatCard icon={Users} label="Clients" value={stats?.clients.total || 0}
                trend={stats?.clients.withBrief ? { value: `${stats.clients.withBrief} with brief`, positive: true } : undefined} />
            </motion.div>
            <motion.div {...fadeUp(0.2)} className="col-span-6 lg:col-span-3">
              <StatCard icon={Calendar} label="Calendar Months" value={stats?.content.totalMonths || 0} />
            </motion.div>
            <motion.div {...fadeUp(0.25)} className="col-span-6 lg:col-span-3">
              <StatCard icon={CheckCircle2} label="Approval Rate" value={`${approvalRate}%`}
                trend={approvalRate >= 80 ? { value: 'Healthy', positive: true } : approvalRate > 0 ? { value: 'Needs review', positive: false } : undefined} />
            </motion.div>
            <motion.div {...fadeUp(0.3)} className="col-span-6 lg:col-span-3">
              <StatCard icon={Database} label="Knowledge Items" value={stats?.knowledge.totalItems || 0}
                trend={stats?.knowledge.totalChunks ? { value: `${stats.knowledge.totalChunks} chunks`, positive: true } : undefined} />
            </motion.div>
          </>
        )}
      </div>

      {/* ─── ROW 3: Platform Mix + Activity + Quick Actions ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Platform breakdown */}
        <motion.div {...fadeUp(0.3)} className="col-span-12 lg:col-span-5">
          <Card>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-zinc-500" /> Platform Mix
              </h3>
              <Link to="/calendar" className="text-[10px] text-zinc-600 hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
                View <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            {loading ? <LoadingSkeleton lines={4} /> : (() => {
              const platforms = stats?.content.byPlatform || {};
              const total = Object.values(platforms).reduce((a, b) => a + b, 0) || 1;
              const colors: Record<string, string> = {
                Instagram: 'bg-pink-500', TikTok: 'bg-zinc-400', LinkedIn: 'bg-blue-500',
                X: 'bg-sky-500', Facebook: 'bg-indigo-500',
              };
              const entries = Object.entries(platforms).sort(([,a], [,b]) => b - a);
              if (entries.length === 0) return <p className="text-xs text-zinc-700 text-center py-4">No posts yet</p>;
              return (
                <div className="space-y-3">
                  {entries.map(([platform, count]) => (
                    <div key={platform}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-zinc-500">{platform}</span>
                        <span className="text-zinc-400 font-medium tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
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
          </Card>
        </motion.div>

        {/* Recent activity */}
        <motion.div {...fadeUp(0.35)} className="col-span-12 lg:col-span-4">
          <Card>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-5">
              <Clock className="w-4 h-4 text-zinc-500" /> Recent Months
            </h3>
            {loading ? <LoadingSkeleton lines={4} /> : (() => {
              const months = stats?.activity.recentMonths || [];
              if (months.length === 0) return <p className="text-xs text-zinc-700 text-center py-4">No generated content yet</p>;
              return (
                <div className="space-y-3">
                  {months.map((m) => (
                    <Link key={m.id} to={`/calendar?month=${encodeURIComponent(m.month)}`}
                      className="flex items-start gap-3 group cursor-pointer">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-white/[0.08] transition-colors">
                        <Activity className="w-3.5 h-3.5 text-zinc-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-zinc-300 truncate group-hover:text-white transition-colors">{m.month}</p>
                          <StatusBadge status={m.status as any} size="sm" />
                        </div>
                        <p className="text-[10px] text-zinc-700">{m.postCount} posts · {getRelativeTime(m.createdAt)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })()}
          </Card>
        </motion.div>

        {/* Quick Actions */}
        <motion.div {...fadeUp(0.4)} className="col-span-12 lg:col-span-3 flex flex-col gap-3">
          {[
            { label: 'Review Content', href: '/content-review', icon: Layers, desc: 'Approve pieces' },
            { label: 'Calendar', href: '/calendar', icon: Calendar, desc: 'View schedule' },
            { label: 'Creative Tools', href: '/creative', icon: Wand2, desc: 'Generate visuals' },
          ].map((action) => (
            <Link
              key={action.label}
              to={action.href}
              className="flex items-center gap-3 rounded-2xl bg-[#0c0c0c] border border-white/[0.06] p-4 group hover:border-white/[0.1] transition-all cursor-pointer flex-1"
            >
              <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0 group-hover:bg-white/[0.08] transition-colors">
                <action.icon className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">{action.label}</p>
                <p className="text-[10px] text-zinc-700">{action.desc}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-800 group-hover:text-zinc-400 transition-colors" />
            </Link>
          ))}
        </motion.div>
      </div>

      {/* ─── ROW 4: Client Overview ─── */}
      {clients.length > 0 && (
        <motion.div {...fadeUp(0.45)}>
          <Card>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-500" /> Clients
              </h3>
              <Link to="/clients" className="text-[10px] text-zinc-600 hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
                Manage <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {clients.slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  to={`/calendar?client=${c.id}`}
                  className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 hover:border-white/[0.1] transition-all cursor-pointer group"
                >
                  <p className="text-sm font-medium text-zinc-300 truncate group-hover:text-white transition-colors">{c.name}</p>
                  <p className="text-[10px] text-zinc-700 mt-0.5">{c.industry || 'No industry set'}</p>
                </Link>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* ─── Empty state when no clients ─── */}
      {!loading && clients.length === 0 && (
        <motion.div {...fadeUp(0.3)}>
          <EmptyState
            icon={Sparkles}
            title="No clients yet"
            description="Create your first client to start generating AI-powered content."
            action={{ label: 'Add Client', onClick: () => window.location.hash = '#/clients' }}
          />
        </motion.div>
      )}
    </div>
  );
}
