import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Upload, Download, Wand2, Eraser, Type, Paintbrush, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { creativeApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';

const QUICK_ACTIONS = [
  { name: 'Remove BG', icon: Eraser, prompt: 'Remove the background and make it transparent' },
  { name: 'Enhance', icon: Wand2, prompt: 'Enhance the image quality, improve lighting and colors' },
  { name: 'Cinematic', icon: Paintbrush, prompt: 'Apply cinematic color grading with dramatic lighting' },
  { name: 'Add Text', icon: Type, prompt: 'Add bold modern typography overlay' },
];

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

export default function ImageEditing() {
  const { selectedClientId } = useClients();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sourcePreview, setSourcePreview] = useState<string>('');
  const [sourceBase64, setSourceBase64] = useState<string>('');
  const [sourceMime, setSourceMime] = useState<string>('image/png');
  const [prompt, setPrompt] = useState('Add a retro filter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [provider, setProvider] = useState('');

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

  const handleEdit = async () => {
    if (!sourceBase64 || !prompt.trim()) return;
    setLoading(true);
    setError('');
    setResultUrl('');
    setSavedAssetId(null);
    setProvider('');

    try {
      const out = await creativeApi.editImage({
        prompt: prompt.trim(),
        imageBase64: sourceBase64,
        mimeType: sourceMime,
        clientId: selectedClientId || undefined,
      });
      setResultUrl(out.assetUrl || out.url || '');
      setSavedAssetId(out.assetId || null);
      setProvider(out.provider || '');
    } catch (err: any) {
      setError(err?.message || 'Edit failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Image Editor</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Upload an image and apply prompt-based edits via the backend AI router.</p>
          </div>
        </div>
      </motion.div>

      <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Source Image</label>
          {!sourcePreview ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="mt-2 w-full rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-12 flex flex-col items-center gap-2 hover:border-amber-500/30 transition-colors"
            >
              <Upload className="w-8 h-8 text-zinc-600" />
              <p className="text-sm text-zinc-500">Click to upload an image</p>
              <p className="text-[10px] text-zinc-700">PNG, JPG, WebP up to 25 MB</p>
            </button>
          ) : (
            <div className="mt-2 relative rounded-xl overflow-hidden border border-white/[0.06] bg-black">
              <img src={sourcePreview} alt="Source" className="w-full max-h-96 object-contain" />
              <button
                onClick={() => { setSourcePreview(''); setSourceBase64(''); setResultUrl(''); }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                title="Clear"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Quick Edits</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_ACTIONS.map(qa => {
              const Icon = qa.icon;
              return (
                <button
                  key={qa.name}
                  onClick={() => setPrompt(qa.prompt)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] text-zinc-400 border border-white/[0.06] hover:border-amber-500/30 hover:text-white"
                >
                  <Icon className="w-3 h-3" /> {qa.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Edit Instructions</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 resize-y"
          />
        </div>

        <button
          onClick={handleEdit}
          disabled={loading || !sourceBase64 || !prompt.trim()}
          className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {loading ? 'Editing...' : 'Apply Edit'}
        </button>
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

      {resultUrl && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Edited Result</h3>
            <div className="flex items-center gap-2">
              {savedAssetId && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-0.5">
                  <CheckCircle2 className="w-3 h-3" /> Saved to assets
                </span>
              )}
              {provider && <span className="text-[10px] text-zinc-600">via {provider}</span>}
              <a href={resultUrl} download target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300">
                <Download className="w-3 h-3" /> Download
              </a>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-zinc-600 mb-1">Before</p>
              <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
                <img src={sourcePreview} alt="Before" className="w-full h-auto" />
              </div>
            </div>
            <div>
              <p className="text-[10px] text-zinc-600 mb-1">After</p>
              <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black">
                <img src={resultUrl} alt="After" className="w-full h-auto" />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
