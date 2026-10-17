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
  Link2, Copy, Clock, ThumbsUp, ThumbsDown, Maximize2,
} from 'lucide-react';
import { creativeApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { readJson } from '../lib/safe-storage';
import { motionUI, motionBase } from '../lib/motion';
import { FeatureCard } from '../components/ui';
import { ModelPicker } from '../components/creative/ModelPicker';
import { MODELS_BY_SECTION, modelOption, validModelValue, imageRequestFor, durationsFor, perSecondRate, type CreativeSection } from '../lib/creative-models';
import { usePricingVisibility } from '../lib/use-pricing-visibility';

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

// ─── Recent Assets (inline thumbnail strip — workshop ask 2026-05-06) ─────────
// Keeps the last N generated assets so users see them without tab-switching to History.

const RECENT_ASSETS_KEY = 'radix_recent_assets';
const MAX_RECENT_ASSETS = 8;

interface RecentAsset {
  url: string;
  mode: Mode;
  prompt: string;
  outputType: 'image' | 'video';
  timestamp: number;
}

function loadRecentAssets(): RecentAsset[] {
  return readJson<RecentAsset[]>(RECENT_ASSETS_KEY, []);
}

function pushRecentAsset(asset: RecentAsset) {
  try {
    const prev = loadRecentAssets().filter(a => a.url !== asset.url);
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify([asset, ...prev].slice(0, MAX_RECENT_ASSETS)));
  } catch {}
}

// ─── Types ─────────────────────────────────────────────────────────

type Mode = 'text-to-image' | 'image-edit' | 'text-to-video' | 'image-to-video' | 'upscale';

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
  {
    id: 'upscale',
    label: 'Upscale',
    shortLabel: 'Upscale',
    description: 'Enlarge an image up to 16K. Fast, or AI-enhanced with real detail.',
    icon: Maximize2,
    needsImage: true,
    outputType: 'image',
  },
];

// Image aspects (verified live 2026-07-02): the Gemini image model takes the
// full set — 4:5 is THE Instagram-feed ratio, 21:9 covers hero banners.
// Providers with narrower enums (Imagen, Grok) clamp server-side to the
// nearest legal ratio, so every choice here works on every engine.
// Video modes (Gemini Veo + xAI grok-imagine-video) ONLY accept 16:9 and 9:16.
const ASPECT_RATIOS_IMAGE = [
  { label: '1:1', value: '1:1', hint: 'Square' },
  { label: '4:5', value: '4:5', hint: 'IG Feed' },
  { label: '9:16', value: '9:16', hint: 'Story / Reel' },
  { label: '16:9', value: '16:9', hint: 'Landscape' },
  { label: '4:3', value: '4:3', hint: 'Classic' },
  { label: '3:4', value: '3:4', hint: 'Portrait' },
  { label: '21:9', value: '21:9', hint: 'Banner' },
];
const ASPECT_RATIOS_VIDEO = [
  { label: '16:9', value: '16:9', hint: 'Landscape' },
  { label: '9:16', value: '9:16', hint: 'Story / Reel' },
];

// Output resolution for image modes (nano-banana 1K/2K/4K; Imagen clamps 4K→2K;
// Grok/DashScope ignore it). 1K default keeps latency/cost unchanged.
const IMAGE_SIZES = [
  { label: '1K', value: '1K' as const, hint: 'Fast' },
  { label: '2K', value: '2K' as const, hint: 'High detail' },
  { label: '4K', value: '4K' as const, hint: 'Max quality' },
];
function aspectRatiosFor(mode: Mode) {
  return mode === 'text-to-video' || mode === 'image-to-video'
    ? ASPECT_RATIOS_VIDEO
    : ASPECT_RATIOS_IMAGE;
}

// Model pickers: one catalog per section (lib/creative-models.ts). 'auto' =
// AURA routes the call (Alibaba first for stills and clips since 2026-10-17,
// Gemini and Grok on standby); an explicit pick pins one engine and the server
// chain still covers a failure. Clip lengths and 1080p follow the picked
// engine's real limits (Veo 4/6/8s, Wan 3.0 up to 30s, HappyHorse 3 to 15s).
function imageSectionFor(mode: Mode): CreativeSection {
  return mode === 'image-edit' ? 'image-edit' : mode === 'upscale' ? 'upscale' : 'text-to-image';
}
function videoSectionFor(mode: Mode, hasRefs: boolean): CreativeSection {
  return hasRefs ? 'reference-video' : mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
}

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
  // Rates and cost estimates are owner/admin/accounting only.
  const canSeePricing = usePricingVisibility();

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
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [duration, setDuration] = useState(6);
  // Video tier is derived from the picked model (lib/creative-models.ts) and
  // sent for cost accounting — no separate Draft/HD control.
  // Image output resolution (nano native; 2K default — same per-image price
  // as 1K on the meter, visibly better detail for ad creative).
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('2K');
  // Prompt boost dial (2026-07-14, Dri's feedback "enhancer completely changed
  // my prompt"): replaces the binary auto-enhance toggle. 'raw' = translate
  // only, never reinterprets wording; 'medium' = full model-aware rewrite
  // (old ON); 'high' = max art direction; 'off' = send exact words untouched.
  const [promptBoost, setPromptBoost] = useState<'off' | 'raw' | 'medium' | 'high'>('medium');
  const [lastEnhanced, setLastEnhanced] = useState('');
  // Thumbs on the result → POST /creative/feedback → the AI learns this
  // client's taste (memory loop). genId comes back from every generation.
  const [genId, setGenId] = useState<string | null>(null);
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  // Upscaler (up to 16K). Runs on the current result URL.
  const [upscaling, setUpscaling] = useState<number | null>(null); // active target long-edge
  const [upscaled, setUpscaled] = useState<{ url: string; width: number; height: number; bytes: number; aiEnhanced?: boolean } | null>(null);
  // AI-detail mode: regenerate with real added detail via our models (Gemini
  // nano-banana / DashScope) before scaling. Off = fast Lanczos interpolation.
  const [upscaleAi, setUpscaleAi] = useState(false);
  // Target for the dedicated Upscale mode (long-edge px; 16384 = 16K).
  const [upscaleTarget, setUpscaleTarget] = useState(16384);
  // Style Packs — curated premium looks (motionsites.ai pattern): named
  // precision design contracts (hexes, materials, light) injected server-side.
  const [stylePacks, setStylePacks] = useState<{ id: string; name: string; tagline: string; category: string; palette: string[] }[]>([]);
  const [stylePackId, setStylePackId] = useState('');
  useEffect(() => { creativeApi.stylePacks().then(r => setStylePacks(r.packs || [])).catch(() => { /* picker stays hidden */ }); }, []);
  // Video resolution: 1080p is Veo-only and requires an 8s clip; selecting it
  // auto-bumps duration to 8 (server also degrades gracefully to 720p).
  const [videoRes, setVideoRes] = useState<'720p' | '1080p'>('720p');
  // Optional "avoid" terms — merged into Veo's negativePrompt server-side.
  const [negPrompt, setNegPrompt] = useState('');
  // Video model pick (per-section catalog). 'auto' = AURA routes: Wan 3.0 first.
  const [videoModel, setVideoModel] = useState('auto');
  // Image model pick. 'auto' = AURA routes: Qwen Image 3.0 Pro first.
  const [imageModel, setImageModel] = useState<string>('auto');
  // B3: keep the platform-UI safe zones (top/bottom bands) clear of key elements.
  const [safeZone, setSafeZone] = useState(false);
  const [sourceBase64, setSourceBase64] = useState('');
  const [sourceMime, setSourceMime] = useState('image/png');
  const [sourcePreview, setSourcePreview] = useState('');
  // Multi-image edit (Gemini/DashScope can take several input frames): the
  // primary frame is sourceBase64; these are the extra reference frames.
  type RefRole = 'content' | 'style' | 'character';
  const [extraRefs, setExtraRefs] = useState<{ base64: string; mimeType: string; preview: string; role: RefRole }[]>([]);
  // End-frame state for image-to-video (workshop 2026-05-06 #3 — Haneen).
  // Optional: omit to let Veo free-interpolate; provide to lock the final
  // frame so the video has controlled bookends.
  const [endBase64, setEndBase64] = useState('');
  const [endMime, setEndMime] = useState('image/png');
  const [endPreview, setEndPreview] = useState('');
  const endFileRef = useRef<HTMLInputElement>(null);
  const videoRefInputRef = useRef<HTMLInputElement>(null);
  // Section catalogs for the model pickers (lib/creative-models.ts).
  const videoSection = videoSectionFor(mode, extraRefs.length > 0);
  const imageSection = imageSectionFor(mode);
  const videoPick = modelOption(videoSection, validModelValue(videoSection, videoModel));
  const isVeoPick = /^veo/.test(videoPick.value);

  // Result + lifecycle
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  // B2: generate several at once (text-to-image). First result is the primary
  // (drives download/attach/calendar); the rest show as "more variations".
  const [imageCount, setImageCount] = useState(1);
  const [extraResults, setExtraResults] = useState<{ url: string; assetId: string | null }[]>([]);
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

  // Improve-with-AI preview (non-destructive — workshop fix 2026-05-06)
  // Drishti + Haneen reported "improve prompt sometimes goes out of context" and
  // "I can't edit my prompt after improve". Root cause: improvePrompt replaced the
  // user's text instantly, so the AI version dominated the textarea. Now the
  // improved version sits in a banner above the textarea — accept/discard.
  const [improvedPreview, setImprovedPreview] = useState<string | null>(null);
  // Multi-direction improve: 3 distinct creative angles the user picks from.
  const [improvedVariants, setImprovedVariants] = useState<{ label: string; prompt: string; negativePrompt?: string }[]>([]);
  const [originalBeforeImprove, setOriginalBeforeImprove] = useState<string | null>(null);
  const [originalNegBeforeImprove, setOriginalNegBeforeImprove] = useState<string | null>(null);
  // Last Avoid-field value WE auto-filled (vs user-typed) — lets a repeat pick
  // replace its own earlier auto-fill without ever clobbering user input.
  const autoNegRef = useRef<string | null>(null);

  // Recent assets (inline thumbnail strip — workshop fix 2026-05-06)
  const [recentAssets, setRecentAssets] = useState<RecentAsset[]>(loadRecentAssets);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // When the user switches mode, reset everything mode-specific but keep prompt
  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setErrorCode(null);
    setResultUrl('');
    setSavedAssetId(null);
    setExtraResults([]); setLastEnhanced('');
    setGenId(null); setVoted(null); setUpscaled(null); setUpscaling(null);
    setProvider('');
    setProgress(0);
    // A pending improve preview/picker was written for the previous mode's
    // prompt grammar (video prompts end in SFX/Ambient lines) — never carry it
    // across modes where "Use this" would paste the wrong dialect.
    setImprovedPreview(null);
    setImprovedVariants([]);
    // If the next mode doesn't need an image, clear the source so the upload box collapses
    const nextDef = MODES.find(m => m.id === next)!;
    if (!nextDef.needsImage) {
      setSourceBase64('');
      setSourceMime('image/png');
      setSourcePreview('');
    }
    // Reference frames apply to image-edit (multi-image blend) AND video
    // modes (Veo asset refs) — only clear when entering plain text-to-image.
    if (next === 'text-to-image') setExtraRefs([]);
    // A model pick the next section does not offer falls back to Auto (the
    // validity effect below handles it, incl. direct ?tab= loads).
    // End-frame is only meaningful in image-to-video; clear on every other mode
    if (next !== 'image-to-video') {
      setEndBase64('');
      setEndMime('image/png');
      setEndPreview('');
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

  // Accept one OR many files: first fills the primary source (if empty), the
  // rest become extra reference frames (multi-image edit). Capped at 8 total.
  const handleFiles = async (files: FileList | File[]) => {
    setError('');
    const list = Array.from(files);
    if (!list.length) return;
    try {
      const encoded = await Promise.all(list.map(fileToBase64));
      let rest = encoded;
      if (!sourceBase64) {
        const first = encoded[0];
        setSourceBase64(first.base64);
        setSourceMime(first.mimeType);
        setSourcePreview(`data:${first.mimeType};base64,${first.base64}`);
        rest = encoded.slice(1);
      }
      if (rest.length) {
        setExtraRefs(prev => [
          ...prev,
          ...rest.map(e => ({ base64: e.base64, mimeType: e.mimeType, preview: `data:${e.mimeType};base64,${e.base64}`, role: 'style' as RefRole })),
        ].slice(0, 7)); // 1 primary + up to 7 refs = 8 total
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to read files');
    }
  };

  const removeExtraRef = (i: number) => setExtraRefs(prev => prev.filter((_, idx) => idx !== i));
  const cycleRefRole = (i: number) => setExtraRefs(prev => prev.map((r, idx) => {
    if (idx !== i) return r;
    const order: RefRole[] = ['style', 'character', 'content'];
    return { ...r, role: order[(order.indexOf(r.role) + 1) % order.length] };
  }));
  const ROLE_LABEL: Record<RefRole, string> = { style: 'Style', character: 'Product', content: 'Layout' };

  const clearSource = () => {
    setSourceBase64('');
    setSourceMime('image/png');
    setSourcePreview('');
    setExtraRefs([]);
  };

  const handleEndFile = async (file: File) => {
    setError('');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      setEndBase64(base64);
      setEndMime(mimeType);
      setEndPreview(`data:${mimeType};base64,${base64}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to read end frame');
    }
  };

  const clearEnd = () => {
    setEndBase64('');
    setEndMime('image/png');
    setEndPreview('');
  };

  const handleGenerate = async () => {
    // Dedicated Upscale mode — no prompt; scales the uploaded source up to 16K.
    if (mode === 'upscale') {
      if (!sourceBase64) { setError('Upload an image to upscale first.'); return; }
      cancelledRef.current = false;
      setLoading(true); setError(''); setErrorCode(null);
      setResultUrl(''); setSavedAssetId(null); setExtraResults([]); setLastEnhanced('');
      setGenId(null); setVoted(null); setUpscaled(null); setProvider(''); setProgress(0);
      const ticker = setInterval(() => { if (!cancelledRef.current) setProgress(p => Math.min(90, +(p + 3).toFixed(1))); }, upscaleAi ? 1200 : 400);
      try {
        const r = await creativeApi.upscale({
          imageBase64: sourceBase64, mimeType: sourceMime,
          targetLongEdge: upscaleTarget,
          mode: upscaleAi ? 'ai' : 'fast',
          ...(upscaleAi ? imageRequestFor('upscale', imageModel) : {}),
          clientId: selectedClientId || undefined,
        });
        clearInterval(ticker); setProgress(100);
        setResultUrl(r.assetUrl || r.fileUrl);
        setSavedAssetId(r.assetId || null);
        setProvider(r.provider || 'sharp');
        setUpscaled({ url: r.assetUrl || r.fileUrl, width: r.width, height: r.height, bytes: r.bytes, aiEnhanced: (r as any).aiEnhanced });
      } catch (e: any) {
        clearInterval(ticker);
        setError(e?.message || 'Upscale failed');
      } finally { setLoading(false); }
      return;
    }
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
    setExtraResults([]); setLastEnhanced('');
    setGenId(null); setVoted(null); setUpscaled(null); setUpscaling(null);
    setProvider('');
    setProgress(0);

    let generatedUrl = '';

    // Fake-progress estimator for image modes (workshop fix 2026-05-06).
    // Videos already have real progress via job polling. Images don't, so the
    // user used to see only a spinner with no sense of how long is left.
    // Tick linearly toward 90% over the expected duration, hold there until
    // the await resolves, then jump to 100% in the success branch.
    let fakeTicker: ReturnType<typeof setInterval> | null = null;
    if (mode === 'text-to-image' || mode === 'image-edit') {
      const expectedSeconds = mode === 'image-edit' ? 45 : 28; // edit is slower
      const tickMs = 500;
      const totalTicks = Math.round((expectedSeconds * 1000) / tickMs);
      const stepPct = 90 / totalTicks; // cap at 90% until real success
      fakeTicker = setInterval(() => {
        if (cancelledRef.current) return;
        setProgress(p => Math.min(90, +(p + stepPct).toFixed(1)));
      }, tickMs);
    }

    try {
      if (mode === 'text-to-image') {
        const req = {
          prompt: prompt.trim(),
          aspectRatio,
          clientId: selectedClientId || undefined,
          safeZone,
          enhance: promptBoost !== 'off',
          ...(promptBoost !== 'off' ? { depth: promptBoost } : {}),
          ...(stylePackId ? { stylePackId } : {}),
          ...(imageSize !== '1K' ? { imageSize } : {}),
          ...imageRequestFor(imageSection, imageModel),
        };
        const n = Math.max(1, imageCount);
        // B2: fire N in parallel to compare. First = primary; rest = variations.
        const settled = await Promise.allSettled(Array.from({ length: n }, () => creativeApi.generateImage(req)));
        const ok = settled.filter(s => s.status === 'fulfilled').map(s => (s as PromiseFulfilledResult<any>).value);
        if (!ok.length) throw ((settled[0] as PromiseRejectedResult)?.reason) || new Error('Generation failed');
        const first = ok[0];
        generatedUrl = first.assetUrl || first.url || '';
        setResultUrl(generatedUrl);
        setSavedAssetId(first.assetId || null);
        setProvider(first.provider || '');
        setLastEnhanced(first.enhancedPrompt || '');
        setGenId(first.generationId || null);
        setExtraResults(ok.slice(1).map((o: any) => ({ url: o.assetUrl || o.url || '', assetId: o.assetId || null })));
      } else if (mode === 'image-edit') {
        const out = await creativeApi.editImage({
          prompt: prompt.trim(),
          imageBase64: sourceBase64,
          mimeType: sourceMime,
          aspectRatio,
          clientId: selectedClientId || undefined,
          safeZone,
          enhance: promptBoost !== 'off',
          ...(promptBoost !== 'off' ? { depth: promptBoost } : {}),
          ...(imageSize !== '1K' ? { imageSize } : {}),
          ...(extraRefs.length ? { referenceImages: extraRefs.map(r => ({ base64: r.base64, mimeType: r.mimeType, role: r.role })) } : {}),
          ...imageRequestFor(imageSection, imageModel),
        });
        generatedUrl = out.assetUrl || out.url || '';
        setResultUrl(generatedUrl);
        setSavedAssetId(out.assetId || null);
        setProvider(out.provider || '');
        setLastEnhanced(out.enhancedPrompt || '');
        setGenId(out.generationId || null);
      } else {
        // text-to-video OR image-to-video — both go through the same async route
        // The picked engine for this section (references switch to the
        // reference-video catalog so the subject stays consistent).
        const eng = videoPick;
        const { jobId } = await creativeApi.generateVideo({
          prompt: prompt.trim(),
          aspectRatio,
          durationSeconds: duration,
          tier: eng.tier,
          clientId: selectedClientId || undefined,
          safeZone,
          enhance: promptBoost !== 'off',
          ...(promptBoost !== 'off' ? { depth: promptBoost } : {}),
          ...(stylePackId ? { stylePackId } : {}),
          ...(eng.supports1080 && videoRes === '1080p' ? { resolution: '1080p' as const } : {}),
          ...(negPrompt.trim() ? { negativePrompt: negPrompt.trim() } : {}),
          // Veo asset refs: the exact product/subject stays consistent in the
          // clip (forces 8s server-side per Google's constraint).
          ...(extraRefs.length ? { referenceImages: extraRefs.slice(0, 3).map(r => ({ base64: r.base64, mimeType: r.mimeType })) } : {}),
          // Explicit pick → send its model id; the server maps it to the provider
          // (wan/happyhorse→dashscope, veo/omni→gemini, grok→xai). Auto sends no
          // model: the server primary (Wan 3.0) runs first, the chain follows.
          ...(eng.model ? { model: eng.model } : {}),
          // Only attach the image when in image-to-video mode
          ...(mode === 'image-to-video' ? {
            imageBase64: sourceBase64,
            mimeType: sourceMime,
            startImageBase64: sourceBase64,
            startMimeType: sourceMime,
          } : {}),
          // End frame (workshop 2026-05-06 #3 — Haneen): only sent when user
          // uploaded one. Veo treats it as the locked final frame and
          // interpolates between start and end instead of free-extrapolating.
          ...(mode === 'image-to-video' && endBase64 ? {
            endImageBase64: endBase64,
            endMimeType: endMime,
          } : {}),
        });

        let attempts = 0;
        let pollFails = 0;
        while (attempts < 120 && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 5000));
          if (cancelledRef.current) break;

          let job;
          try {
            job = await creativeApi.getJob(jobId);
            pollFails = 0;
          } catch (pollErr: any) {
            const m = pollErr?.message || '';
            // 404 = the job is truly gone AND has no recorded result (the
            // server now falls back to generation history before 404ing).
            if (/job not found|404/i.test(m)) {
              throw new Error('Your video job was lost (likely a server restart mid-generation). Click Generate again.');
            }
            // Transient blip (deploy restart, nginx 502, network hiccup) —
            // keep polling; the server-side recovery returns the finished
            // result once it's back. Only give up after ~30s of solid failure.
            if (++pollFails >= 6) throw pollErr;
            attempts++;
            continue;
          }

          setProgress(job.progress || 0);
          if (job.status === 'completed') {
            generatedUrl = job.result?.url || '';
            setResultUrl(generatedUrl);
            setProvider(job.result?.provider || '');
            setLastEnhanced(job.result?.enhancedPrompt || '');
            setGenId(job.result?.generationId || null);
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

      // Push to recent assets so it shows inline (no tab-switch to History needed).
      // generatedUrl was captured in the branch that ran above.
      if (generatedUrl) {
        pushRecentAsset({
          url: generatedUrl,
          mode,
          prompt: prompt.trim(),
          outputType: modeDef.outputType,
          timestamp: Date.now(),
        });
        setRecentAssets(loadRecentAssets());
        // Snap progress to 100% on success — visual confirmation before the
        // result panel renders.
        setProgress(100);
      }
    } catch (err: any) {
      if (!cancelledRef.current) {
        setError(err?.message || 'Generation failed');
        setErrorCode(err?.statusCode || null);
      }
    } finally {
      if (fakeTicker) clearInterval(fakeTicker);
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
    setImprovedPreview(null);
    setImprovedVariants([]);
    try {
      const out = await creativeApi.improvePrompt(prompt.trim(), mode, {
        clientId: selectedClientId || undefined,
        safeZone,
        hasRefs: extraRefs.length > 0 || !!sourceBase64,
        ...(stylePackId ? { stylePackId } : {}),
      });
      // Non-destructive: surface AI options so the user can pick one, discard,
      // or keep their original. Prefer 3 distinct directions; fall back to the
      // single improved version if the model didn't return variants.
      const vs = Array.isArray(out?.variants) ? out.variants.filter(v => v?.prompt?.trim()) : [];
      // Seed avoid-terms on arrival (auto-fill—tracked): even if the user later
      // dismisses the picker, the model's avoid-terms aren't silently lost.
      seedNegPrompt(out?.negativePrompt);
      if (vs.length > 1) {
        setImprovedVariants(vs);
      } else if (out?.improved && out.improved.trim() && out.improved.trim() !== prompt.trim()) {
        setImprovedPreview(out.improved);
      }
    } catch (err: any) {
      setError(`Prompt improver failed: ${err?.message || 'unknown'}`);
      setErrorCode(err?.statusCode || null);
    } finally {
      setImproving(false);
    }
  };

  // Seed the Avoid field from an AI negative: overwrite only when the field is
  // empty or still holds OUR previous auto-fill — never the user's own text.
  const seedNegPrompt = (neg?: string | null) => {
    if (!neg || !(mode === 'text-to-video' || mode === 'image-to-video')) return;
    setNegPrompt(prev => {
      if (prev.trim() && prev !== autoNegRef.current) return prev;
      autoNegRef.current = neg;
      return neg;
    });
  };

  const acceptImprovedPrompt = () => {
    if (!improvedPreview) return;
    setOriginalBeforeImprove(prompt);
    setOriginalNegBeforeImprove(negPrompt);
    setPrompt(improvedPreview);
    setImprovedPreview(null);
  };

  const discardImprovedPrompt = () => {
    setImprovedPreview(null);
    setImprovedVariants([]);
  };

  // Apply a chosen creative direction (from the 3-variant picker).
  const applyVariant = (v: { prompt: string; negativePrompt?: string }) => {
    setOriginalBeforeImprove(prompt);
    setOriginalNegBeforeImprove(negPrompt);
    setPrompt(v.prompt);
    seedNegPrompt(v.negativePrompt);
    setImprovedVariants([]);
    setImprovedPreview(null);
  };

  const undoImprovedPrompt = () => {
    if (originalBeforeImprove === null) return;
    setPrompt(originalBeforeImprove);
    // Also restore the Avoid field that apply/accept overwrote — a half-reverted
    // prompt/negative pair would ship the wrong art direction on next generate.
    if (originalNegBeforeImprove !== null) {
      setNegPrompt(originalNegBeforeImprove);
      autoNegRef.current = null;
      setOriginalNegBeforeImprove(null);
    }
    setOriginalBeforeImprove(null);
  };

  const isVideoMode = modeDef.outputType === 'video';

  // Keep picks valid for the current section (covers a direct ?tab= load and
  // attaching/removing product references): anything the section does not
  // offer falls back to Auto.
  useEffect(() => {
    if (isVideoMode) {
      if (videoModel !== validModelValue(videoSection, videoModel)) setVideoModel('auto');
    } else if (imageModel !== validModelValue(imageSection, imageModel)) {
      setImageModel('auto');
    }
  }, [isVideoMode, videoSection, imageSection, videoModel, imageModel]);
  // Drop 1080p and clip lengths the picked engine cannot serve.
  useEffect(() => {
    if (!isVideoMode) return;
    if (!videoPick.supports1080 && videoRes === '1080p') setVideoRes('720p');
    const allowed = durationsFor(videoPick);
    if (allowed.length && !allowed.includes(duration)) setDuration(allowed.includes(6) ? 6 : allowed[0]);
  }, [isVideoMode, videoPick, videoRes, duration]);

  return (
    <div className="max-w-[1200px] mx-auto space-y-8">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Wand2 className="w-6 h-6 text-black" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Create</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>{t('page.creative.title')}</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Generate, edit, animate & upscale.
              {currentClient && <span className="ml-1" style={{ color: 'var(--color-accent)' }}>Current client: {currentClient.name}</span>}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ─── Mode Tabs ──────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionUI, delay: 0.05 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {MODES.map((m, i) => {
          const active = mode === m.id;
          return (
            <FeatureCard
              key={m.id}
              icon={m.icon}
              title={m.label}
              description={m.description}
              active={active}
              glow={active}
              index={i}
              onClick={() => switchMode(m.id)}
            >
              {active && (
                <span className="mt-3 inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                  style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}>
                  Active
                </span>
              )}
            </FeatureCard>
          );
        })}
      </motion.div>

      {/* ─── Studio Canvas (shared layout) ─────────────────────── */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionBase}
        className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 space-y-6"
      >
        {/* Studio sub-header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl border flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)' }}>
              <modeDef.icon className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{modeDef.label}</h2>
              <p className="text-[11px] text-zinc-600">{modeDef.description}</p>
            </div>
          </div>
        </div>

        {/* Source upload — only for modes that need an input image.
            For image-to-video, this is the START frame; end frame is a
            separate dropper rendered below (workshop 2026-05-06 #3). */}
        {modeDef.needsImage && (
          <div className={mode === 'image-to-video' ? 'grid grid-cols-2 gap-4' : ''}>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                {mode === 'image-to-video' ? 'Start Frame' : 'Source Image'}
              </label>
              {!sourcePreview ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-2 w-full rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 flex flex-col items-center gap-2 hover:border-[color:var(--color-accent)] transition-colors"
                >
                  <Upload className="w-7 h-7 text-zinc-600" />
                  <p className="text-sm text-zinc-500">Click to upload an image</p>
                  <p className="text-[10px] text-zinc-700">PNG, JPG, WebP up to 25 MB</p>
                </button>
              ) : (
                <div className="mt-2">
                  <div className="relative rounded-xl overflow-hidden border border-white/[0.06] bg-black">
                    <img src={sourcePreview} alt="Source" className="w-full max-h-72 object-contain" />
                    {/* Prominent, always-visible remove pill (not a subtle corner
                        icon) so the source can always be cleared/changed — even
                        after a result renders. */}
                    <button
                      onClick={clearSource}
                      className="absolute top-2 right-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/70 text-white text-xs font-semibold hover:bg-red-600/90 border border-white/20 transition-colors"
                      title="Remove this image"
                    >
                      <X className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                  {/* A second, unmistakable full-width control below the image —
                      belt-and-suspenders for discoverability. */}
                  <button
                    onClick={clearSource}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/[0.08] text-xs font-medium text-zinc-400 hover:text-white hover:border-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-subtle)] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Remove image · upload a different one
                  </button>
                </div>
              )}

              {/* Multi-image edit: extra reference frames (Gemini/DashScope blend
                  several inputs). Only meaningful for image-edit. */}
              {mode === 'image-edit' && sourcePreview && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {extraRefs.map((r, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/[0.08] bg-black group/ref">
                          <img src={r.preview} alt={`Reference ${i + 2}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeExtraRef(i)}
                            className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-white opacity-0 group-hover/ref:opacity-100 transition-opacity"
                            aria-label={`Remove reference image ${i + 2}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {/* B1: click to cycle how this reference is used */}
                        <button
                          type="button"
                          onClick={() => cycleRefRole(i)}
                          title="How this reference is used. Click to change: Style (look/colour), Product (keep the subject), Layout (composition)"
                          className="w-16 text-[9px] py-0.5 rounded border border-white/[0.12] bg-white/[0.03] hover:border-[color:var(--color-accent)] transition-colors truncate"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {ROLE_LABEL[r.role]}
                        </button>
                      </div>
                    ))}
                    {extraRefs.length < 7 && (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="w-16 h-16 rounded-lg border-2 border-dashed border-white/[0.1] flex items-center justify-center text-zinc-600 hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] transition-colors"
                        title="Add another reference image"
                      >
                        <Upload className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1.5">
                    {extraRefs.length > 0 ? `${extraRefs.length + 1} images. Tag each: Style (match look/colour), Product (keep the subject), Layout (composition).` : 'Add reference images and tag each as Style, Product, or Layout'}
                  </p>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple={mode === 'image-edit'}
                hidden
                onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {/* End frame — only for image-to-video. Optional: omit to let
                Veo free-interpolate; provide to lock the bookend (Haneen
                workshop ask 2026-05-06). */}
            {mode === 'image-to-video' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-2">
                  End Frame
                  <span className="text-[9px] font-normal text-zinc-600 normal-case tracking-normal">optional. Leave blank for free interpolation</span>
                </label>
                {!endPreview ? (
                  <button
                    onClick={() => endFileRef.current?.click()}
                    className="mt-2 w-full rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 flex flex-col items-center gap-2 hover:border-[color:var(--color-accent)] transition-colors"
                  >
                    <Upload className="w-7 h-7 text-zinc-600" />
                    <p className="text-sm text-zinc-500">Click to upload end frame</p>
                    <p className="text-[10px] text-zinc-700">Locks the last frame of the video</p>
                  </button>
                ) : (
                  <div className="mt-2 relative rounded-xl overflow-hidden border border-white/[0.06] bg-black">
                    <img src={endPreview} alt="End frame" className="w-full max-h-72 object-contain" />
                    <button
                      onClick={clearEnd}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                      title="Clear end frame"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <input ref={endFileRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && handleEndFile(e.target.files[0])} />
              </div>
            )}
          </div>
        )}

        {/* Upscale mode — dedicated controls (no prompt). Size + AI toggle;
            engine picker below drives the AI-detail pass. */}
        {mode === 'upscale' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Target size</label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {[{ label: '4K', v: 4096 }, { label: '8K', v: 8192 }, { label: '12K', v: 12288 }, { label: '16K', v: 16384 }].map((o) => {
                  const active = upscaleTarget === o.v;
                  return (
                    <button key={o.label} type="button"
                      onClick={() => setUpscaleTarget(o.v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active ? '' : 'bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:border-white/[0.12]'}`}
                      style={active ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : undefined}
                    >{o.label}</button>
                  );
                })}
                <span className="text-[11px] text-zinc-500 self-center">→ {upscaleTarget}px long edge</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Detail</label>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => setUpscaleAi(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${!upscaleAi ? '' : 'bg-white/[0.03] text-zinc-400 border-white/[0.06]'}`}
                  style={!upscaleAi ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : undefined}>Fast (instant)</button>
                <button type="button" onClick={() => setUpscaleAi(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${upscaleAi ? '' : 'bg-white/[0.03] text-zinc-400 border-white/[0.06]'}`}
                  style={upscaleAi ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : undefined}>✨ AI detail (~30s)</button>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1.5">{upscaleAi ? 'Regenerates with real added detail via the selected engine below, then scales.' : 'Sharp Lanczos resample. Instant, no new detail. Great for clean AI images.'}</p>
            </div>
          </div>
        )}

        {/* Prompt */}
        {mode !== 'upscale' && (
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
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-[color:var(--color-info-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ borderColor: 'var(--color-info)', background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}
            >
              {improving
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <PenTool className="w-3 h-3" />}
              {improving ? 'Improving...' : 'Improve with AI'}
            </button>
          </div>
          <div className="relative">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={e => {
                // Capture caret BEFORE React's setState batches the re-render
                // (workshop 2026-05-06 #1 — Haneen + Drishti: "append-only"
                // bug caused by React 19 concurrent rendering dropping caret
                // position when prompt state stomped the textarea DOM node).
                const el = e.target;
                const start = el.selectionStart;
                const end = el.selectionEnd;
                setPrompt(e.target.value);
                // Restore caret after the controlled re-render. Without this,
                // typing in the middle of text moves the cursor to the end.
                requestAnimationFrame(() => {
                  if (promptRef.current && document.activeElement === promptRef.current) {
                    promptRef.current.setSelectionRange(start, end);
                  }
                });
              }}
              placeholder={
                mode === 'text-to-image' ? 'A cinematic editorial shot of...' :
                mode === 'image-edit'    ? 'Apply a retro filter, add warm tones...' :
                mode === 'text-to-video' ? 'A 5-second product reveal video, slow camera push...' :
                                            'Animate this image with a slow zoom and parallax...'
              }
              rows={4}
              className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[color:var(--color-accent)] resize-y"
            />
            <button
              type="button"
              onClick={handleImprovePrompt}
              disabled={!prompt.trim() || improving || loading}
              title="Magic pen. Improve prompt"
              className="absolute bottom-2 right-2 w-8 h-8 rounded-lg border hover:bg-[color:var(--color-info-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
              style={{ background: 'var(--color-info-subtle)', borderColor: 'var(--color-info)', color: 'var(--color-info)' }}
            >
              {improving
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PenTool className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        )}

        {/* Improve-with-AI — 3 distinct creative directions to pick from. */}
        <AnimatePresence>
          {improvedVariants.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border bg-gradient-to-br from-[color:var(--color-info-subtle)] to-transparent p-4" style={{ borderColor: 'var(--color-info)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--color-info)' }}>
                    <Sparkles className="w-3 h-3" />
                    Pick a creative direction
                  </div>
                  <button type="button" onClick={discardImprovedPrompt} className="text-[10px] text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] inline-flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {improvedVariants.map((v, i) => (
                    <div key={i} className="flex flex-col rounded-lg border border-white/10 bg-white/[0.03] p-3 hover:border-[color:var(--color-info)] transition-colors">
                      <div className="text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>{i + 1}</span>
                        {v.label}
                      </div>
                      <p className="text-[11px] text-[color:var(--color-fg-muted)] leading-relaxed flex-1 mb-2.5 max-h-44 overflow-y-auto whitespace-pre-wrap">{v.prompt}</p>
                      <button
                        type="button"
                        onClick={() => applyVariant(v)}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold hover:bg-[color:var(--color-info-subtle)] transition-all"
                        style={{ background: 'var(--color-info-subtle)', borderColor: 'var(--color-info)', color: 'var(--color-info)' }}
                      >
                        <CheckCircle2 className="w-3 h-3" /> Use this
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 text-[10px] text-[color:var(--color-fg-subtle)]">Your original prompt stays untouched until you pick one.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Improve-with-AI preview banner — single-version fallback (workshop fix 2026-05-06) */}
        <AnimatePresence>
          {improvedPreview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border bg-gradient-to-br from-[color:var(--color-info-subtle)] to-transparent p-4" style={{ borderColor: 'var(--color-info)' }}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: 'var(--color-info)' }}>
                  <Sparkles className="w-3 h-3" />
                  AI-improved version. Review before applying
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{improvedPreview}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptImprovedPrompt}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-[color:var(--color-info-subtle)] transition-all"
                    style={{ background: 'var(--color-info-subtle)', borderColor: 'var(--color-info)', color: 'var(--color-info)' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Use this version
                  </button>
                  <button
                    type="button"
                    onClick={discardImprovedPrompt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-all"
                  >
                    <X className="w-3.5 h-3.5" /> Discard
                  </button>
                  <span className="ml-1 text-[10px] text-zinc-600">your original prompt is untouched</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Undo improve — surfaces only after the user accepted an improvement,
            never while a fresh preview/picker (which touched nothing yet) is open */}
        {originalBeforeImprove !== null && !improvedPreview && improvedVariants.length === 0 && (
          <button
            type="button"
            onClick={undoImprovedPrompt}
            className="inline-flex items-center gap-1.5 text-[11px] transition-colors hover:opacity-100 opacity-70"
            style={{ color: 'var(--color-info)' }}
          >
            <ChevronUp className="w-3 h-3 rotate-180" />
            Undo improve. Restore original prompt
          </button>
        )}

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
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-600 hover:text-[color:var(--color-danger)] transition-all"
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
                    className="mt-1.5 text-[10px] text-zinc-600 hover:text-[color:var(--color-danger)] transition-colors"
                  >
                    Clear all
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Recent assets — inline thumbnail strip (workshop fix 2026-05-06)
            Haneen reported that switching tabs lost sight of recent generations.
            Now the last MAX_RECENT_ASSETS show inline; click to set as image source. */}
        {recentAssets.length > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                <ImageLucide className="w-3 h-3" />
                Recent generations ({recentAssets.length})
              </div>
              <button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem(RECENT_ASSETS_KEY); } catch {}
                  setRecentAssets([]);
                }}
                className="text-[10px] text-zinc-600 hover:text-[color:var(--color-danger)] transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {recentAssets.map((asset, i) => (
                <button
                  key={`${asset.timestamp}-${i}`}
                  type="button"
                  onClick={async () => {
                    if (asset.outputType === 'image') {
                      // Reuse the image as the source for image-edit / image-to-video.
                      // Recent assets carry a URL (not base64), so fetch + encode it
                      // into sourceBase64/sourceMime — otherwise generation would send
                      // a stale/empty image while the preview shows this thumbnail.
                      setSourcePreview(asset.url);
                      try {
                        const blob = await (await fetch(asset.url)).blob();
                        const dataUrl: string = await new Promise((res, rej) => {
                          const r = new FileReader();
                          r.onload = () => res(r.result as string);
                          r.onerror = rej;
                          r.readAsDataURL(blob);
                        });
                        const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
                        if (m) { setSourceMime(m[1]); setSourceBase64(m[2]); }
                      } catch {
                        setError('Could not load that image as a source. Re-upload it.');
                      }
                    }
                    setResultUrl(asset.url);
                    setProvider('');
                    setError('');
                  }}
                  className="group relative shrink-0 rounded-lg overflow-hidden border border-white/10 hover:border-[color:var(--color-accent)] transition-all"
                  title={asset.prompt}
                >
                  {asset.outputType === 'video' ? (
                    <div className="w-20 h-20 bg-zinc-900 flex items-center justify-center">
                      <Video className="w-5 h-5 text-zinc-500 group-hover:text-[color:var(--color-accent)] transition-colors" />
                    </div>
                  ) : (
                    <img src={asset.url} alt="" className="w-20 h-20 object-cover" loading="lazy" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute bottom-0.5 left-0.5 right-0.5 text-[8px] text-white opacity-0 group-hover:opacity-100 truncate transition-opacity">
                    {asset.mode.replace(/-/g, ' ')}
                  </div>
                </button>
              ))}
            </div>
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
                  title={ar.hint}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    aspectRatio === ar.value
                      ? ''
                      : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                  style={aspectRatio === ar.value
                    ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                    : undefined}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* Style Packs — curated premium looks (motionsites.ai teardown):
              each pack is a precision design contract (exact hexes, materials,
              lighting) applied server-side. Not offered on edit — edits must
              preserve the original image's look. */}
          {mode !== 'image-edit' && stylePacks.length > 0 && (
            <div className="w-full min-w-0 basis-full">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Style pack</label>
              <div className="flex gap-2 mt-2 overflow-x-auto pb-1.5 [scrollbar-width:thin]" style={{ WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)', maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)' }}>
                <button
                  type="button"
                  onClick={() => setStylePackId('')}
                  className={`shrink-0 self-stretch px-3 rounded-xl text-xs font-medium border transition-all ${
                    stylePackId === '' ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                  style={stylePackId === ''
                    ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                    : undefined}
                >
                  None
                </button>
                {stylePacks.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.tagline}
                    onClick={() => setStylePackId(cur => (cur === p.id ? '' : p.id))}
                    className={`shrink-0 w-32 rounded-xl border p-2 text-left transition-all ${
                      stylePackId === p.id ? '' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                    style={stylePackId === p.id
                      ? { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)' }
                      : undefined}
                  >
                    <div className="h-8 w-full rounded-lg mb-1.5" style={{ background: `linear-gradient(120deg, ${p.palette.join(', ')})` }} />
                    <div className="text-[11px] font-semibold leading-tight truncate" style={stylePackId === p.id ? { color: 'var(--color-accent)' } : { color: 'var(--color-text-primary, #d4d4d8)' }}>{p.name}</div>
                    <div className="text-[9px] text-zinc-500 leading-tight truncate">{p.tagline}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt boost dial — how much the server-side enhancer may rewrite.
              Raw answers "the enhancer completely changed my prompt": it ONLY
              translates (Arabic→English for Veo) and never reinterprets.
              Hidden in Upscale mode (no prompt). */}
          {mode !== 'upscale' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Prompt boost</label>
            <div className="flex items-center gap-2 mt-2">
              {([
                { v: 'off' as const, label: 'Off', hint: 'Send your exact words, untouched.' },
                { v: 'raw' as const, label: 'Raw', hint: 'Keep your wording. Only translate for the engine (e.g. Arabic→English for video) and add technical negatives. Never reinterprets your idea.' },
                { v: 'medium' as const, label: '✨ Pro', hint: 'Full rewrite into a production-grade prompt for the selected engine (composition, lighting, cinematography, audio).' },
                { v: 'high' as const, label: 'Max', hint: 'Pushes art direction to the limit. Most specific composition, lighting and palette.' },
              ]).map(o => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setPromptBoost(o.v)}
                  title={o.hint}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    promptBoost === o.v ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                  style={promptBoost === o.v
                    ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                    : undefined}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* B3 — social safe-zone toggle: keep platform-UI bands clear.
              Hidden in Upscale mode. */}
          {mode !== 'upscale' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Social safe zone</label>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setSafeZone(s => !s)}
                title="Keep the top/bottom platform-UI bands clear of text & key elements (Reels/Stories captions + controls)"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  safeZone ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                }`}
                style={safeZone
                  ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                  : undefined}
              >
                {safeZone ? '✓ Reels / Stories safe area' : 'Reels / Stories safe area'}
              </button>
            </div>
          </div>
          )}

          {/* B2 — generate several at once (text-to-image) to compare */}
          {mode === 'text-to-image' && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Variations</label>
              <div className="flex gap-2 mt-2">
                {[1, 2, 4].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setImageCount(n)}
                    title={n > 1 ? `Generate ${n} at once (billed ${n}x)` : 'Single image'}
                    className={`w-11 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      imageCount === n ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                    style={imageCount === n
                      ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                      : undefined}
                  >
                    {n}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Model picker — Auto by default (AURA routes: Qwen Image 3.0 Pro
              first, Gemini and Grok on standby). In Upscale mode it only
              matters when AI detail is on (it picks the detail engine). */}
          {!isVideoMode && (mode !== 'upscale' || upscaleAi) && (
            <ModelPicker
              label={mode === 'upscale' ? 'AI detail model' : 'Model'}
              options={MODELS_BY_SECTION[imageSection]}
              value={validModelValue(imageSection, imageModel)}
              onChange={setImageModel}
              showPrice={canSeePricing}
              priceFor={(o) => (o.perImage ? `$${o.perImage.toFixed(3).replace(/0$/, '')}/img` : '')}
            />
          )}

          {/* Image output resolution — nano-banana renders natively at 1K/2K/4K
              (Imagen clamps 4K→2K; Grok/DashScope ignore). Hidden in Upscale
              mode — Target size (up to 16K) replaces it there. */}
          {!isVideoMode && mode !== 'upscale' && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Resolution</label>
              <div className="flex items-center gap-2 mt-2">
                {IMAGE_SIZES.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setImageSize(s.value)}
                    title={s.hint}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      imageSize === s.value ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                    style={imageSize === s.value
                      ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                      : undefined}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isVideoMode && (
            <ModelPicker
              label={extraRefs.length > 0 ? 'Model · keeps your product consistent' : 'Model'}
              options={MODELS_BY_SECTION[videoSection]}
              value={videoPick.value}
              onChange={setVideoModel}
              showPrice={canSeePricing}
              priceFor={(o) => (o.perSec ? `$${perSecondRate(o, videoRes).toFixed(2)}/s` : '')}
              footnote={videoRes === '1080p' ? 'Rates shown at 1080p.' : undefined}
            />
          )}

          {isVideoMode && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Duration</label>
              <div className="flex items-center gap-2 mt-2">
                {durationsFor(videoPick).map(v => ({ label: `${v}s`, value: v })).map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    disabled={isVeoPick && videoRes === '1080p' && d.value !== 8}
                    title={isVeoPick && videoRes === '1080p' && d.value !== 8 ? 'Veo 1080p requires an 8s clip' : undefined}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      duration === d.value
                        ? ''
                        : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                    style={duration === d.value
                      ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                      : undefined}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isVideoMode && (
            <div>
              {/* Per-engine cost — each engine is one explicit provider, so the
                  price is just that engine's rate × duration. No hidden tier. */}
              {(() => {
                const rate = perSecondRate(videoPick, videoRes);
                const name = videoPick.value === 'auto' ? 'Auto (Wan 3.0 first)' : videoPick.label;
                // Cost line is owner/admin/accounting only; everyone else still
                // sees which engine and how long the clip is, just no money.
                return (
                  <p className="text-[10px]" style={{ color: 'var(--color-fg-muted)' }}>
                    {canSeePricing
                      ? <>≈ ${(rate * duration).toFixed(2)} for this {duration}s clip · {name} (${rate.toFixed(2)}/s at {videoRes})</>
                      : <>{duration}s clip · {name}</>}
                  </p>
                );
              })()}
            </div>
          )}

          {/* HD output resolution — offered when the picked engine renders
              1080p (Auto, Wan 3.0, HappyHorse, Veo). Veo needs an 8s clip at
              1080p, so that pick locks duration to 8. Alibaba engines charge
              double per second at 1080p (the cost line reflects it). */}
          {isVideoMode && videoPick.supports1080 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Output</label>
              <div className="flex items-center gap-2 mt-2">
                {(['720p', '1080p'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { setVideoRes(r); if (r === '1080p' && isVeoPick) setDuration(8); }}
                    title={r === '1080p' ? (isVeoPick ? 'Full HD. Veo requires an 8s clip' : 'Full HD. Double the per-second rate on Alibaba engines') : 'Standard'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      videoRes === r ? '' : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                    style={videoRes === r
                      ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }
                      : undefined}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Optional avoid-list for video — merged into Veo's negativePrompt
              (stability negatives are always on server-side; this adds the
              user's own "never show X" terms). */}
          {isVideoMode && (
            <div className="min-w-[220px] flex-1">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Avoid (optional)</label>
              <input
                type="text"
                value={negPrompt}
                onChange={e => setNegPrompt(e.target.value)}
                placeholder="e.g. text overlays, crowds, slow motion"
                maxLength={300}
                className="mt-2 w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-white/[0.15]"
              />
            </div>
          )}

          {/* Veo asset refs — the EXACT product/subject stays consistent in
              the clip (top team ask: "image→video returned a different
              product"). Google constraint: reference-conditioned clips are 8s. */}
          {isVideoMode && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Product refs ({Math.min(extraRefs.length, 3)}/3)</label>
              <div className="flex items-center gap-2 mt-2">
                {extraRefs.slice(0, 3).map((r, i) => (
                  <div key={i} className="relative group">
                    <img src={r.preview} alt="" className="w-9 h-9 rounded-lg object-cover border border-white/[0.08]" />
                    <button
                      type="button"
                      onClick={() => removeExtraRef(i)}
                      aria-label="Remove reference"
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-800 border border-white/[0.15] text-zinc-300 text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    >×</button>
                  </div>
                ))}
                {extraRefs.length < 3 && (
                  <button
                    type="button"
                    onClick={() => videoRefInputRef.current?.click()}
                    title="Attach up to 3 images of the exact product/subject. Veo keeps them consistent (8s clips)"
                    className="w-9 h-9 rounded-lg border border-dashed border-white/[0.12] text-zinc-500 text-sm hover:border-white/[0.25] hover:text-zinc-300 transition-colors"
                  >+</button>
                )}
                <input
                  ref={videoRefInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files;
                    if (f?.length) {
                      setError('');
                      Promise.all(Array.from(f).map(fileToBase64))
                        .then(encoded => {
                          setExtraRefs(prev => [
                            ...prev,
                            ...encoded.map(en => ({ base64: en.base64, mimeType: en.mimeType, preview: `data:${en.mimeType};base64,${en.base64}`, role: 'character' as RefRole })),
                          ].slice(0, 3));
                          setDuration(8); // reference-conditioned clips are 8s
                        })
                        .catch(err => setError(err?.message || 'Failed to read files'));
                    }
                    e.target.value = '';
                  }}
                />
              </div>
              {extraRefs.length > 0 && (
                <p className="text-[10px] mt-1.5 text-zinc-600">Subject kept consistent · 8s clip · Veo</p>
              )}
            </div>
          )}
        </div>

        {/* Generate row */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={handleGenerate}
            disabled={loading || (mode === 'upscale' ? !sourceBase64 : (!prompt.trim() || (modeDef.needsImage && !sourceBase64)))}
            className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : mode === 'upscale' ? <Maximize2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            {loading
              ? (mode === 'upscale' ? `Upscaling... ${Math.round(progress)}%` : `Generating... ${Math.round(progress)}%`)
              : mode === 'upscale' ? 'Upscale' : `Generate ${isVideoMode ? 'Video' : 'Image'}`}
          </button>
          {loading && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 border px-4 py-3 rounded-xl text-sm font-medium hover:bg-[color:var(--color-danger-subtle)]"
              style={{ background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
          <p className="ml-auto text-[10px] text-zinc-700">
            {selectedClientId ? 'Result will be saved to client assets' : 'Pick a client to auto-save results'}
          </p>
        </div>

        {/* Progress bar — visible during all generation modes (workshop fix 2026-05-06) */}
        {loading && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (() => {
            const isRateLimit = errorCode === 429 || /rate.?limit/i.test(error);
            const isUnavailable = errorCode === 503 || /unavailable|gemini/i.test(error);
            const tone = isRateLimit ? 'warning' : isUnavailable ? 'muted' : 'danger';
            const toneColor = tone === 'warning' ? 'var(--color-warning)' : tone === 'muted' ? 'var(--color-fg-muted)' : 'var(--color-danger)';
            const toneBg = tone === 'warning' ? 'var(--color-warning-subtle)' : tone === 'muted' ? 'var(--color-surface-hover)' : 'var(--color-danger-subtle)';
            const label = isRateLimit ? 'Rate limited' : isUnavailable ? 'Provider unavailable' : 'Error';
            return (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-xl border px-4 py-3 flex items-start gap-3"
                style={{ background: toneBg, borderColor: toneColor }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: toneColor }} />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: toneColor }}>{label}</p>
                  <p className="text-sm" style={{ color: toneColor }}>{error}</p>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Result */}
        {resultUrl && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
            {/* The pro prompt that actually ran — visible so the team learns
                what good prompts look like (and can copy/tweak them). */}
            {lastEnhanced && (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer select-none hover:text-zinc-300 transition-colors">✨ Pro prompt used (click to view)</summary>
                <p className="mt-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-zinc-400 leading-relaxed whitespace-pre-wrap">{lastEnhanced}</p>
              </details>
            )}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Result</h3>
              <div className="flex items-center gap-2">
                {/* Teach-the-AI thumbs: stores this prompt's style as a win/miss
                    for the client so future generations lean toward (or away
                    from) it. One vote per generation. */}
                {genId && (
                  <span className="flex items-center gap-1 mr-1">
                    <button
                      type="button"
                      disabled={voted !== null}
                      title="Good one. The AI will lean toward this style for this client"
                      onClick={async () => { setVoted('up'); try { await creativeApi.feedback(genId, true); } catch { /* best-effort */ } }}
                      className={`p-1 rounded-md border transition-all ${voted === 'up' ? '' : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.1]'} ${voted === 'down' ? 'opacity-30' : ''}`}
                      style={voted === 'up' ? { color: 'var(--color-success)', background: 'var(--color-success-subtle)', borderColor: 'var(--color-success)' } : undefined}
                    >
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={voted !== null}
                      title="Off-brand. The AI will avoid this direction for this client"
                      onClick={async () => { setVoted('down'); try { await creativeApi.feedback(genId, false); } catch { /* best-effort */ } }}
                      className={`p-1 rounded-md border transition-all ${voted === 'down' ? '' : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.1]'} ${voted === 'up' ? 'opacity-30' : ''}`}
                      style={voted === 'down' ? { color: 'var(--color-danger)', background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger)' } : undefined}
                    >
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                    {voted && <span className="text-[10px] text-zinc-600">AI noted ✓</span>}
                  </span>
                )}
                {savedAssetId && (
                  <span className="flex items-center gap-1 text-[10px] border rounded-md px-2 py-0.5" style={{ color: 'var(--color-success)', background: 'var(--color-success-subtle)', borderColor: 'var(--color-success)' }}>
                    <CheckCircle2 className="w-3 h-3" /> Saved to assets
                  </span>
                )}
                {provider && <span className="text-[10px] text-zinc-600">via {provider}</span>}
                <a
                  href={resultUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] hover:opacity-80"
                  style={{ color: 'var(--color-accent)' }}
                >
                  <Download className="w-3 h-3" /> Download
                </a>
                {savedAssetId && (
                  <button
                    type="button"
                    onClick={() => setAttachModalOpen(true)}
                    className="flex items-center gap-1 text-[10px] hover:opacity-80 border rounded-md px-2 py-0.5"
                    style={{ color: 'var(--color-info)', background: 'var(--color-info-subtle)', borderColor: 'var(--color-info)' }}
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

            {/* Upscaler — scale the result up to 16K (image results only) */}
            {modeDef.outputType === 'image' && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mr-1">Upscale</span>
                  <button
                    type="button"
                    disabled={upscaling !== null}
                    onClick={() => setUpscaleAi(v => !v)}
                    title={upscaleAi ? 'AI detail: regenerates with real added detail via our models (Gemini/Qwen), then scales. Slower, sharper' : 'Fast: instant Lanczos resample (no new detail)'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                      upscaleAi ? '' : 'bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:border-white/[0.12]'
                    }`}
                    style={upscaleAi ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : undefined}
                  >
                    {upscaleAi ? '✨ AI detail ON' : 'AI detail off'}
                  </button>
                  <span className="w-px h-4 bg-white/[0.08] mx-0.5" />
                  {([
                    { label: '2×', scale: 2 as const },
                    { label: '4×', scale: 4 as const },
                    { label: '8×', scale: 8 as const },
                    { label: '16K', target: 16384 },
                  ]).map((o: any) => {
                    const active = upscaling === (o.target || o.scale);
                    return (
                      <button
                        key={o.label}
                        type="button"
                        disabled={upscaling !== null}
                        title={o.target ? 'Scale the long edge to 16384px' : `Upscale ${o.label}`}
                        onClick={async () => {
                          const tag = o.target || o.scale;
                          setUpscaling(tag); setUpscaled(null);
                          try {
                            const r = await creativeApi.upscale({
                              sourceUrl: resultUrl,
                              ...(o.target ? { targetLongEdge: o.target } : { scale: o.scale }),
                              mode: upscaleAi ? 'ai' : 'fast',
                              // AI-detail pass uses whichever engine is selected in the picker
                              // (nano-banana / Qwen / Wan) — falls back through the chain.
                              ...(upscaleAi ? imageRequestFor('upscale', imageModel) : {}),
                              clientId: selectedClientId || undefined,
                            });
                            setUpscaled({ url: r.assetUrl || r.fileUrl, width: r.width, height: r.height, bytes: r.bytes, aiEnhanced: (r as any).aiEnhanced });
                          } catch (e: any) {
                            setError(e?.message || 'Upscale failed');
                          } finally { setUpscaling(null); }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                          active ? '' : 'bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:border-white/[0.12]'
                        }`}
                        style={active ? { background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', borderColor: 'var(--color-accent)' } : undefined}
                      >
                        {active ? <Loader2 className="w-3 h-3 animate-spin" /> : o.label}
                      </button>
                    );
                  })}
                  {upscaling !== null && <span className="text-[11px] text-zinc-500">{upscaleAi ? 'AI-enhancing then scaling… ~30s' : 'Upscaling… a few seconds'}</span>}
                  {upscaled && (
                    <a
                      href={upscaled.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
                    >
                      <Download className="w-3 h-3" /> {upscaled.aiEnhanced ? '✨ ' : ''}{upscaled.width}×{upscaled.height} · {(upscaled.bytes / 1024 / 1024).toFixed(1)}MB
                    </a>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* B2 — additional variations from a x2/x4 run; click to promote to primary */}
        {extraResults.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">More variations ({extraResults.length})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {extraResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setResultUrl(r.url); setSavedAssetId(r.assetId); }}
                  title="Make this the primary result (for download / attach)"
                  className="rounded-xl overflow-hidden border border-white/[0.06] bg-black hover:border-[color:var(--color-accent)] transition-colors"
                >
                  <img src={r.url} alt={`Variation ${i + 2}`} className="w-full h-auto" />
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600">Click a variation to make it the primary result.</p>
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
                  <code className="text-xs truncate flex-1" style={{ color: 'var(--color-success)' }}>{savedAssetId}</code>
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
                    {copiedAssetId ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> : <Copy className="w-3.5 h-3.5" />}
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
                      className="flex-1 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[color:var(--color-accent)]"
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
                      className="flex items-center gap-1.5 border px-4 py-2 rounded-lg text-sm font-medium hover:bg-[color:var(--color-info-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      style={{ background: 'var(--color-info-subtle)', borderColor: 'var(--color-info)', color: 'var(--color-info)' }}
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionUI, delay: 0.1 }}
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
