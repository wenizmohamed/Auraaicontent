import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Search as SearchIcon, ExternalLink, Sparkles, AlertCircle, FileSearch, Telescope, TrendingUp, Globe2 } from 'lucide-react';
import { researchApi } from '../lib/backend-api';
import { Skeleton, SkeletonText, SkeletonAnnouncer } from '../components/ui/Skeleton';

interface Source {
  title: string;
  url: string;
  snippet?: string;
}

export default function Research() {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'quick' | 'deep'>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [provider, setProvider] = useState('');

  const handleResearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setSummary('');
    setKeyPoints([]);
    setSources([]);
    setProvider('');

    try {
      const out = await researchApi.query(query.trim(), depth);
      setSummary(out.summary || '');
      setKeyPoints(out.keyPoints || []);
      setSources(out.sources || []);
      setProvider(out.provider || '');
    } catch (err: any) {
      setError(err?.message || 'Research failed');
    } finally {
      setLoading(false);
    }
  };

  // Suggestion chips — anchor users new to Research with concrete starts.
  const SUGGESTIONS = [
    { label: 'Ramadan 2026 marketing trends UAE', icon: TrendingUp },
    { label: 'GCC e-commerce post-conflict outlook', icon: Globe2 },
    { label: 'Saudi short-form video benchmarks', icon: Sparkles },
    { label: 'UAE Gen Z purchasing behavior', icon: TrendingUp },
    { label: 'Dubai luxury market 2026 forecast', icon: Globe2 },
  ];

  return (
    <div className="max-w-[900px] mx-auto space-y-6">
      {/* Hero — explains what Research does + ladders into the search input */}
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border"
        style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0.04) 50%, transparent 100%), var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 18px 50px -20px rgba(245,158,11,0.25), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full blur-3xl opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.5) 0%, transparent 70%)' }}
        />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border"
              style={{ background: 'var(--color-accent-subtle)', borderColor: 'rgba(245,158,11,0.30)' }}
            >
              <Telescope className="w-6 h-6" style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-fg-subtle)' }}>
                Strategy · Research
              </p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold leading-tight" style={{ color: 'var(--color-fg)' }}>
                Ask a topic, get the brief
              </h1>
              <p className="mt-2 text-sm leading-relaxed max-w-2xl" style={{ color: 'var(--color-fg-muted)' }}>
                Summary · key points · sources, returned by the AI router. Quick mode = 3-5 sources in ~5s. Deep mode = 5-8 sources in ~20s.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <label htmlFor="research-topic" className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Topic</label>
          <input
            id="research-topic"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleResearch()}
            placeholder="e.g. UAE remittance market trends 2026"
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60"
          />
          {/* Suggestion chips — visible only when input is empty, no loading, no results */}
          {!query.trim() && !loading && !summary && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold mt-1" style={{ color: 'var(--color-fg-subtle)' }}>
                Try
              </span>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setQuery(s.label)}
                  className="group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer hover:bg-[color:var(--color-surface-hover)]"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-fg-muted)' }}
                >
                  <s.icon className="w-3 h-3" style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepth('quick')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                depth === 'quick'
                  ? 'bg-[color:var(--color-accent-subtle)] text-[color:var(--color-accent)] border-[color:var(--color-accent)]/30'
                  : 'bg-white/[0.03] text-zinc-500 border-white/[0.06]'
              }`}
            >Quick</button>
            <button
              onClick={() => setDepth('deep')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                depth === 'deep'
                  ? 'bg-[color:var(--color-accent-subtle)] text-[color:var(--color-accent)] border-[color:var(--color-accent)]/30'
                  : 'bg-white/[0.03] text-zinc-500 border-white/[0.06]'
              }`}
            >Deep</button>
          </div>
          <button
            onClick={handleResearch}
            disabled={loading || !query.trim()}
            className="ml-auto flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
            {loading ? 'Researching...' : 'Research'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl px-4 py-3 flex items-start gap-3 bg-[color:var(--color-danger-subtle)] border border-[color:var(--color-danger)]/20">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--color-danger)]" />
            <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton — mirrors the Summary / Key Points / Sources result layout */}
      {loading && !summary && keyPoints.length === 0 && sources.length === 0 && (
        <div className="space-y-5">
          <SkeletonAnnouncer label="Researching — building summary, key points and sources…" />
          {/* Summary card */}
          <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
            <Skeleton width="30%" height={10} radius="sm" />
            <div className="mt-3">
              <SkeletonText lines={3} lineHeight={12} />
            </div>
          </div>
          {/* Key Points card */}
          <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
            <Skeleton width="24%" height={10} radius="sm" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} width={`${85 - i * 8}%`} height={12} radius="sm" delay={i * 60} />
              ))}
            </div>
          </div>
          {/* Sources card */}
          <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
            <Skeleton width="20%" height={10} radius="sm" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3">
                  <Skeleton width="55%" height={13} radius="sm" delay={i * 70} />
                  <div className="mt-2">
                    <Skeleton width="80%" height={10} radius="sm" delay={i * 70 + 40} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(summary || keyPoints.length > 0 || sources.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {summary && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-[color:var(--color-accent)]" />
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Summary</h3>
                {provider && <span className="ml-auto text-[10px] text-zinc-700">via {provider}</span>}
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{summary}</p>
            </div>
          )}

          {keyPoints.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Key Points</h3>
              <ul className="space-y-2">
                {keyPoints.map((kp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <span className="text-[color:var(--color-accent)] shrink-0">•</span>
                    <span>{kp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sources.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 shadow-sm">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Sources</h3>
              <div className="space-y-2">
                {sources.map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3 hover:border-[color:var(--color-accent)]/30 hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{src.title}</p>
                        {src.snippet && <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{src.snippet}</p>}
                        <p className="text-[10px] text-[color:var(--color-accent)]/70 mt-1 truncate">{src.url}</p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
