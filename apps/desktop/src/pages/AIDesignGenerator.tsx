import { useState } from 'react';
import { Sparkles, Palette, Type, Image, Layout, Copy, Download, Loader2, ChevronRight, Wand2, Layers, Monitor, Smartphone } from 'lucide-react';
import { generateDesignBrief } from '../lib/gemini';

interface DesignBrief {
  visualDirection: string;
  colorPalette: { name: string; hex: string }[];
  typography: { heading: string; body: string; accent: string };
  layoutDescription: string;
  copy: { headline: string; subheadline: string; body: string; cta: string };
  imagePrompts: string[];
  dimensions: { platform: string; size: string }[];
}

const STATIONS = ['Lebanon', 'Abu Dhabi', 'Investigations', 'Clips'];
const STATION_STYLES: Record<string, { colors: string[]; mood: string }> = {
  'Lebanon': { colors: ['#1E3A5F', '#C5A55A', '#FFFFFF'], mood: 'Elegant, Mediterranean, cultural heritage' },
  'Abu Dhabi': { colors: ['#0A1628', '#D4AF37', '#E8E8E8'], mood: 'Luxurious, modern, Arabian sophistication' },
  'Investigations': { colors: ['#1A1A2E', '#E94560', '#0F3460'], mood: 'Bold, dramatic, investigative journalism' },
  'Clips': { colors: ['#FF6B6B', '#4ECDC4', '#1A1A2E'], mood: 'Dynamic, youthful, social-first' },
};

export default function AIDesignGenerator() {
  const [step, setStep] = useState(1);
  const [station, setStation] = useState('Lebanon');
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<DesignBrief | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    try {
      const result = await generateDesignBrief(topic, context, station, STATION_STYLES[station]);
      setBrief(result);
      setStep(4);
    } catch (err) {
      // Fallback mock brief
      setBrief({
        visualDirection: `A ${STATION_STYLES[station].mood.toLowerCase()} visual approach featuring bold typography against ${station === 'Abu Dhabi' ? 'gold and dark' : 'rich, vibrant'} backgrounds. The composition should feel premium and editorial.`,
        colorPalette: STATION_STYLES[station].colors.map((hex, i) => ({ name: ['Primary', 'Secondary', 'Accent'][i] || `Color ${i}`, hex })),
        typography: { heading: 'Playfair Display', body: 'Inter', accent: 'Space Grotesk' },
        layoutDescription: 'Asymmetric grid layout with hero image taking 60% of the canvas. Text elements aligned left with generous white space.',
        copy: { headline: `Discover ${topic}`, subheadline: 'A new perspective on what matters', body: `Explore the latest insights and stories about ${topic}. Curated by the ${station} team.`, cta: 'Learn More →' },
        imagePrompts: [
          `Professional editorial photograph related to ${topic}, ${STATION_STYLES[station].mood}, dramatic lighting, magazine quality`,
          `Abstract texture background, ${STATION_STYLES[station].mood}, dark and sophisticated, 4K resolution`,
        ],
        dimensions: [
          { platform: 'Instagram Post', size: '1080x1080' },
          { platform: 'Instagram Story', size: '1080x1920' },
          { platform: 'LinkedIn', size: '1200x627' },
          { platform: 'X/Twitter', size: '1600x900' },
          { platform: 'Reel Cover', size: '1080x1920' },
        ],
      });
      setStep(4);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">AI Design Generator</h1>
        <p className="text-zinc-500 mt-1">Generate complete design concepts from topics — the magic tab ✨</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8">
        {[{ n: 1, label: 'Station' }, { n: 2, label: 'Topic' }, { n: 3, label: 'Generate' }, { n: 4, label: 'Preview' }].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <button onClick={() => s.n <= step && setStep(s.n)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${step >= s.n ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-zinc-600 bg-white/5 border border-white/10'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step >= s.n ? 'bg-violet-500 text-white' : 'bg-white/10 text-zinc-500'}`}>{s.n}</span>
              {s.label}
            </button>
            {i < 3 && <ChevronRight className="h-3 w-3 text-zinc-700" />}
          </div>
        ))}
      </div>

      {/* Step 1: Station */}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          {STATIONS.map(s => (
            <button key={s} onClick={() => { setStation(s); setStep(2); }}
              className={`p-6 rounded-xl border text-left transition-all hover:scale-[1.02] ${station === s ? 'bg-violet-500/10 border-violet-500/30' : 'bg-[#111] border-white/10 hover:border-white/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-1">
                  {STATION_STYLES[s].colors.map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <h3 className="text-white font-semibold text-lg">{s}</h3>
              <p className="text-zinc-500 text-xs mt-1">{STATION_STYLES[s].mood}</p>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Topic */}
      {step === 2 && (
        <div className="max-w-2xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Topic / Subject</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Ramadan Campaign, Q3 Product Launch, Breaking Investigation"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Additional Context (optional)</label>
            <textarea value={context} onChange={e => setContext(e.target.value)} rows={4} placeholder="Target audience, brand guidelines, key messages, specific requirements..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="px-4 py-2.5 text-zinc-400 hover:text-white transition-colors">Back</button>
            <button onClick={() => { if (topic.trim()) setStep(3); }}
              className="flex items-center gap-2 bg-violet-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-violet-500 disabled:opacity-50 transition-colors">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generate */}
      {step === 3 && (
        <div className="max-w-2xl">
          <div className="bg-[#111] border border-white/10 rounded-xl p-6 mb-6">
            <h3 className="text-white font-semibold mb-3">Generation Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">Station:</span><span className="text-violet-400 font-medium">{station}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Topic:</span><span className="text-white">{topic}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Style:</span><span className="text-zinc-300">{STATION_STYLES[station].mood}</span></div>
              <div className="flex gap-2 justify-end mt-2">
                {STATION_STYLES[station].colors.map((c, i) => (
                  <div key={i} className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="px-4 py-2.5 text-zinc-400 hover:text-white transition-colors">Back</button>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-8 py-3 rounded-xl text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/20">
              {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</> : <><Wand2 className="h-4 w-4" /> Generate Design Brief</>}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && brief && (
        <div className="space-y-6 max-w-4xl">
          {/* Visual Direction */}
          <div className="bg-[#111] border border-white/10 rounded-xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-3"><Image className="h-4 w-4 text-violet-400" /> Visual Direction</h3>
            <p className="text-zinc-300 text-sm leading-relaxed">{brief.visualDirection}</p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Color Palette */}
            <div className="bg-[#111] border border-white/10 rounded-xl p-6">
              <h3 className="text-white font-semibold flex items-center gap-2 mb-4"><Palette className="h-4 w-4 text-violet-400" /> Color Palette</h3>
              <div className="space-y-2">
                {brief.colorPalette.map((c, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg border border-white/10" style={{ backgroundColor: c.hex }} />
                    <div>
                      <div className="text-white text-sm font-medium">{c.name}</div>
                      <div className="text-zinc-500 text-xs font-mono">{c.hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Typography */}
            <div className="bg-[#111] border border-white/10 rounded-xl p-6">
              <h3 className="text-white font-semibold flex items-center gap-2 mb-4"><Type className="h-4 w-4 text-violet-400" /> Typography</h3>
              <div className="space-y-3">
                <div><span className="text-zinc-500 text-xs">Heading:</span><div className="text-white text-lg font-bold">{brief.typography.heading}</div></div>
                <div><span className="text-zinc-500 text-xs">Body:</span><div className="text-zinc-300">{brief.typography.body}</div></div>
                <div><span className="text-zinc-500 text-xs">Accent:</span><div className="text-violet-400">{brief.typography.accent}</div></div>
              </div>
            </div>
          </div>

          {/* Copy */}
          <div className="bg-[#111] border border-white/10 rounded-xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-4"><Copy className="h-4 w-4 text-violet-400" /> Copy</h3>
            <div className="space-y-3">
              <div className="text-2xl font-bold text-white">{brief.copy.headline}</div>
              <div className="text-lg text-zinc-400">{brief.copy.subheadline}</div>
              <div className="text-sm text-zinc-300 leading-relaxed">{brief.copy.body}</div>
              <div className="inline-block bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{brief.copy.cta}</div>
            </div>
          </div>

          {/* Dimensions */}
          <div className="bg-[#111] border border-white/10 rounded-xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-4"><Monitor className="h-4 w-4 text-violet-400" /> Platform Dimensions</h3>
            <div className="grid grid-cols-5 gap-3">
              {brief.dimensions.map((d, i) => (
                <div key={i} className="bg-white/5 rounded-lg p-3 text-center">
                  <Smartphone className="h-5 w-5 text-zinc-500 mx-auto mb-1" />
                  <div className="text-xs font-medium text-white">{d.platform}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{d.size}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Image Prompts */}
          <div className="bg-[#111] border border-white/10 rounded-xl p-6">
            <h3 className="text-white font-semibold flex items-center gap-2 mb-4"><Sparkles className="h-4 w-4 text-violet-400" /> Image Prompts</h3>
            <div className="space-y-2">
              {brief.imagePrompts.map((p, i) => (
                <div key={i} className="bg-white/5 border border-white/5 rounded-lg p-3 text-sm text-zinc-300">{p}</div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setBrief(null); setStep(1); }}
              className="px-4 py-2.5 text-zinc-400 hover:text-white transition-colors">Start Over</button>
            <button className="flex items-center gap-2 bg-violet-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-violet-500 transition-colors">
              <Download className="h-4 w-4" /> Export Brief
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
