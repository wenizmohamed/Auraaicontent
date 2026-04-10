import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Search as SearchIcon, ExternalLink, Sparkles, AlertCircle, FileSearch } from 'lucide-react';
import { researchApi } from '../lib/backend-api';

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

  return (
    <div className="max-w-[900px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <FileSearch className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Research</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Topic research with summary, key points, and sources via the backend AI router.</p>
          </div>
        </div>
      </motion.div>

      <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Topic</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleResearch()}
            placeholder="e.g. UAE remittance market trends 2026"
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepth('quick')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                depth === 'quick'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-white/[0.03] text-zinc-500 border-white/[0.06]'
              }`}
            >Quick</button>
            <button
              onClick={() => setDepth('deep')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                depth === 'deep'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
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
            className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {(summary || keyPoints.length > 0 || sources.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {summary && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Summary</h3>
                {provider && <span className="ml-auto text-[10px] text-zinc-700">via {provider}</span>}
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{summary}</p>
            </div>
          )}

          {keyPoints.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Key Points</h3>
              <ul className="space-y-2">
                {keyPoints.map((kp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <span className="text-amber-400 shrink-0">•</span>
                    <span>{kp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sources.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Sources</h3>
              <div className="space-y-2">
                {sources.map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3 hover:border-amber-500/30 hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{src.title}</p>
                        {src.snippet && <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{src.snippet}</p>}
                        <p className="text-[10px] text-amber-400/70 mt-1 truncate">{src.url}</p>
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
