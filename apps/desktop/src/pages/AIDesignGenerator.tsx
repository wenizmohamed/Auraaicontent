import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Palette, Loader2, Copy, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { designApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';

interface DesignBriefResult {
  visualDirection: string;
  colorPalette: { name: string; hex: string }[];
  typography: { heading: string; body: string; accent: string };
  layoutDescription: string;
  copy: { headline: string; subheadline: string; body: string; cta: string };
  imagePrompts: string[];
  dimensions: { platform: string; size: string }[];
  provider?: string;
  latencyMs?: number;
}

export default function AIDesignGenerator() {
  const { selectedClientId, currentClient } = useClients();
  const [step, setStep] = useState<1 | 2>(1);
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [objective, setObjective] = useState('');
  const [mood, setMood] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState<DesignBriefResult | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    setBrief(null);

    try {
      const out = await designApi.brief({
        topic: topic.trim(),
        audience: audience.trim() || undefined,
        objective: objective.trim() || undefined,
        mood: mood.trim() || undefined,
        clientId: selectedClientId || undefined,
      });
      setBrief(out);
      setStep(2);
    } catch (err: any) {
      setError(err?.message || 'Design generation failed');
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!brief) return;
    const text = JSON.stringify(brief, null, 2);
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Palette className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">AI Design Generator</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Generate a structured design brief — visual direction, palette, typography, copy, prompts.</p>
          </div>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-6 space-y-5">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Topic *</label>
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g. AlfaPay app launch — money transfer"
                className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Audience</label>
                <input
                  value={audience}
                  onChange={e => setAudience(e.target.value)}
                  placeholder="e.g. White-collar UAE expats"
                  className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Objective</label>
                <input
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  placeholder="e.g. Drive app downloads"
                  className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Mood</label>
              <input
                value={mood}
                onChange={e => setMood(e.target.value)}
                placeholder="e.g. Premium, trustworthy, modern"
                className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
              />
            </div>
            {currentClient && (
              <p className="text-[10px] text-zinc-600">Brand context will be auto-loaded for {currentClient.name}</p>
            )}
            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim()}
              className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loading ? 'Generating brief...' : 'Generate Brief'}
            </button>
          </motion.div>
        )}

        {step === 2 && brief && (
          <motion.div key="step2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="space-y-5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 text-zinc-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="flex items-center gap-2 text-amber-400 hover:text-amber-300"
              >
                <RefreshCw className="w-4 h-4" /> Regenerate
              </button>
              <button
                onClick={copyAll}
                className="ml-auto flex items-center gap-2 text-zinc-400 hover:text-white"
              >
                <Copy className="w-4 h-4" /> Copy JSON
              </button>
              {brief.provider && <span className="text-[10px] text-zinc-700">via {brief.provider}</span>}
            </div>

            {brief.visualDirection && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">Visual Direction</h3>
                <p className="text-sm text-zinc-300 leading-relaxed">{brief.visualDirection}</p>
              </div>
            )}

            {brief.colorPalette.length > 0 && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Color Palette</h3>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {brief.colorPalette.map((c, i) => (
                    <div key={i} className="text-center">
                      <div className="aspect-square rounded-xl border border-white/[0.06]" style={{ backgroundColor: c.hex }} />
                      <p className="text-[10px] text-zinc-300 font-medium mt-1.5">{c.name}</p>
                      <p className="text-[9px] text-zinc-600 font-mono">{c.hex}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Typography</h3>
              <div className="grid grid-cols-3 gap-3">
                {(['heading', 'body', 'accent'] as const).map(k => (
                  <div key={k}>
                    <p className="text-[9px] uppercase text-zinc-600 font-bold tracking-wider">{k}</p>
                    <p className="text-sm text-zinc-300 mt-1">{brief.typography[k]}</p>
                  </div>
                ))}
              </div>
            </div>

            {brief.layoutDescription && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">Layout</h3>
                <p className="text-sm text-zinc-300 leading-relaxed">{brief.layoutDescription}</p>
              </div>
            )}

            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-3">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Copy</h3>
              {brief.copy.headline && (
                <div>
                  <p className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Headline</p>
                  <p className="text-base text-amber-200/90 font-bold mt-0.5">{brief.copy.headline}</p>
                </div>
              )}
              {brief.copy.subheadline && (
                <div>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">Subheadline</p>
                  <p className="text-sm text-zinc-300 mt-0.5">{brief.copy.subheadline}</p>
                </div>
              )}
              {brief.copy.body && (
                <div>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">Body</p>
                  <p className="text-sm text-zinc-300 mt-0.5 whitespace-pre-wrap">{brief.copy.body}</p>
                </div>
              )}
              {brief.copy.cta && (
                <div>
                  <p className="text-[9px] text-emerald-400/60 uppercase tracking-wider font-semibold">CTA</p>
                  <p className="text-sm text-emerald-300/90 font-medium mt-0.5">{brief.copy.cta}</p>
                </div>
              )}
            </div>

            {brief.imagePrompts.length > 0 && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Image Prompts</h3>
                <ul className="space-y-2">
                  {brief.imagePrompts.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300">
                      <span className="text-amber-400 shrink-0">{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {brief.dimensions.length > 0 && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Dimensions</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {brief.dimensions.map((d, i) => (
                    <div key={i} className="rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                      <p className="text-xs text-white font-medium">{d.platform}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{d.size}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
