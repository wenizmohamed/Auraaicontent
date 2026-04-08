import { useState, useEffect } from 'react';
import { Palette, Plus, X, Image, Link as LinkIcon, Tag, Filter, Paintbrush, Layers, Eye, Grid, ExternalLink } from 'lucide-react';

interface Texture {
  id: string;
  name: string;
  imageUrl: string;
  tags: string[];
  station: string;
  category: 'gradient' | 'pattern' | 'overlay' | 'palette' | 'photo';
  linkedTopics: string[];
  createdAt: string;
}

interface MoodBoard {
  id: string;
  name: string;
  topicId: string;
  items: { type: 'image' | 'color' | 'text'; value: string }[];
  station: string;
  createdAt: string;
}

interface DesignSource {
  id: string;
  name: string;
  url: string;
  platform: string;
  tags: string[];
  station: string;
}

const STATIONS = ['All', 'Lebanon', 'Abu Dhabi', 'Investigations', 'Clips'];
const CATEGORIES = ['All', 'gradient', 'pattern', 'overlay', 'palette', 'photo'];

const SEED_TEXTURES: Texture[] = [
  { id: '1', name: 'Deep Ocean Gradient', imageUrl: 'https://picsum.photos/seed/tex1/400/300', tags: ['dark', 'ocean', 'blue'], station: 'Lebanon', category: 'gradient', linkedTopics: [], createdAt: new Date().toISOString() },
  { id: '2', name: 'Sand Dunes Pattern', imageUrl: 'https://picsum.photos/seed/tex2/400/300', tags: ['warm', 'desert', 'gold'], station: 'Abu Dhabi', category: 'pattern', linkedTopics: [], createdAt: new Date().toISOString() },
  { id: '3', name: 'Neon Grid Overlay', imageUrl: 'https://picsum.photos/seed/tex3/400/300', tags: ['neon', 'tech', 'purple'], station: 'Investigations', category: 'overlay', linkedTopics: [], createdAt: new Date().toISOString() },
  { id: '4', name: 'Minimal White Texture', imageUrl: 'https://picsum.photos/seed/tex4/400/300', tags: ['clean', 'minimal', 'white'], station: 'Clips', category: 'photo', linkedTopics: [], createdAt: new Date().toISOString() },
  { id: '5', name: 'Sunset Palette', imageUrl: 'https://picsum.photos/seed/tex5/400/300', tags: ['warm', 'sunset', 'orange'], station: 'Lebanon', category: 'palette', linkedTopics: [], createdAt: new Date().toISOString() },
  { id: '6', name: 'Urban Concrete', imageUrl: 'https://picsum.photos/seed/tex6/400/300', tags: ['urban', 'rough', 'gray'], station: 'Abu Dhabi', category: 'photo', linkedTopics: [], createdAt: new Date().toISOString() },
];

const SEED_SOURCES: DesignSource[] = [
  { id: '1', name: 'Dribbble Inspiration', url: 'https://dribbble.com', platform: 'Dribbble', tags: ['ui', 'branding'], station: 'All' },
  { id: '2', name: 'Behance Collection', url: 'https://behance.net', platform: 'Behance', tags: ['editorial', 'print'], station: 'All' },
  { id: '3', name: 'Pinterest Brand Board', url: 'https://pinterest.com', platform: 'Pinterest', tags: ['mood', 'lifestyle'], station: 'Lebanon' },
];

function getTextures(): Texture[] {
  const stored = localStorage.getItem('radix_textures');
  return stored ? JSON.parse(stored) : SEED_TEXTURES;
}
function saveTextures(t: Texture[]) { localStorage.setItem('radix_textures', JSON.stringify(t)); }
function getSources(): DesignSource[] {
  const stored = localStorage.getItem('radix_design_sources');
  return stored ? JSON.parse(stored) : SEED_SOURCES;
}
function saveSources(s: DesignSource[]) { localStorage.setItem('radix_design_sources', JSON.stringify(s)); }

export default function DesignTextures() {
  const [textures, setTextures] = useState<Texture[]>(getTextures);
  const [sources, setSources] = useState<DesignSource[]>(getSources);
  const [station, setStation] = useState('All');
  const [category, setCategory] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<'textures' | 'sources' | 'mood'>('textures');
  const [preview, setPreview] = useState<Texture | null>(null);
  const [form, setForm] = useState({ name: '', imageUrl: '', tags: '', station: 'Lebanon', category: 'photo' as Texture['category'] });

  useEffect(() => { saveTextures(textures); }, [textures]);
  useEffect(() => { saveSources(sources); }, [sources]);

  const filtered = textures.filter(t => {
    if (station !== 'All' && t.station !== station) return false;
    if (category !== 'All' && t.category !== category) return false;
    return true;
  });

  const handleAdd = () => {
    if (!form.name || !form.imageUrl) return;
    const newTex: Texture = {
      id: crypto.randomUUID(),
      name: form.name,
      imageUrl: form.imageUrl,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      station: form.station,
      category: form.category,
      linkedTopics: [],
      createdAt: new Date().toISOString(),
    };
    setTextures(prev => [newTex, ...prev]);
    setForm({ name: '', imageUrl: '', tags: '', station: 'Lebanon', category: 'photo' });
    setShowAdd(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Design Textures & Sources</h1>
          <p className="text-zinc-500 mt-1">Manage design direction, mood boards, and visual source material</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-violet-500 transition-colors">
          <Plus className="h-4 w-4" /> Add Texture
        </button>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 mb-6">
        {(['textures', 'sources', 'mood'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
            {t === 'textures' ? '🎨 Textures' : t === 'sources' ? '🔗 Sources' : '📋 Mood Boards'}
          </button>
        ))}
      </div>

      {/* Filters */}
      {tab === 'textures' && (
        <div className="flex gap-3 mb-6">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
            <Filter className="h-3.5 w-3.5 text-zinc-500" />
            {STATIONS.map(s => (
              <button key={s} onClick={() => setStation(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${station === s ? 'bg-violet-500/20 text-violet-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
            <Layers className="h-3.5 w-3.5 text-zinc-500" />
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize ${category === c ? 'bg-violet-500/20 text-violet-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Textures Grid */}
      {tab === 'textures' && (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {filtered.map(tex => (
            <div key={tex.id} className="break-inside-avoid bg-[#111] border border-white/10 rounded-xl overflow-hidden group cursor-pointer" onClick={() => setPreview(tex)}>
              <div className="relative">
                <img src={tex.imageUrl} alt={tex.name} className="w-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button className="p-2 bg-violet-500 rounded-lg text-white text-xs font-medium"><Eye className="h-4 w-4" /></button>
                  <button onClick={e => { e.stopPropagation(); setTextures(prev => prev.filter(t => t.id !== tex.id)); }}
                    className="p-2 bg-red-500/80 rounded-lg text-white text-xs font-medium"><X className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="p-3">
                <h3 className="text-sm font-medium text-white truncate">{tex.name}</h3>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full font-medium">{tex.station}</span>
                  <span className="text-[10px] bg-white/10 text-zinc-400 px-1.5 py-0.5 rounded-full capitalize">{tex.category}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {tex.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="text-[9px] text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-16">
              <Palette className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500">No textures found</p>
            </div>
          )}
        </div>
      )}

      {/* Sources */}
      {tab === 'sources' && (
        <div className="space-y-3">
          {sources.map(src => (
            <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-4 bg-[#111] border border-white/10 rounded-xl p-4 hover:bg-white/5 transition-colors group">
              <div className="w-10 h-10 bg-violet-500/20 rounded-lg flex items-center justify-center">
                <LinkIcon className="h-5 w-5 text-violet-400" />
              </div>
              <div className="flex-1">
                <div className="text-white font-medium">{src.name}</div>
                <div className="text-xs text-zinc-500">{src.platform} · {src.url}</div>
              </div>
              <div className="flex gap-1.5">
                {src.tags.map((t, i) => (
                  <span key={i} className="text-[10px] bg-white/10 text-zinc-400 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
              <ExternalLink className="h-4 w-4 text-zinc-600 group-hover:text-violet-400 transition-colors" />
            </a>
          ))}
        </div>
      )}

      {/* Mood Boards Placeholder */}
      {tab === 'mood' && (
        <div className="text-center py-20 bg-[#111] border border-white/10 rounded-xl">
          <Paintbrush className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-lg font-medium">Mood Board Builder</p>
          <p className="text-zinc-600 text-sm mt-1">Select a topic from Topic Desk to start building mood boards</p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Add Texture</h2>
              <button onClick={() => setShowAdd(false)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Texture name"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="Image URL"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Tags (comma separated)"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.station} onChange={e => setForm({ ...form, station: e.target.value })}
                  className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                  {STATIONS.slice(1).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Texture['category'] })}
                  className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                  {CATEGORIES.slice(1).map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </div>
              <button onClick={handleAdd} className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-500 transition-colors">
                Add to Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="max-w-2xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <img src={preview.imageUrl} alt={preview.name} className="w-full rounded-2xl" />
            <div className="mt-4 text-center">
              <h3 className="text-white text-lg font-semibold">{preview.name}</h3>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-xs bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded-full">{preview.station}</span>
                <span className="text-xs bg-white/10 text-zinc-400 px-2 py-0.5 rounded-full capitalize">{preview.category}</span>
                {preview.tags.map((t, i) => <span key={i} className="text-xs bg-white/5 text-zinc-500 px-2 py-0.5 rounded-full">{t}</span>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
