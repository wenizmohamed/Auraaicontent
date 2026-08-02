// AI Copywriting — brand-grounded website copy generation.
//
// Generates headlines / descriptions / articles / CTAs grounded in the
// selected client's knowledge base. Native multi-language: EN / AR / FR
// each generated idiomatically (Arabic is not a translation of English).

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PenLine, Loader2, Sparkles, Copy, Check, AlertCircle, BookOpen,
  Type, AlignLeft, FileText, MousePointerClick, ThumbsUp,
} from 'lucide-react';
import { copywritingApi, memoryApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { usePersistentDraft } from '../lib/use-persistent-draft';
import { FeatureCard } from '../components/ui';

type CopyType = 'headline' | 'description' | 'article' | 'cta';
type CopyLanguage = 'en' | 'ar' | 'fr';

const COPY_TYPES: { id: CopyType; label: string; hint: string; icon: typeof PenLine }[] = [
  { id: 'headline',    label: 'Headline',    hint: '~15 words, punchy',     icon: Type },
  { id: 'description', label: 'Description', hint: '~20 words, benefit-led', icon: AlignLeft },
  { id: 'article',     label: 'Article',     hint: '100-160 words',          icon: FileText },
  { id: 'cta',         label: 'CTA',         hint: '2-6 words, action',      icon: MousePointerClick },
];

const LANGUAGES: { id: CopyLanguage; label: string; rtl: boolean }[] = [
  { id: 'en', label: 'English',  rtl: false },
  { id: 'ar', label: 'العربية',  rtl: true  },
  { id: 'fr', label: 'Français', rtl: false },
];

const COUNTS = [3, 5, 8];

// Length presets (C2). Empty hint = use the copy-type default.
const LENGTHS: { id: string; label: string; hint: string }[] = [
  { id: 'short',   label: 'Shorter',  hint: 'noticeably shorter and tighter than usual' },
  { id: 'default', label: 'Default',  hint: '' },
  { id: 'long',    label: 'Longer',   hint: 'noticeably longer and more detailed than usual' },
];

export default function Copywriting() {
  const { selectedClientId, currentClient } = useClients();

  const [copyType, setCopyType] = useState<CopyType>('headline');
  const [language, setLanguage] = useState<CopyLanguage>('en');
  // Drafts persist across refresh, scoped per client.
  const [tone, setTone] = usePersistentDraft(`copywriting.tone.${selectedClientId ?? 'none'}`, '');
  const [brief, setBrief] = usePersistentDraft(`copywriting.brief.${selectedClientId ?? 'none'}`, '');
  const [count, setCount] = useState(3);
  const [lengthPreset, setLengthPreset] = useState('default');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ provider: string; latencyMs: number; groundingChunks: number } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [favoritedIdx, setFavoritedIdx] = useState<number | null>(null);

  const rtl = LANGUAGES.find(l => l.id === language)?.rtl ?? false;

  const handleGenerate = async () => {
    if (!brief.trim() || loading) return;
    // Regenerating? Feed the prior variants back so the new set is genuinely
    // different (C2 anti-repeat). Cleared right after capturing.
    const prev = variants;
    setLoading(true);
    setError('');
    setVariants([]);
    setMeta(null);
    setFavoritedIdx(null);
    const lengthHint = LENGTHS.find(l => l.id === lengthPreset)?.hint || '';
    try {
      const out = await copywritingApi.generate({
        brief: brief.trim(),
        copyType,
        language,
        tone: tone.trim() || undefined,
        clientId: selectedClientId || undefined,
        count,
        length: lengthHint || undefined,
        avoid: prev.length ? prev : undefined,
      });
      setVariants(out.variants || []);
      setMeta({ provider: out.provider, latencyMs: out.latencyMs, groundingChunks: out.groundingChunks });
      if (!out.variants?.length) setError('No copy was returned. Try rewording the brief.');
    } catch (err: any) {
      setError(err?.message || 'Copywriting generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1600);
    }).catch(() => {});
  };

  // Thumbs-up (C1): store the favored variant as a 'preference' learning so
  // future copy for this client self-applies the style (plugs into the memory
  // system the AI router already reads from).
  const handleFavorite = (text: string, idx: number) => {
    memoryApi.create({
      content: `Preferred ${copyType} copy style (${language}): "${text}"`,
      kind: 'preference',
      clientId: selectedClientId || null,
      context: `copywriting · ${copyType} · tone: ${tone.trim() || 'default'}`,
    }).then(() => {
      setFavoritedIdx(idx);
      setTimeout(() => setFavoritedIdx(c => (c === idx ? null : c)), 2500);
    }).catch(() => {});
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <PenLine className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight" style={{ color: 'var(--color-fg)' }}>AI Copywriting</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Brand-grounded website copy. Headlines, descriptions, articles.
              {currentClient && <span className="ml-1 text-amber-400/80">Client: {currentClient.name}</span>}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ─── Form ───────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Copy type */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--color-fg-subtle)' }}>Copy type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {COPY_TYPES.map((ct, i) => (
              <FeatureCard
                key={ct.id}
                icon={ct.icon}
                title={ct.label}
                description={ct.hint}
                active={copyType === ct.id}
                glow={copyType === ct.id}
                index={i}
                onClick={() => setCopyType(ct.id)}
              />
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Language</label>
          <div className="flex gap-2 mt-2">
            {LANGUAGES.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLanguage(l.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  language === l.id
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1.5">
            Arabic and French are written natively, not machine-translated from English.
          </p>
        </div>

        {/* Tone */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Tone of voice (optional)</label>
          <input
            type="text"
            value={tone}
            onChange={e => setTone(e.target.value)}
            placeholder="e.g. warm, family-focused, authoritative on nutrition"
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
          />
        </div>

        {/* Brief */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Brief. What is the copy about?</label>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="e.g. Homepage hero for the infant-nutrition range. Emphasise trusted heritage, regional expertise, and pediatric backing."
            rows={4}
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 resize-y"
          />
        </div>

        {/* Count + generate */}
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Variants</label>
            <div className="flex gap-2 mt-2">
              {COUNTS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`w-10 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    count === n
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.12]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Length</label>
            <div className="flex gap-2 mt-2">
              {LENGTHS.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLengthPreset(l.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    lengthPreset === l.id
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.12]'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !brief.trim()}
            className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {loading ? 'Writing...' : 'Generate copy'}
          </button>

          {!selectedClientId && (
            <p className="ml-auto text-[10px] text-zinc-700">
              Pick a client to ground copy in their brand knowledge base
            </p>
          )}
        </div>
      </div>

      {/* ─── Error ──────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ─── Results ────────────────────────────────────────────── */}
      <AnimatePresence>
        {variants.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                <Sparkles className="w-3 h-3" />
                {variants.length} variant{variants.length > 1 ? 's' : ''}
              </div>
              {meta && (
                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    {meta.groundingChunks > 0
                      ? `Grounded on ${meta.groundingChunks} brand doc${meta.groundingChunks > 1 ? 's' : ''}`
                      : 'No brand docs. Generic copy'}
                  </span>
                  <span>{meta.provider} · {(meta.latencyMs / 1000).toFixed(1)}s</span>
                </div>
              )}
            </div>

            {variants.map((v, i) => (
              <div
                key={i}
                className="group relative rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 hover:border-amber-500/25 transition-colors"
              >
                <p
                  className="text-sm text-zinc-100 leading-relaxed pr-20 whitespace-pre-wrap"
                  dir={rtl ? 'rtl' : 'ltr'}
                  style={rtl ? { textAlign: 'right' } : undefined}
                >
                  {v}
                </p>
                <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleFavorite(v, i)}
                    title="Favor this. Teaches the AI your preferred style for next time"
                    className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/10 text-zinc-500 hover:text-amber-400 hover:border-amber-500/30 transition-all flex items-center justify-center"
                  >
                    {favoritedIdx === i
                      ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                      : <ThumbsUp className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(v, i)}
                    title="Copy to clipboard"
                    className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/10 text-zinc-500 hover:text-amber-400 hover:border-amber-500/30 transition-all flex items-center justify-center"
                  >
                    {copiedIdx === i
                      ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                      : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
