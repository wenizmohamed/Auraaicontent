// Creative Studio — single focused page for the 4 primary creative modes.
//
// Modes:
//   1. Text → Image     POST /api/creative/images/generate
//   2. Image Edit       POST /api/creative/images/edit
//   3. Text → Video     POST /api/creative/videos/generate                 (no imageBase64)
//   4. Image → Video    POST /api/creative/videos/generate + imageBase64
//
// All four share the same layout: header → upload (if needed) → prompt → controls → result → save.
// Secondary tools (Research / AI Design / Video Analysis / Assistant) live in a small footer strip.

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2, ImageIcon, Image as ImageLucide, Edit3, Video, Film, Loader2,
  Sparkles, X, Upload, Download, AlertCircle, CheckCircle2,
  FileSearch, Palette, Bot, ArrowRight, PenTool, ChevronDown, ChevronUp,
  Link2, Copy, Clock,
} from 'lucide-react';
import { creativeApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { readJson } from '../lib/safe-storage';

// ─── Prompt History ─────────────────────────────────────────────

const HISTORY_KEY = 'radix_prompt_history';
const MAX_HISTORY = 20;

interface PromptHistoryEntry {
  prompt: string;
  mode: Mode;
  timestamp: number;
}

function loadHistory(): PromptHistoryEntry[] {
  return readJson<PromptHistoryEntry[]>(HISTORY_KEY, []);
}

function saveHistory(entries: PromptHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {}
}

function pushHistory(entry: PromptHistoryEntry) {
  const prev = loadHistory().filter(h => h.prompt !== entry.prompt);
  saveHistory([entry, ...prev]);
}

// ─── Types ─────────────────────────────────────────────────────────

type Mode = 'text-to-image' | 'image-edit' | 'text-to-video' | 'image-to-video';

interface ModeDef {
  id: Mode;
  label: string;
  shortLabel: string;
  description: string;
  icon: any;
  needsImage: boolean;
  outputType: 'image' | 'video';
}

const MODES: ModeDef[] = [
  {
    id: 'text-to-image',
    label: 'Text → Image',
    shortLabel: 'Text to Image',
    description: 'Generate a new image from a text prompt.',
    icon: ImageLucide,
    needsImage: false,
    outputType: 'image',
  },
  {
    id: 'image-edit',
    label: 'Image Edit',
    shortLabel: 'Image Edit',
    description: 'Apply prompt-based edits to an existing image.',
    icon: Edit3,
    needsImage: true,
    outputType: 'image',
  },
  {
    id: 'text-to-video',
    label: 'Text → Video',
    shortLabel: 'Text to Video',
    description: 'Generate a short video from a text prompt.',
    icon: Video,
    needsImage: false,
    outputType: 'video',
  },
  {
    id: 'image-to-video',
    label: 'Image → Video',
    shortLabel: 'Image to Video',
    description: 'Animate a still image into a short video using a prompt.',
    icon: Film,
    needsImage: true,
    outputType: 'video',
  },
];

// Image modes accept all four aspect ratios.
// Video modes (Gemini Veo + xAI grok-imagine-video) ONLY accept 16:9 and 9:16.
const ASPECT_RATIOS_IMAGE = [
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
];
const ASPECT_RATIOS_VIDEO = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
];
function aspectRatiosFor(mode: Mode) {
  return mode === 'text-to-video' || mode === 'image-to-video'
    ? ASPECT_RATIOS_VIDEO
    : ASPECT_RATIOS_IMAGE;
}

const VIDEO_DURATIONS = [
  { label: '5s', value: 5 },
  { label: '8s', value: 8 },
  { label: '10s', value: 10 },
];

// ─── Helpers ───────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) resolve({ mimeType: m[1], base64: m[2] });
      else reject(new Error('Invalid file format'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ─── Page ──────────────────────────────────────────────────────────

export default function CreativeTools() {
  const { selectedClientId, currentClient } = useClients();

  // Tab state — read from query (?tab=image-edit) for deep linking
  const initialTab: Mode = (() => {
    if (typeof window === 'undefined') return 'text-to-image';
    const t = new URLSearchParams(window.location.search).get('tab') as Mode | null;
    if (t && MODES.find(m => m.id === t)) return t;
    return 'text-to-image';
  })();
  const [mode, setMode] = useState<Mode>(initialTab);
  const modeDef = MODES.find(m => m.id === mode)!;

  // Common form state
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [duration, setDuration] = useState(5);
  const [sourceBase64, setSourceBase64] = useState('');
  const [sourceMime, setSourceMime] = useState('image/png');
  const [sourcePreview, setSourcePreview] = useState('');

  // Result + lifecycle
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [improving, setImproving] = useState(false);
  const cancelledRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prompt history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>(loadHistory);

  // Attach-to-post modal
  const [attachModalOpen, setAttachModalOpen] = useState(false);
  const [attachPostId, setAttachPostId] = useState('');
  const [copiedAssetId, setCopiedAssetId] = useState(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // When the user switches mode, reset everything mode-specific but keep prompt
  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setErrorCode(null);
    setResultUrl('');
    setSavedAssetId(null);
    setProvider('');
    setProgress(0);
    // If the next mode doesn't need an image, clear the source so the upload box collapses
    const nextDef = MODES.find(m => m.id === next)!;
    if (!nextDef.needsImage) {
      setSourceBase64('');
      setSourceMime('image/png');
      setSourcePreview('');
    }
    // Clamp aspect ratio if the current value isn't valid for the new mode
    // (e.g. 1:1 / 4:3 are image-only — Gemini Veo + xAI Grok video reject them)
    const validAspects = aspectRatiosFor(next).map(a => a.value);
    if (!validAspects.includes(aspectRatio)) {
      setAspectRatio(validAspects[0]);   // first allowed = 16:9 for video, 1:1 for image
    }
    // Update URL for deep-link
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleFile = async (file: File) => {
    setError('');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      setSourceBase64(base64);
      setSourceMime(mimeType);
      setSourcePreview(`data:${mimeType};base64,${base64}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to read file');
    }
  };

  const clearSource = () => {
    setSourceBase64('');
    setSourceMime('image/png');
    setSourcePreview('');
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (modeDef.needsImage && !sourceBase64) {
      setError('Upload a source image first.');
      return;
    }

    cancelledRef.current = false;
    setLoading(true);
    setError('');
    setErrorCode(null);
    setResultUrl('');
    setSavedAssetId(null);
    setProvider('');
    setProgress(0);

    try {
      if (mode === 'text-to-image') {
        const out = await creativeApi.generateImage({
          prompt: prompt.trim(),
          aspectRatio,
          clientId: selectedClientId || undefined,
        });
        setResultUrl(out.assetUrl || out.url || '');
        setSavedAssetId(out.assetId || null);
        setProvider(out.provider || '');
      } else if (mode === 'image-edit') {
        const out = await creativeApi.editImage({
          prompt: prompt.trim(),
          imageBase64: sourceBase64,
          mimeType: sourceMime,
          aspectRatio,
          clientId: selectedClientId || undefined,
        });
        setResultUrl(out.assetUrl || out.url || '');
        setSavedAssetId(out.assetId || null);
        setProvider(out.provider || '');
      } else {
        // text-to-video OR image-to-video — both go through the same async route
        const { jobId } = await creativeApi.generateVideo({
          prompt: prompt.trim(),
          aspectRatio,
          durationSeconds: duration,
          clientId: selectedClientId || undefined,
          // Only attach the image when in image-to-video mode
          ...(mode === 'image-to-video' ? { imageBase64: sourceBase64, mimeType: sourceMime } : {}),
        });

        let attempts = 0;
        while (attempts < 120 && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 5000));
          if (cancelledRef.current) break;

          let job;
          try {
            job = await creativeApi.getJob(jobId);
          } catch (pollErr: any) {
            // The in-memory job queue is wiped on every server restart/deploy.
            // If the job vanishes mid-flight, give the user a clear actionable message
            // instead of "Job not found" or "Internal Server Error".
            const m = pollErr?.message || '';
            if (/job not found|404/i.test(m)) {
              throw new Error('Your video job was lost (likely a server restart). Click Generate again — the result is not auto-recovered.');
            }
            throw pollErr;
          }

          setProgress(job.progress || 0);
          if (job.status === 'completed') {
            setResultUrl(job.result?.url || '');
            setProvider(job.result?.provider || '');
            break;
          }
          if (job.status === 'failed') throw new Error(job.error || 'Video generation failed');
          attempts++;
        }
        if (attempts >= 120) throw new Error('Video generation timed out after 10 minutes');
      }

      // Save prompt to history on success
      const entry: PromptHistoryEntry = { prompt: prompt.trim(), mode, timestamp: Date.now() };
      pushHistory(entry);
      setPromptHistory(loadHistory());
    } catch (err: any) {
      if (!cancelledRef.current) {
        setError(err?.message || 'Generation failed');
        setErrorCode(err?.statusCode || null);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    setLoading(false);
    setError('Cancelled');
  };

  const handleImprovePrompt = async () => {
    if (!prompt.trim() || improving) return;
    setImproving(true);
    setError('');
    try {
      const out = await creativeApi.improvePrompt(prompt.trim(), mode);
      if (out?.improved) setPrompt(out.improved);
    } catch (err: any) {
      setError(`Prompt improver failed: ${err?.message || 'unknown'}`);
      setErrorCode(err?.statusCode || null);
    } finally {
      setImproving(false);
    }
  };

  const isVideoMode = modeDef.outputType === 'video';

  return (
    <div className="max-w-[1200px] mx-auto space-y-8">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Wand2 className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">{t('page.creative.title')}</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              The four primary creative modes.
              {currentClient && <span className="ml-1 text-amber-400/80">Current client: {currentClient.name}</span>}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ─── Mode Tabs ──────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {MODES.map(m => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              className={`group relative rounded-2xl p-5 text-left transition-all border ${
                active
                  ? 'bg-gradient-to-br from-amber-500/15 to-amber-500/5 border-amber-500/40 shadow-lg shadow-amber-500/10'
                  : 'bg-[#0c0c0c] border-white/[0.06] hover:border-white/[0.12] hover:bg-[#101010]'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  active ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-white/[0.04] border border-white/[0.06]'
                }`}>
                  <Icon className={`w-5 h-5 ${active ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                </div>
                {active && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Active
                  </span>
                )}
              </div>
              <h3 className={`text-sm font-bold mb-1 ${active ? 'text-white' : 'text-zinc-300'}`}>{m.label}</h3>
              <p className="text-[11px] text-zinc-500 leading-relaxed">{m.description}</p>
            </button>
          );
        })}
      </motion.div>

      {/* ─── Studio Canvas (shared layout) ─────────────────────── */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 space-y-6"
      >
        {/* Studio sub-header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <modeDef.icon className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{modeDef.label}</h2>
              <p className="text-[11px] text-zinc-600">{modeDef.description}</p>
            </div>
          </div>
        </div>

        {/* Source upload — only for modes that need an input image */}
        {modeDef.needsImage && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Source Image</label>
            {!sourcePreview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 w-full rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 flex flex-col items-center gap-2 hover:border-amber-500/30 transition-colors"
              >
                <Upload className="w-7 h-7 text-zinc-600" />
                <p className="text-sm text-zinc-500">Click to upload an image</p>
                <p className="text-[10px] text-zinc-700">PNG, JPG, WebP up to 25 MB</p>
              </button>
            ) : (
              <div className="mt-2 relative rounded-xl overflow-hidden border border-white/[0.06] bg-black">
                <img src={sourcePreview} alt="Source" className="w-full max-h-72 object-contain" />
                <button
                  onClick={clearSource}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                  title="Clear source"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        )}

        {/* Prompt */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
              {mode === 'image-edit' ? 'Edit Instructions' : 'Prompt'}
            </label>
            <button
              type="button"
              onClick={handleImprovePrompt}
              disabled={!prompt.trim() || improving || loading}
              title="Improve this prompt with AI (Gemini primary, Grok fallback)"
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-300 hover:bg-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {improving
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <PenTool className="w-3 h-3" />}
              {improving ? 'Improving...' : 'Improve with AI'}
            </button>
          </div>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={
                mode === 'text-to-image' ? 'A cinematic editorial shot of...' :
                mode === 'image-edit'    ? 'Apply a retro filter, add warm tones...' :
                mode === 'text-to-video' ? 'A 5-second product reveal video, slow camera push...' :
                                            'Animate this image with a slow zoom and parallax...'
              }
              rows={4}
              className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 resize-y"
            />
            <button
              type="button"
              onClick={handleImprovePrompt}
              disabled={!prompt.trim() || improving || loading}
              title="Magic pen — improve prompt"
              className="absolute bottom-2 right-2 w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
            >
              {improving
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PenTool className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Prompt history */}
        {promptHistory.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setHistoryOpen(o => !o)}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold hover:text-zinc-300 transition-colors"
            >
              <Clock className="w-3 h-3" />
              Recent prompts ({promptHistory.length})
              {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <AnimatePresence>
              {historyOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.01] max-h-48 overflow-y-auto divide-y divide-white/[0.04]">
                    {promptHistory.map((h, i) => (
                      <div key={`${h.timestamp}-${i}`} className="flex items-center gap-2 px-3 py-2 group hover:bg-white/[0.02] transition-colors">
                        <button
                          type="button"
                          onClick={() => { setPrompt(h.prompt); setHistoryOpen(false); }}
                          className="flex-1 text-left text-xs text-zinc-400 truncate hover:text-white transition-colors"
                          title={h.prompt}
                        >
                          {h.prompt}
                        </button>
                        <span className="text-[9px] text-zinc-700 shrink-0">{h.mode.replace(/-/g, ' ')}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = promptHistory.filter((_, j) => j !== i);
                            saveHistory(next);
                            setPromptHistory(next);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-600 hover:text-red-400 transition-all"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => { saveHistory([]); setPromptHistory([]); }}
                    className="mt-1.5 text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Compact controls row */}
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Aspect Ratio</label>
            <div className="flex items-center gap-2 mt-2">
              {aspectRatiosFor(mode).map(ar => (
                <button
                  key={ar.value}
                  onClick={() => setAspectRatio(ar.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    aspectRatio === ar.value
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {isVideoMode && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Duration</label>
              <div className="flex items-center gap-2 mt-2">
                {VIDEO_DURATIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      duration === d.value
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Generate row */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim() || (modeDef.needsImage && !sourceBase64)}
            className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {loading
              ? (isVideoMode ? `Generating... ${progress}%` : 'Generating...')
              : `Generate ${isVideoMode ? 'Video' : 'Image'}`}
          </button>
          {loading && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm font-medium hover:bg-red-500/20"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
          <p className="ml-auto text-[10px] text-zinc-700">
            {selectedClientId ? 'Result will be saved to client assets' : 'Pick a client to auto-save results'}
          </p>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (() => {
            const isRateLimit = errorCode === 429 || /rate.?limit/i.test(error);
            const isUnavailable = errorCode === 503 || /unavailable|gemini/i.test(error);
            const bg = isRateLimit ? 'bg-amber-500/10 border-amber-500/20' : isUnavailable ? 'bg-zinc-500/10 border-zinc-500/20' : 'bg-red-500/10 border-red-500/20';
            const text = isRateLimit ? 'text-amber-400' : isUnavailable ? 'text-zinc-400' : 'text-red-400';
            const label = isRateLimit ? 'Rate limited' : isUnavailable ? 'Provider unavailable' : 'Error';
            return (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`rounded-xl ${bg} px-4 py-3 flex items-start gap-3`}>
                <AlertCircle className={`w-4 h-4 ${text} shrink-0 mt-0.5`} />
                <div>
                  <p className={`text-xs font-bold uppercase tracking-wider ${text} mb-0.5`}>{label}</p>
                  <p className={`text-sm ${text}`}>{error}</p>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Result */}
        {resultUrl && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Result</h3>
              <div className="flex items-center gap-2">
                {savedAssetId && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-0.5">
                    <CheckCircle2 className="w-3 h-3" /> Saved to assets
                  </span>
                )}
                {provider && <span className="text-[10px] text-zinc-600">via {provider}</span>}
                <a
                  href={resultUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300"
                >
                  <Download className="w-3 h-3" /> Download
                </a>
                {savedAssetId && (
                  <button
                    type="button"
                    onClick={() => setAttachModalOpen(true)}
                    className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-md px-2 py-0.5"
                  >
                    <Link2 className="w-3 h-3" /> Attach to Post
                  </button>
                )}
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
              {modeDef.outputType === 'image' ? (
                <img src={resultUrl} alt="Generated" className="w-full h-auto" />
              ) : (
                <video src={resultUrl} controls className="w-full h-auto" />
              )}
            </div>
          </motion.div>
        )}

        {/* Attach-to-post modal */}
        <AnimatePresence>
          {attachModalOpen && savedAssetId && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => setAttachModalOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="bg-[#111] border border-white/[0.1] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Attach Asset to Post</h3>
                  <button onClick={() => setAttachModalOpen(false)} className="p-1 rounded-lg hover:bg-white/10 text-zinc-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Copyable asset ID badge */}
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold shrink-0">Asset ID</span>
                  <code className="text-xs text-emerald-400 truncate flex-1">{savedAssetId}</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(savedAssetId);
                      setCopiedAssetId(true);
                      setTimeout(() => setCopiedAssetId(false), 2000);
                    }}
                    className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                    title="Copy asset ID"
                  >
                    {copiedAssetId ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Post ID input + link button */}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Post ID</label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="text"
                      value={attachPostId}
                      onChange={e => setAttachPostId(e.target.value)}
                      placeholder="Paste calendar post ID..."
                      className="flex-1 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
                    />
                    <button
                      type="button"
                      disabled={!attachPostId.trim()}
                      onClick={async () => {
                        try {
                          await (await import('../lib/backend-api')).calendarApi.updatePost(
                            attachPostId.trim(),
                            { assetId: savedAssetId, assetUrl: resultUrl },
                          );
                          setAttachModalOpen(false);
                          setAttachPostId('');
                        } catch (err: any) {
                          alert(`Link failed: ${err?.message || 'unknown error'}`);
                        }
                      }}
                      className="flex items-center gap-1.5 bg-sky-500/20 border border-sky-500/30 text-sky-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Link2 className="w-3.5 h-3.5" /> Link
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ─── Secondary Tools (demoted) ──────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-zinc-600" />
          <h2 className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold">More Tools</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { name: 'Research',     href: '/research',  icon: FileSearch, desc: 'Topic research with sources' },
            { name: 'Design Brief', href: '/ai-design', icon: Palette,    desc: 'Structured design brief generator' },
            { name: 'Video Analysis', href: '/video',   icon: Film,       desc: 'Analyze a video URL or upload' },
            { name: 'Assistant',    href: '/',          icon: Bot,        desc: 'Always-on floating chat (bottom-right)' },
          ].map(t => {
            const Icon = t.icon;
            return (
              <Link
                key={t.name}
                to={t.href}
                className="group rounded-xl bg-[#0a0a0a] border border-white/[0.04] px-4 py-3 hover:border-white/[0.1] hover:bg-[#0d0d0d] transition-all"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400" />
                  <p className="text-xs font-semibold text-zinc-400 group-hover:text-white">{t.name}</p>
                  <ArrowRight className="w-3 h-3 text-zinc-700 group-hover:text-zinc-500 ml-auto" />
                </div>
                <p className="text-[10px] text-zinc-700">{t.desc}</p>
              </Link>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
