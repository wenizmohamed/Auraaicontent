import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Palette, Loader2, Copy, AlertCircle, ArrowLeft, RefreshCw, Wand2, Layers, Brush, Square } from 'lucide-react';
import { designApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { usePersistentDraft } from '../lib/use-persistent-draft';
import { FeatureCard } from '../components/ui';

interface DesignBriefResult {
  conceptIdea?: string;
  visualDirection: string;
  colorPalette: { name: string; hex: string }[];
  typography: { heading: string; body: string; accent: string };
  layoutDescription: string;
  copy: { headline: string; subheadline: string; body: string; cta: string };
  imagePrompts: string[];
  videoPrompts?: string[];
  dimensions: { platform: string; size: string }[];
  provider?: string;
  latencyMs?: number;
}

export default function AIDesignGenerator() {
  const { selectedClientId, currentClient } = useClients();
  const [step, setStep] = useState<1 | 2>(1);
  // Brief fields persist across refresh, scoped per client.
  const ck = selectedClientId ?? 'none';
  const [topic, setTopic] = usePersistentDraft(`design.topic.${ck}`, '');
  const [audience, setAudience] = usePersistentDraft(`design.audience.${ck}`, '');
  const [objective, setObjective] = usePersistentDraft(`design.objective.${ck}`, '');
  const [mood, setMood] = usePersistentDraft(`design.mood.${ck}`, '');
  // D2: your rough visual ideas to develop into a concept + prompts.
  const [visualThoughts, setVisualThoughts] = usePersistentDraft(`design.thoughts.${ck}`, '');
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
        visualThoughts: visualThoughts.trim() || undefined,
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

  // Style preset chips — seed the Mood field with a concrete starting point.
  const STYLE_PRESETS = [
    { name: 'Minimal', icon: Square, mood: 'Minimalist, generous whitespace, mono palette with one accent. Editorial typography.' },
    { name: 'Editorial', icon: Layers, mood: 'Premium magazine feel. Serif headlines, modular grid, photo-led, large drop caps.' },
    { name: 'Bold', icon: Brush, mood: 'High-contrast, oversized type, saturated brand accent, geometric shapes, no fluff.' },
    { name: 'Glass', icon: Sparkles, mood: 'Soft glassmorphism, blurred gradients, low-key surfaces, glowing accent highlights.' },
  ];

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      {/* Hero — name the surface + offer 4 style starting points */}
      <motion.section
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border"
        style={{
          background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(245,158,11,0.06) 50%, transparent 100%), var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 18px 50px -20px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full blur-3xl opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)' }}
        />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border"
              style={{ background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.30)' }}
            >
              <Wand2 className="w-6 h-6" style={{ color: '#a78bfa' }} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--color-fg-subtle)' }}>
                Create · AI Design
              </p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold leading-tight" style={{ color: 'var(--color-fg)' }}>
                Brief in. Full design brief out.
              </h1>
              <p className="mt-2 text-sm leading-relaxed max-w-2xl" style={{ color: 'var(--color-fg-muted)' }}>
                Visual direction, palette, typography, layout, copy, and image prompts. Generated in one pass. Pick a starting style to seed the mood.
              </p>
            </div>
          </div>

          {step === 1 && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STYLE_PRESETS.map((p, i) => {
                const active = mood === p.mood;
                return (
                  <FeatureCard
                    key={p.name}
                    icon={p.icon}
                    title={p.name}
                    description={p.mood.split('.')[0]}
                    active={active}
                    glow={active}
                    index={i}
                    onClick={() => setMood(p.mood)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </motion.section>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-6 space-y-5">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Topic *</label>
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g. AlfaPay app launch. Money transfer"
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
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Your visual ideas (optional)</label>
              <textarea
                value={visualThoughts}
                onChange={e => setVisualThoughts(e.target.value)}
                placeholder="Rough thoughts to develop into a concept, e.g. dirham coins forming an upward graph; product hero on marble; show the app saving someone time"
                rows={3}
                className="w-full mt-2 resize-y bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
              />
              <p className="text-[10px] text-zinc-600 mt-1">The AI builds ON these into one concept + ready image/video prompts.</p>
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

            {brief.conceptIdea && (
              <div className="rounded-2xl p-5 border" style={{ background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)' }}>
                <h3 className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: 'var(--color-accent)' }}>The Concept</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>{brief.conceptIdea}</p>
              </div>
            )}

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

            {brief.videoPrompts && brief.videoPrompts.length > 0 && (
              <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Video / Animation Prompts</h3>
                <ul className="space-y-2">
                  {brief.videoPrompts.map((p, i) => (
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
