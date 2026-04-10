import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Upload, Video as VideoIcon, Sparkles, FileText, AlertCircle, Link as LinkIcon, X } from 'lucide-react';
import { analyzeApi, assetsApi } from '../lib/backend-api';
import { useClients } from '../lib/client-context';

interface AnalysisResult {
  summary: string;
  themes: string[];
  targetAudience: string;
  socialHooks: string[];
  timestamps: { time: string; description: string }[];
  suggestions: string[];
  provider?: string;
  latencyMs?: number;
}

type SourceMode = 'url' | 'upload';

export default function VideoAnalysis() {
  const { selectedClientId } = useClients();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string>('');
  const [prompt, setPrompt] = useState('Analyze this video and extract key themes, target audience, and social-media hooks.');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const handleUpload = async (file: File) => {
    if (!selectedClientId) {
      setError('Select a client first to upload assets.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const asset = await assetsApi.upload(selectedClientId, file);
      setVideoUrl(asset.fileUrl);
      setUploadedFile(file.name);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!videoUrl.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const out = await analyzeApi.video({
        videoUrl: videoUrl.trim(),
        prompt: prompt.trim() || undefined,
        clientId: selectedClientId || undefined,
      });
      setResult(out);
    } catch (err: any) {
      setError(err?.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <VideoIcon className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Video Analysis</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Get social-media insights from a video URL or upload. <span className="text-amber-400/70">Beta — v1 uses URL/filename context.</span></p>
          </div>
        </div>
      </motion.div>

      <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5 space-y-5">
        <div className="flex items-center gap-2">
          {([
            { id: 'url' as SourceMode, label: 'Paste URL', icon: LinkIcon },
            { id: 'upload' as SourceMode, label: 'Upload File', icon: Upload },
          ]).map(m => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => { setSourceMode(m.id); setVideoUrl(''); setUploadedFile(''); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  sourceMode === m.id
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-white/[0.03] text-zinc-500 border-white/[0.06]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        {sourceMode === 'url' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Video URL</label>
            <input
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://example.com/video.mp4 or /uploads/..."
              className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
            />
          </div>
        )}

        {sourceMode === 'upload' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Upload Video</label>
            {!uploadedFile ? (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="mt-2 w-full rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] px-6 py-10 flex flex-col items-center gap-2 hover:border-amber-500/30 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                    <p className="text-sm text-zinc-500">Uploading...</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-zinc-600" />
                    <p className="text-sm text-zinc-500">Click to upload a video</p>
                    <p className="text-[10px] text-zinc-700">MP4, MOV, WebM up to 25 MB</p>
                  </>
                )}
              </button>
            ) : (
              <div className="mt-2 rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3 flex items-center gap-3">
                <VideoIcon className="w-5 h-5 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{uploadedFile}</p>
                  <p className="text-[10px] text-zinc-600 truncate">{videoUrl}</p>
                </div>
                <button
                  onClick={() => { setUploadedFile(''); setVideoUrl(''); }}
                  className="p-1.5 text-zinc-600 hover:text-red-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Analysis Instructions</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 resize-y"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading || !videoUrl.trim()}
          className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Analyzing...' : 'Analyze Video'}
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

      {result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {result.summary && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">Summary</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">{result.summary}</p>
              {result.provider && <p className="text-[10px] text-zinc-700 mt-2">via {result.provider}</p>}
            </div>
          )}

          {result.themes.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Themes</h3>
              <div className="flex flex-wrap gap-2">
                {result.themes.map((t, i) => (
                  <span key={i} className="px-3 py-1 rounded-lg text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">{t}</span>
                ))}
              </div>
            </div>
          )}

          {result.targetAudience && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">Target Audience</h3>
              <p className="text-sm text-zinc-300">{result.targetAudience}</p>
            </div>
          )}

          {result.socialHooks.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Social Hooks</h3>
              <ol className="space-y-2">
                {result.socialHooks.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <span className="text-amber-400 shrink-0">{i + 1}.</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.timestamps.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Timestamps</h3>
              <div className="space-y-2">
                {result.timestamps.map((t, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="text-amber-400 font-mono shrink-0">{t.time}</span>
                    <span className="text-zinc-300">{t.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div className="bg-[#0c0c0c] border border-white/[0.06] rounded-2xl p-5">
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3">Suggestions</h3>
              <ul className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
