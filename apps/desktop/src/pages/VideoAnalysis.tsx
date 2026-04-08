import { useState, useRef } from 'react';
import Markdown from 'react-markdown';
import { getGemini } from '../lib/gemini';
import { Loader2, Upload, Video as VideoIcon, Sparkles, FileText, Clock, Lightbulb } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';

export default function VideoAnalysis() {
  const [prompt, setPrompt] = useState('Analyze this video and extract key themes, target audience, and potential social media hooks.');
  const [video, setVideo] = useState<File | null>(null);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'themes' | 'timestamps' | 'insights'>('themes');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestions = [
    { name: 'Themes & Audience', icon: FileText, promptAdd: 'Extract key themes and target audience.' },
    { name: 'Key Moments', icon: Clock, promptAdd: 'Identify timestamps for key moments.' },
    { name: 'Social Hooks', icon: Lightbulb, promptAdd: 'Suggest social media hooks based on video content.' },
  ];

  const applySuggestion = (suggestionPrompt: string) => {
    if (!prompt.includes(suggestionPrompt)) {
      setPrompt(prev => prev + (prev.trim() ? '\n' : '') + suggestionPrompt);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideo(file);
  };

  const analyzeVideo = async () => {
    if (!video) return;
    setLoading(true);
    setError('');
    setResult('');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const ai = getGemini();
          const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: video.type } },
                { text: prompt + "\n\nCRITICAL INSTRUCTION: You MUST format your response using exactly these three markdown headings: '## Key Themes', '## Timestamps', and '## Insights'. Do not use any other top-level headings." }
              ]
            }
          });
          setResult(response.text || '');
        } catch (err: any) {
          setError(err.message || 'An error occurred during analysis.');
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(video);
      
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  const getSectionContent = (fullText: string, section: 'themes' | 'timestamps' | 'insights') => {
    if (!fullText) return '';
    
    const sections = {
      themes: /##\s*Key Themes[\s\S]*?(?=##\s*(Timestamps|Insights)|$)/i,
      timestamps: /##\s*Timestamps[\s\S]*?(?=##\s*(Key Themes|Insights)|$)/i,
      insights: /##\s*Insights[\s\S]*?(?=##\s*(Key Themes|Timestamps)|$)/i,
    };

    const match = fullText.match(sections[section]);
    
    // If we can't find the specific section, return the full text for the first tab,
    // or a fallback message for the others.
    if (!match) {
      if (section === 'themes') return fullText;
      return `*No specific ${section} section found in the analysis.*`;
    }
    
    // Remove the heading itself from the matched content for cleaner display
    return match[0].replace(/##\s*(Key Themes|Timestamps|Insights)/i, '').trim();
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2"
      >
        <h1 className="text-3xl font-display font-semibold text-white tracking-tight">Video Analysis</h1>
        <p className="text-sm text-zinc-400">
          Extract key themes, timestamps, and insights from video content.
        </p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-900 p-8 rounded-3xl border border-slate-800 space-y-8 relative overflow-hidden shadow-sm"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"></div>
        
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Source Video
            </label>
            <div 
              className={`mt-2 flex justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${video ? 'border-amber-500/50 bg-amber-500/5' : 'border-white/20 hover:border-amber-400/50 hover:bg-white/5'} px-6 py-12 cursor-pointer relative overflow-hidden group`}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="text-center relative z-0">
                {video ? (
                  <div className="flex flex-col items-center">
                    <div className="h-16 w-16 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mb-4 border border-amber-500/30">
                      <VideoIcon className="h-8 w-8" />
                    </div>
                    <span className="text-base font-semibold text-white">{video.name}</span>
                    <span className="text-sm text-zinc-400 mt-1">{(video.size / (1024 * 1024)).toFixed(2)} MB</span>
                    <div className="mt-4 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors">
                      Click to change video
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto h-16 w-16 bg-white/5 text-amber-400 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-white/10">
                      <Upload className="h-8 w-8" aria-hidden="true" />
                    </div>
                    <div className="mt-4 flex text-base leading-6 text-zinc-400 justify-center">
                      <span className="font-semibold text-amber-400 hover:text-amber-300 transition-colors">
                        Click to upload
                      </span>
                      <p className="pl-1">or drag and drop</p>
                    </div>
                    <p className="text-sm leading-5 text-zinc-500 mt-2">MP4, WebM up to 10MB (Demo limit)</p>
                  </>
                )}
                <input id="file-upload" name="file-upload" type="file" className="sr-only" ref={fileInputRef} onChange={handleVideoUpload} accept="video/*" />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="prompt" className="block text-sm font-medium text-zinc-300 mb-3">
              Analysis Prompt
            </label>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl blur opacity-20 group-focus-within:opacity-40 transition duration-500"></div>
              <textarea
                id="prompt"
                rows={3}
                className="relative block w-full rounded-xl border border-white/10 py-4 px-4 text-white shadow-sm placeholder:text-zinc-500 focus:ring-2 focus:ring-inset focus:ring-amber-500 sm:text-base bg-black/40 backdrop-blur-sm transition-all resize-none"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </div>

          {/* Prompt Suggestions */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">Prompt Suggestions</label>
            <div className="flex flex-wrap gap-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.name}
                  onClick={() => applySuggestion(suggestion.promptAdd)}
                  className="inline-flex items-center px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white text-sm font-medium transition-colors border border-white/10 hover:border-white/20"
                >
                  <suggestion.icon className="w-4 h-4 mr-2 text-amber-400" />
                  {suggestion.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={analyzeVideo}
              disabled={loading || !prompt.trim() || !video}
              className="inline-flex items-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-3 text-sm font-bold text-white shadow-lg hover:from-amber-400 hover:to-orange-400 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-5 w-5" />
              )}
              {loading ? 'Analyzing...' : 'Analyze Video'}
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

      {result && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-8 rounded-3xl border border-white/10 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl font-display font-semibold text-white">Analysis Results</h2>
          </div>

          {/* Modern Tabbed Interface */}
          <div className="border-b border-white/10 mb-6">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('themes')}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
                  activeTab === 'themes'
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-zinc-400 hover:border-white/20 hover:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Key Themes
                </div>
              </button>
              <button
                onClick={() => setActiveTab('timestamps')}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
                  activeTab === 'timestamps'
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-zinc-400 hover:border-white/20 hover:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Timestamps
                </div>
              </button>
              <button
                onClick={() => setActiveTab('insights')}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
                  activeTab === 'insights'
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-zinc-400 hover:border-white/20 hover:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  Insights
                </div>
              </button>
            </nav>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="prose prose-invert prose-amber max-w-none prose-p:leading-relaxed"
            >
              <Markdown>{getSectionContent(result, activeTab)}</Markdown>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
