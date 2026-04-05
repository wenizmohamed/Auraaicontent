import { Link } from 'react-router-dom';
import { Calendar, FileText, Layers, Wand2, ArrowRight, TrendingUp, Activity, CheckCircle2, Zap, Clock, Sparkles, ArrowUpRight, BarChart3, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';

function getRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function Dashboard() {
  const { activityLogs, getStats, pipelineItems, contentBriefs } = useStore();
  const stats = getStats();

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const recentBriefs = contentBriefs?.slice(0, 3) || [];

  const statusCounts = {
    draft: pipelineItems.filter(i => i.status === 'draft').length,
    review: pipelineItems.filter(i => i.status === 'in-review').length,
    approved: pipelineItems.filter(i => i.status === 'approved').length,
    published: pipelineItems.filter(i => i.status === 'published').length,
  };

  const logs = activityLogs.length > 0 ? activityLogs.slice(0, 4) : [
    { id: '1', action: 'Dashboard initialized', time: new Date().toISOString(), type: 'system' },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* ─── ROW 1: Hero CTA + Date ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Hero: New Brief CTA (spans 8 cols) */}
        <motion.div {...fadeUp(0)} className="col-span-12 lg:col-span-8">
          <Link
            to="/brief"
            className="group relative block overflow-hidden rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-8 lg:p-10 cursor-pointer transition-all duration-500 hover:border-white/[0.12]"
          >
            {/* Ambient glow */}
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
                Input your client brief. AI generates 18 content pieces with captions, visuals, and hashtags — platform-optimized.
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
          {/* Date card */}
          <div className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 flex-1 flex flex-col justify-center">
            <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-[0.2em] mb-2">{currentDate}</p>
            <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
            <p className="text-zinc-500 text-sm">Mohamed</p>
          </div>

          {/* AI Generations stat */}
          <div className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 flex-1">
            <div className="flex items-center justify-between mb-3">
              <Zap className="w-5 h-5 text-amber-400" />
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">+12%</span>
            </div>
            <div className="text-3xl font-black text-white">{stats.aiGenerations || 0}</div>
            <p className="text-xs text-zinc-600 mt-1">AI generations</p>
          </div>
        </motion.div>
      </div>

      {/* ─── ROW 2: Bento Stat Cards ─── */}
      <div className="grid grid-cols-12 gap-5">
        {[
          { label: 'Active Campaigns', value: stats.activeCampaigns || 0, icon: Activity, accent: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Posts This Month', value: stats.postsThisMonth || 0, icon: Calendar, accent: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Approval Rate', value: `${stats.approvalRate || 100}%`, icon: CheckCircle2, accent: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Clients', value: '13', icon: Users, accent: 'text-zinc-400', bg: 'bg-white/5' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            {...fadeUp(0.15 + i * 0.05)}
            className="col-span-6 lg:col-span-3 rounded-2xl bg-[#0c0c0c] border border-white/[0.06] p-5 group hover:border-white/[0.1] transition-all cursor-default"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-2 rounded-xl ${s.bg}`}>
                <s.icon className={`w-4 h-4 ${s.accent}`} />
              </div>
              <TrendingUp className="w-3.5 h-3.5 text-zinc-700 group-hover:text-emerald-500 transition-colors" />
            </div>
            <div className="text-2xl font-bold text-white">{s.value}</div>
            <p className="text-[11px] text-zinc-600 mt-0.5">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* ─── ROW 3: Pipeline + Activity + Quick Actions ─── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Pipeline overview (spans 5) */}
        <motion.div {...fadeUp(0.3)} className="col-span-12 lg:col-span-5 rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-zinc-500" /> Pipeline
            </h3>
            <Link to="/studio" className="text-[10px] text-zinc-600 hover:text-white transition-colors flex items-center gap-1">
              View <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {[
              { label: 'Draft', count: statusCounts.draft, color: 'bg-zinc-500', width: statusCounts.draft },
              { label: 'In Review', count: statusCounts.review, color: 'bg-blue-500', width: statusCounts.review },
              { label: 'Approved', count: statusCounts.approved, color: 'bg-emerald-500', width: statusCounts.approved },
              { label: 'Published', count: statusCounts.published, color: 'bg-white', width: statusCounts.published },
            ].map((s) => {
              const total = pipelineItems.length || 1;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-zinc-500">{s.label}</span>
                    <span className="text-zinc-400 font-medium">{s.count}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max((s.width / total) * 100, s.count > 0 ? 8 : 0)}%` }}
                      transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
                      className={`h-full rounded-full ${s.color}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Activity feed (spans 4) */}
        <motion.div {...fadeUp(0.35)} className="col-span-12 lg:col-span-4 rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-5">
            <Clock className="w-4 h-4 text-zinc-500" /> Recent Activity
          </h3>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 group">
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                  <Activity className="w-3.5 h-3.5 text-zinc-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 truncate">{log.action}</p>
                  <p className="text-[10px] text-zinc-700">{getRelativeTime(log.time)}</p>
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-xs text-zinc-700 text-center py-4">No activity yet</p>
            )}
          </div>
        </motion.div>

        {/* Quick Actions (spans 3) */}
        <motion.div {...fadeUp(0.4)} className="col-span-12 lg:col-span-3 flex flex-col gap-3">
          {[
            { label: 'Review Content', href: '/content-review', icon: Layers, desc: 'Approve pieces' },
            { label: 'Calendar', href: '/calendar', icon: Calendar, desc: 'View schedule' },
            { label: 'Creative Tools', href: '/image-gen', icon: Wand2, desc: 'Generate visuals' },
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

      {/* ─── ROW 4: Recent Briefs ─── */}
      {recentBriefs.length > 0 && (
        <motion.div {...fadeUp(0.45)} className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-zinc-500" /> Recent Briefs
            </h3>
            <Link to="/content-review" className="text-[10px] text-zinc-600 hover:text-white transition-colors flex items-center gap-1">
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recentBriefs.map((brief: any) => (
              <Link
                key={brief.id}
                to={`/content-review?briefId=${brief.id}`}
                className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-4 hover:border-white/[0.1] transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    brief.status === 'review' ? 'bg-amber-500/10 text-amber-400' :
                    brief.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-zinc-500/10 text-zinc-500'
                  }`}>{brief.status}</span>
                  <span className="text-[10px] text-zinc-700">{brief.pieces?.length || 0} pieces</span>
                </div>
                <p className="text-sm font-medium text-zinc-300 truncate group-hover:text-white transition-colors">{brief.month}</p>
                <p className="text-[10px] text-zinc-700 mt-0.5">{brief.platforms?.join(', ')}</p>
              </Link>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
