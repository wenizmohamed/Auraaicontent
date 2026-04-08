import { useState, useRef, useEffect } from 'react';
import { getGemini } from '../lib/gemini';
import { Loader2, Download, Sparkles, Image as ImageIcon, Video, Wand2, Send, ArrowRight, Upload, X, Film, Type, RefreshCw, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { isComfyUIRunning, generateWithComfyUI, getLocalModels } from '../lib/comfyui';

type Mode = 'text-to-image' | 'text-to-video' | 'image-to-video' | 'prompt-improver' | 'comfyui';

export default function ImageGeneration() {
  const [mode, setMode] = useState<Mode>('text-to-image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [result, setResult] = useState('');
  const [resultType, setResultType] = useState<'image' | 'video' | 'text'>('image');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageBytes, setUploadedImageBytes] = useState<string | null>(null);
  const [improvedPrompt, setImprovedPrompt] = useState('');
  const [videoPolling, setVideoPolling] = useState(false);
  const cancelRef = useRef(false);

  const handleStop = () => {
    cancelRef.current = true;
    setLoading(false);
    setVideoPolling(false);
    setError('Generation cancelled.');
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addGeneratedImage, generatedImages } = useStore();
  const [comfyAvailable, setComfyAvailable] = useState(false);
  const [comfyModels, setComfyModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  // Check if ComfyUI is running on startup
  useEffect(() => {
    isComfyUIRunning().then(running => {
      setComfyAvailable(running);
      if (running) getLocalModels().then(models => { setComfyModels(models); if (models.length) setSelectedModel(models[0]); });
    });
  }, []);

  const modes: { id: Mode; label: string; icon: any; desc: string }[] = [
    { id: 'text-to-image', label: 'Text to Image', icon: ImageIcon, desc: 'Nano Banana 2' },
    { id: 'comfyui', label: 'ComfyUI', icon: Cpu, desc: comfyAvailable ? 'Local GPU' : '5K Credits' },
    { id: 'text-to-video', label: 'Text to Video', icon: Video, desc: 'Veo 3.1' },
    { id: 'image-to-video', label: 'Image to Video', icon: Film, desc: 'Animate image' },
    { id: 'prompt-improver', label: 'Prompt Improver', icon: Wand2, desc: 'Enhance prompt' },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUploadedImage(dataUrl);
      const base64 = dataUrl.split(',')[1];
      setUploadedImageBytes(base64);
    };
    reader.readAsDataURL(file);
  };

  // ─── TEXT TO IMAGE ─────────────────────────────────────────────
  const generateImage = async () => {
    setLoading(true);
    setError('');
    setResult('');
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: aspectRatio as any, imageSize: imageSize as any },
        },
      });

      let base64Image = '';
      let textResponse = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = part.inlineData.data || '';
        }
        if (part.text) {
          textResponse += part.text;
        }
      }

      if (base64Image) {
        const imageUrl = `data:image/png;base64,${base64Image}`;
        setResult(imageUrl);
        setResultType('image');
        addGeneratedImage({ base64: base64Image, url: imageUrl, prompt });
      } else {
        throw new Error(textResponse || 'No image returned from model');
      }
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  // ─── TEXT TO VIDEO ─────────────────────────────────────────────
  const generateVideo = async () => {
    setLoading(true);
    setVideoPolling(true);
    setError('');
    setResult('');
    try {
      const ai = getGemini();
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: prompt,
        config: { aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9' },
      });

      // Poll for completion (with cancel check)
      cancelRef.current = false;
      let attempts = 0;
      while (!operation.done && attempts < 60) {
        if (cancelRef.current) throw new Error('Cancelled by user');
        await new Promise(resolve => setTimeout(resolve, 10000));
        if (cancelRef.current) throw new Error('Cancelled by user');
        operation = await ai.operations.getVideosOperation({ operation });
        attempts++;
      }

      if (operation.done && operation.response?.generatedVideos?.[0]) {
        const video = operation.response.generatedVideos[0].video;
        if (video?.uri) {
          const videoRes = await fetch(video.uri + '&key=' + (process.env.GEMINI_API_KEY || ''));
          if (videoRes.ok) {
            const blob = await videoRes.blob();
            const videoUrl = URL.createObjectURL(blob);
            setResult(videoUrl);
            setResultType('video');
          } else {
            throw new Error('Failed to download video from URI');
          }
        } else if (video?.videoBytes) {
          const videoUrl = `data:video/mp4;base64,${video.videoBytes}`;
          setResult(videoUrl);
          setResultType('video');
        } else {
          throw new Error('Video generated but no downloadable data');
        }
      } else {
        throw new Error('Video generation timed out or failed');
      }
    } catch (err: any) {
      setError(err.message || 'Video generation failed');
    } finally {
      setLoading(false);
      setVideoPolling(false);
    }
  };

  // ─── IMAGE TO VIDEO ────────────────────────────────────────────
  const imageToVideo = async () => {
    if (!uploadedImageBytes) { setError('Upload an image first'); return; }
    setLoading(true);
    setVideoPolling(true);
    setError('');
    setResult('');
    try {
      const ai = getGemini();
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: prompt || 'Animate this image with subtle, natural motion',
        image: { imageBytes: uploadedImageBytes, mimeType: 'image/png' },
      });

      cancelRef.current = false;
      let attempts = 0;
      while (!operation.done && attempts < 60) {
        if (cancelRef.current) throw new Error('Cancelled by user');
        await new Promise(resolve => setTimeout(resolve, 10000));
        if (cancelRef.current) throw new Error('Cancelled by user');
        operation = await ai.operations.getVideosOperation({ operation });
        attempts++;
      }

      if (operation.done && operation.response?.generatedVideos?.[0]) {
        const video = operation.response.generatedVideos[0].video;
        if (video?.uri) {
          const videoRes = await fetch(video.uri + '&key=' + (process.env.GEMINI_API_KEY || ''));
          if (videoRes.ok) {
            const blob = await videoRes.blob();
            const videoUrl = URL.createObjectURL(blob);
            setResult(videoUrl);
            setResultType('video');
          } else {
            throw new Error('Failed to download video from URI');
          }
        } else if (video?.videoBytes) {
          const videoUrl = `data:video/mp4;base64,${video.videoBytes}`;
          setResult(videoUrl);
          setResultType('video');
        } else {
          throw new Error('Video generated but no downloadable data');
        }
      } else {
        throw new Error('Video generation timed out');
      }
    } catch (err: any) {
      setError(err.message || 'Image-to-video failed');
    } finally {
      setLoading(false);
      setVideoPolling(false);
    }
  };

  // ─── PROMPT IMPROVER ───────────────────────────────────────────
  const improvePrompt = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setImprovedPrompt('');
    try {
      const ai = getGemini();
      const analyzePrompt = `Analyze this image generation prompt and return a JSON object with an improved version.

ORIGINAL PROMPT: "${prompt}"

Provide an 'improvedPrompt'. This must be a highly optimized text prompt for an AI image generator to create a truly photorealistic, unretouched photograph.

CRITICAL: Match the EXACT style, context, and medium described. If it describes a casual smartphone selfie, specify "smartphone mirror selfie, casual lighting, unposed, candid". If professional, specify camera gear.

The improved prompt MUST include:
1. Subject description and exact setting/context
2. Appropriate camera/medium details (e.g., iPhone 15 Pro Max, OR Sony A7R IV if professional)
3. Exact lighting conditions (warm lamp light, harsh flash, natural window light, golden hour, etc.)
4. Explicit photorealism keywords appropriate for the medium (raw unedited photo, candid, natural skin texture)

CRITICAL: Maintain natural beauty. Do NOT make subjects look ugly or overly blemished. Photorealism = real photo of an attractive person, not artificial flaws.

Do NOT use generic AI words like "masterpiece", "perfect", "flawless", or "trending".

Also provide:
- "analysis": Brief analysis of what the original prompt does well/poorly
- "style": The detected style (photorealistic, illustration, 3D, abstract, etc.)
- "suggestedAspectRatio": Best aspect ratio for this content
- "suggestedModel": Best Gemini model for this type of image

Return ONLY valid JSON:
{
  "improvedPrompt": "the enhanced prompt...",
  "analysis": "what was improved and why...",
  "style": "detected style",
  "suggestedAspectRatio": "16:9",
  "suggestedModel": "gemini-3.1-flash-image-preview"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: analyzePrompt,
      });

      const text = response.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setImprovedPrompt(parsed.improvedPrompt || '');
        setResultType('text');
        setResult(JSON.stringify(parsed, null, 2));
        if (parsed.suggestedAspectRatio) setAspectRatio(parsed.suggestedAspectRatio);
      } else {
        setImprovedPrompt(text);
        setResult(text);
        setResultType('text');
      }
    } catch (err: any) {
      setError(err.message || 'Prompt improvement failed');
    } finally {
      setLoading(false);
    }
  };

  // ─── COMFYUI GENERATION ──────────────────────────────────────────
  const generateWithComfy = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setResult('');
    try {
      const width = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 1024 : 1216;
      const height = aspectRatio === '9:16' ? 1344 : aspectRatio === '1:1' ? 1024 : 832;
      const base64 = await generateWithComfyUI({
        prompt,
        model: selectedModel || undefined,
        width,
        height,
        mode: comfyAvailable ? 'local' : 'cloud',
      });
      const imageUrl = `data:image/png;base64,${base64}`;
      setResult(imageUrl);
      setResultType('image');
      addGeneratedImage({ base64, url: imageUrl, prompt });
    } catch (err: any) {
      setError(err.message || 'ComfyUI generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    switch (mode) {
      case 'text-to-image': return generateImage();
      case 'comfyui': return generateWithComfy();
      case 'text-to-video': return generateVideo();
      case 'image-to-video': return imageToVideo();
      case 'prompt-improver': return improvePrompt();
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result;
    a.download = resultType === 'video' ? `radix-video-${Date.now()}.mp4` : `radix-image-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-black text-white tracking-tight">Creative Tools</h1>
        <p className="text-sm text-zinc-500 mt-1">Generate images, videos, and enhance prompts with AI</p>
      </motion.div>

      {/* Mode Selector */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setResult(''); setError(''); }}
            className={`flex items-center gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${
              mode === m.id
                ? 'bg-white/[0.08] border-white/[0.15] text-white'
                : 'bg-[#0c0c0c] border-white/[0.06] text-zinc-500 hover:border-white/[0.1] hover:text-zinc-300'
            }`}
          >
            <m.icon className={`w-5 h-5 ${mode === m.id ? 'text-white' : 'text-zinc-600'}`} />
            <div className="text-left">
              <div className="text-sm font-semibold">{m.label}</div>
              <div className="text-[10px] text-zinc-600">{m.desc}</div>
            </div>
          </button>
        ))}
      </motion.div>

      {/* Main Panel */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 space-y-5">

        {/* Image upload for image-to-video */}
        {mode === 'image-to-video' && (
          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Source Image</label>
            {uploadedImage ? (
              <div className="relative inline-block">
                <img src={uploadedImage} alt="Uploaded" className="max-h-48 rounded-xl border border-white/10" />
                <button onClick={() => { setUploadedImage(null); setUploadedImageBytes(null); }}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-3 px-6 py-8 rounded-2xl border-2 border-dashed border-white/10 hover:border-white/20 text-zinc-500 hover:text-zinc-300 transition-all w-full justify-center cursor-pointer">
                <Upload className="w-5 h-5" />
                <span className="text-sm font-medium">Upload image to animate</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
          </div>
        )}

        {/* Prompt Input */}
        <div>
          <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            {mode === 'prompt-improver' ? 'Prompt to Improve' : 'Prompt'}
          </label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'text-to-image' ? 'Describe the image you want to create...' :
              mode === 'text-to-video' ? 'Describe the video scene — action, camera movement, mood...' :
              mode === 'image-to-video' ? 'Describe the animation — "slow zoom in with gentle parallax"...' :
              'Paste any prompt here and AI will optimize it for photorealistic generation...'
            }
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-zinc-700 text-sm leading-relaxed focus:ring-2 focus:ring-white/20 focus:border-transparent resize-none transition-all"
          />
        </div>

        {/* Config row */}
        <div className="flex flex-wrap items-end gap-4">
          {/* Aspect Ratio */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5">Aspect Ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-sm focus:ring-2 focus:ring-white/20 [&>option]:bg-zinc-900 cursor-pointer">
              <option value="1:1">1:1 Square</option>
              <option value="3:4">3:4 Portrait</option>
              <option value="4:3">4:3 Landscape</option>
              <option value="9:16">9:16 Story/Reel</option>
              <option value="16:9">16:9 Widescreen</option>
              <option value="21:9">21:9 Cinematic</option>
            </select>
          </div>

          {/* Image Size (only for text-to-image) */}
          {mode === 'text-to-image' && (
            <div className="flex-1 min-w-[120px]">
              <label className="block text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5">Resolution</label>
              <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-sm focus:ring-2 focus:ring-white/20 [&>option]:bg-zinc-900 cursor-pointer">
                <option value="512">0.5K</option>
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
          )}

          {/* ComfyUI Model Selector */}
          {mode === 'comfyui' && comfyModels.length > 0 && (
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5">Model</label>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-sm focus:ring-2 focus:ring-white/20 [&>option]:bg-zinc-900 cursor-pointer">
                {comfyModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* ComfyUI status badge */}
          {mode === 'comfyui' && (
            <div className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium ${
              comfyAvailable ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${comfyAvailable ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {comfyAvailable ? 'Local GPU Active' : 'Cloud Credits'}
            </div>
          )}

          {/* Style Presets (only for text-to-image) */}
          {mode === 'text-to-image' && (
            <div className="flex gap-2">
              {[
                { label: 'Photo', add: ', photorealistic, raw photograph, natural lighting, 8k' },
                { label: 'Illustration', add: ', vector illustration, flat design, vibrant colors' },
                { label: '3D', add: ', 3D render, octane render, unreal engine 5, ray tracing' },
              ].map((p) => (
                <button key={p.label} onClick={() => setPrompt(prev => prev + p.add)}
                  className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-zinc-400 text-xs font-medium hover:text-white hover:border-white/[0.15] transition-all cursor-pointer">
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim() || (mode === 'image-to-video' && !uploadedImageBytes)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-black text-sm font-bold hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? (videoPolling ? 'Generating video...' : 'Generating...') :
              mode === 'prompt-improver' ? 'Improve Prompt' : 'Generate'}
          </button>
          {loading && (
            <button onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 cursor-pointer">
              <X className="w-4 h-4" /> Stop
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {/* Improved prompt result */}
        {mode === 'prompt-improver' && improvedPrompt && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-amber-400" /> Improved Prompt
              </h3>
              <div className="flex gap-2">
                <button onClick={() => { setPrompt(improvedPrompt); setMode('text-to-image'); }}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                  <ArrowRight className="w-3 h-3" /> Use for Image Gen
                </button>
                <button onClick={() => navigator.clipboard.writeText(improvedPrompt)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                  Copy
                </button>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 text-sm text-zinc-300 leading-relaxed">
              {improvedPrompt}
            </div>
            {result && resultType === 'text' && (
              <details className="text-xs">
                <summary className="text-zinc-600 cursor-pointer hover:text-zinc-400 transition-colors">Show full analysis</summary>
                <pre className="mt-2 bg-white/[0.02] rounded-lg p-3 text-zinc-500 overflow-auto max-h-48">{result}</pre>
              </details>
            )}
          </motion.div>
        )}

        {/* Image result */}
        {result && resultType === 'image' && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
            className="relative rounded-2xl overflow-hidden border border-white/[0.08] group">
            <img src={result} alt="Generated" className="w-full" />
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
              <button onClick={downloadResult}
                className="flex items-center gap-1.5 bg-white text-black px-4 py-2 rounded-lg text-xs font-bold hover:bg-zinc-200 transition-colors cursor-pointer">
                <Download className="w-3.5 h-3.5" /> Download
              </button>
            </div>
          </motion.div>
        )}

        {/* Video result */}
        {result && resultType === 'video' && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl overflow-hidden border border-white/[0.08]">
            <video src={result} controls autoPlay loop className="w-full" />
            <div className="flex justify-end p-3">
              <button onClick={downloadResult}
                className="flex items-center gap-1.5 bg-white text-black px-4 py-2 rounded-lg text-xs font-bold hover:bg-zinc-200 transition-colors cursor-pointer">
                <Download className="w-3.5 h-3.5" /> Download Video
              </button>
            </div>
          </motion.div>
        )}

        {/* Loading state for video */}
        {videoPolling && (
          <div className="flex flex-col items-center py-12">
            <div className="relative">
              <Loader2 className="w-10 h-10 text-white animate-spin" />
              <Film className="w-4 h-4 text-zinc-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-zinc-400 text-sm mt-4">Generating video...</p>
            <p className="text-zinc-700 text-xs mt-1">This can take 30s–2min. Polling every 10s.</p>
            <button onClick={handleStop}
              className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 cursor-pointer">
              Stop
            </button>
          </div>
        )}
      </motion.div>

      {/* History */}
      {generatedImages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Recent Generations</h3>
            <div className="grid grid-cols-4 gap-3">
              {generatedImages.slice(0, 8).map((img: any) => (
                <div key={img.id} className="rounded-xl overflow-hidden border border-white/[0.06] cursor-pointer hover:border-white/[0.12] transition-all group"
                  onClick={() => { setResult(img.url || `data:image/png;base64,${img.base64}`); setResultType('image'); }}>
                  <img src={img.url || `data:image/png;base64,${img.base64}`} alt="" className="w-full aspect-square object-cover" />
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
