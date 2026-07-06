// Competitor Intel — competitor intelligence MVP (T3#14). Enter a competitor
// (+ optional website); the AI router analyzes their content strategy and, when
// a client is selected, surfaces concrete gaps that client can exploit.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Radar, Search, Sparkles, Target, TrendingUp, Lightbulb, Loader2 } from 'lucide-react';
import { useClients } from '../lib/client-context';
import { useToast } from '../lib/toast-context';
import { competitorIntelApi, type CompetitorAnalysis } from '../lib/backend-api';
import { motionBase } from '../lib/motion';

export default function CompetitorIntel() {
  const { currentClient } = useClients();
  const { error: toastErr } = useToast();
  const [competitor, setCompetitor] = useState('');
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompetitorAnalysis | null>(null);

  const run = async () => {
    if (!competitor.trim()) return;
    setLoading(true); setResult(null);
    try {
      const r = await competitorIntelApi.analyze({ competitor: competitor.trim(), website: website.trim() || undefined, clientId: currentClient?.id });
      setResult(r);
    } catch (e) {
      toastErr(e instanceof Error ? e.message : 'Analysis failed');
    } finally { setLoading(false); }
  };

  const Chips = ({ items }: { items: string[] }) => (
    <div className="flex flex-wrap gap-2">
      {items.map((t, i) => <span key={i} className="text-sm px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-fg-muted">{t}</span>)}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={motionBase}>
        <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-fg-subtle flex items-center gap-2"><Radar className="w-3.5 h-3.5" /> Strategy</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-fg">Competitor Intel</h1>
        <p className="text-sm mt-1 text-fg-muted">
          Read a competitor's content strategy{currentClient ? <> and find gaps <b>{currentClient.name}</b> can exploit</> : ' (select a client to get gap analysis)'}.
        </p>
      </motion.div>

      <div className="rounded-2xl p-4 border border-border bg-surface space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input value={competitor} onChange={(e) => setCompetitor(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="Competitor (brand or handle)…" aria-label="Competitor"
              className="w-full ps-10 pe-3 py-2.5 text-sm rounded-lg border border-border bg-bg text-fg placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 outline-none" />
          </div>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="Website (optional, grounds the read)" aria-label="Website"
            className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-border bg-bg text-fg placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 outline-none" />
          <button onClick={run} disabled={loading || !competitor.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-accent hover:opacity-90 disabled:opacity-40 text-fg-on-accent">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={motionBase} className="space-y-4">
          <div className="rounded-2xl p-5 border border-border bg-surface">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-fg">{result.competitor}</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg border border-border-subtle text-fg-subtle">
                {result.grounded ? 'grounded on site' : 'model read'} · {result.provider}
              </span>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed">{result.analysis.summary}</p>
            {result.analysis.tone && <p className="text-xs text-fg-subtle mt-2">Tone: <span className="text-fg-muted">{result.analysis.tone}</span></p>}
            {result.analysis.cadenceSignals && <p className="text-xs text-fg-subtle mt-1">Cadence: <span className="text-fg-muted">{result.analysis.cadenceSignals}</span></p>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl p-5 border border-border bg-surface">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-fg-muted" /> Content themes</h3>
              {result.analysis.themes.length ? <Chips items={result.analysis.themes} /> : <p className="text-sm text-fg-subtle">—</p>}
            </div>
            <div className="rounded-2xl p-5 border border-border bg-surface">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-fg-muted" /> Their strengths</h3>
              {result.analysis.strengths.length ? (
                <ul className="space-y-1.5 text-sm text-fg-muted list-disc ps-4">{result.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
              ) : <p className="text-sm text-fg-subtle">—</p>}
            </div>
          </div>

          <div className="rounded-2xl p-5 border border-emerald-500/30 bg-emerald-500/5">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-emerald-400" /> Opportunities {currentClient ? `for ${currentClient.name}` : ''}</h3>
            {result.analysis.opportunities.length ? (
              <ul className="space-y-2 text-sm text-fg list-disc ps-4">{result.analysis.opportunities.map((o, i) => <li key={i}>{o}</li>)}</ul>
            ) : <p className="text-sm text-fg-subtle">Select a client to get gap analysis.</p>}
          </div>
        </motion.div>
      )}
    </div>
  );
}
