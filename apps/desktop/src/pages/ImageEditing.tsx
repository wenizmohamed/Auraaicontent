import { useState, useRef } from 'react';
import { getGemini } from '../lib/gemini';
import { Loader2, Upload, Download, Sparkles, Wand2, Eraser, Type, Paintbrush } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';

export default function ImageEditing() {
  // Guard: client-side AI keys removed for security — needs server-side routing
  return (
    <div className="max-w-2xl mx-auto mt-20 text-center">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8">
        <Wand2 className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Image Editing</h2>
        <p className="text-zinc-400 mb-2">Server-side AI routing in progress.</p>
        <p className="text-zinc-500 text-sm">This feature will use the backend AI provider router once migration is complete.</p>
      </div>
    </div>
  );

  const [prompt, setPrompt] = useState('Add a retro filter');
  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quickActions = [
    { name: 'Remove BG', icon: Eraser, prompt: 'Remove the background and make it transparent' },
    { name: 'Enhance', icon: Wand2, prompt: 'Enhance the image quality, improve lighting and colors' },
    { name: 'Recolor', icon: Paintbrush, prompt: 'Change the primary colors to match a corporate blue and gold palette' },
    { name: 'Add Text Space', icon: Type, prompt: 'Extend the image to the right to create negative space for text' },
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMimeType(file.type);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result as string);
      setResult(''); // Clear previous result when new image is uploaded
    };
    reader.readAsDataURL(file);
  };

  const applyQuickAction = (actionPrompt: string) => {
    setPrompt(actionPrompt);
  };

  const editImage = async () => {
    if (!image) return;
    setLoading(true);
    setError('');
    setResult('');
    
    try {
      const base64Data = image.split(',')[1];
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: prompt }
          ]
        }
      });

      let base64Image = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = part.inlineData.data;
          break;
        }
      }

      if (base64Image) {
        setResult(`data:image/png;base64,${base64Image}`);
      } else {
        throw new Error('No image returned from model');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2"
      >
        <h1 className="text-3xl font-display font-semibold text-white tracking-tight">Image Editing</h1>
        <p className="text-sm text-zinc-400">
          Edit existing images with text prompts using Gemini 2.5 Flash Image.
        </p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-900 p-8 rounded-3xl border border-slate-800 space-y-8 relative overflow-hidden shadow-sm"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500"></div>
        
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Source Image
            </label>
            <div 
              className={`mt-2 flex justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${image ? 'border-violet-500/50 bg-violet-500/5' : 'border-white/20 hover:border-violet-400/50 hover:bg-white/5'} px-6 py-12`}
              onClick={() => fileInputRef.current?.click()}
              style={{ cursor: 'pointer' }}
            >
              <div className="text-center">
                {image ? (
                  <div className="relative inline-block">
                    <img src={image} alt="Source" className="mx-auto h-48 object-contain rounded-xl shadow-lg" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center backdrop-blur-sm">
                      <span className="text-white font-medium bg-white/10 px-4 py-2 rounded-lg border border-white/20">Change Image</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/10">
                      <Upload className="h-8 w-8 text-violet-400" aria-hidden="true" />
                    </div>
                    <div className="mt-4 flex text-sm leading-6 text-zinc-400 justify-center">
                      <span className="relative cursor-pointer rounded-md font-semibold text-violet-400 focus-within:outline-none hover:text-violet-300 transition-colors">
                        <span>Click to upload</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" />
                      </span>
                      <p className="pl-1">or drag and drop</p>
                    </div>
                    <p className="text-xs leading-5 text-zinc-500 mt-2">PNG, JPG, GIF up to 10MB</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Quick Actions
            </label>
            <div className="flex flex-wrap gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.name}
                  onClick={() => applyQuickAction(action.prompt)}
                  className="inline-flex items-center px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all shadow-sm"
                >
                  <action.icon className="w-4 h-4 mr-2 text-violet-400" />
                  {action.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="prompt" className="block text-sm font-medium text-zinc-300 mb-3">
              Edit Prompt
            </label>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl blur opacity-20 group-focus-within:opacity-40 transition duration-500"></div>
              <input
                type="text"
                id="prompt"
                className="relative block w-full rounded-xl border border-white/10 py-4 px-4 text-white shadow-sm placeholder:text-zinc-500 focus:ring-2 focus:ring-inset focus:ring-violet-500 sm:text-base sm:leading-relaxed bg-black/40 backdrop-blur-sm transition-all"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Add a retro filter, Remove the background"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={editImage}
              disabled={loading || !prompt.trim() || !image}
              className="inline-flex items-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-3 text-sm font-bold text-white shadow-lg hover:from-violet-400 hover:to-fuchsia-400 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-5 w-5" />
              )}
              {loading ? 'Processing...' : 'Apply Edit'}
            </button>
          </div>
        </div>
      </motion.div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4"
        >
          <div className="text-sm text-red-400 font-medium">{error}</div>
        </motion.div>
      )}

      {(image || result) && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 p-8 rounded-3xl border border-slate-800 relative overflow-hidden shadow-sm"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500" />
          
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-display font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-400" />
              Comparison View
            </h2>
            {result && (
              <a
                href={result}
                download="edited-image.png"
                className="inline-flex items-center px-4 py-2 rounded-xl bg-white/10 text-sm font-medium text-white hover:bg-white/20 transition-colors border border-white/5"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Result
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Original Image */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider text-center">Original</h3>
              <div className="bg-black/40 rounded-2xl p-4 border border-white/5 flex items-center justify-center min-h-[300px]">
                {image ? (
                  <img src={image} alt="Original" className="max-w-full h-auto rounded-xl shadow-lg object-contain max-h-[400px]" />
                ) : (
                  <span className="text-zinc-500">No image uploaded</span>
                )}
              </div>
            </div>

            {/* Edited Image */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-violet-400 uppercase tracking-wider text-center">Edited Result</h3>
              <div className="bg-violet-500/5 rounded-2xl p-4 border border-violet-500/20 flex items-center justify-center min-h-[300px] relative">
                {loading ? (
                  <div className="flex flex-col items-center text-violet-400">
                    <Loader2 className="h-8 w-8 animate-spin mb-2" />
                    <span className="text-sm font-medium">Applying AI magic...</span>
                  </div>
                ) : result ? (
                  <img src={result} alt="Edited" className="max-w-full h-auto rounded-xl shadow-lg object-contain max-h-[400px]" />
                ) : (
                  <span className="text-zinc-500">Awaiting edit...</span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
