import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, Image as ImageIcon, Video, Wand2, Download, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { creativeApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';

type Mode = 'image' | 'video';

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
];

export default function ImageGeneration() {
  const { selectedClientId } = useClients();
  const [mode, setMode] = useState<Mode>('image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultType, setResultType] = useState<'image' | 'video'>('image');
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [provider, setProvider] = useState('');

  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  const reset = () => {
    setError('');
    setResultUrl('');
    setSavedAssetId(null);
    setProvider('');
    setProgress(0);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    cancelledRef.current = false;
    setLoading(true);
    reset();

    try {
      if (mode === 'image') {
        const out = await creativeApi.generateImage({
          prompt: prompt.trim(),
          aspectRatio,
          clientId: selectedClientId || undefined,
        });
        setResultUrl(out.assetUrl || out.url || '');
        setResultType('image');
        setSavedAssetId(out.assetId || null);
        setProvider(out.provider || '');
      } else {
        const { jobId } = await creativeApi.generateVideo({
          prompt: prompt.trim(),
          aspectRatio: aspectRatio as any,
          clientId: selectedClientId || undefined,
        });

        let attempts = 0;
        while (attempts < 120 && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 5000));
          if (cancelledRef.current) break;
          const job = await creativeApi.getJob(jobId);
          setProgress(job.progress || 0);
          if (job.status === 'completed') {
            setResultUrl(job.result?.url || '');
            setResultType('video');
            setProvider(job.result?.provider || '');
            break;
          }
          if (job.status === 'failed') {
            throw new Error(job.error || 'Video generation failed');
          }
          attempts++;
        }
        if (attempts >= 120) throw new Error('Video generation timed out after 10 minutes');
      }
    } catch (err: any) {
      if (!cancelledRef.current) setError(err?.message || 'Generation failed');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    setLoading(false);
    setError('Cancelled');
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Image &amp; Video Generation</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Generate via the backend AI router. Results auto-saved to client assets when a client is selected.</p>
          </div>
        </div>
      </motion.div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        {([
          { id: 'image' as Mode, label: 'Image', icon: ImageIcon },
          { id: 'video' as Mode, label: 'Video', icon: Video },
        ]).map(m => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); reset(); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                mode === m.id
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:border-white/[0.1]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Prompt */}
      <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={mode === 'image' ? 'A cinematic editorial shot of...' : 'A 5-second product reveal video...'}
            rows={4}
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 resize-y"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Aspect Ratio</label>
          <div className="flex items-center gap-2 mt-2">
            {ASPECT_RATIOS.map(ar => (
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

        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {loading ? (mode === 'video' ? `Generating... ${progress}%` : 'Generating...') : `Generate ${mode === 'image' ? 'Image' : 'Video'}`}
          </button>
          {loading && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-red-500/20"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      {resultUrl && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-3">
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
            </div>
          </div>
          <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
            {resultType === 'image' ? (
              <img src={resultUrl} alt="Generated" className="w-full h-auto" />
            ) : (
              <video src={resultUrl} controls className="w-full h-auto" />
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
