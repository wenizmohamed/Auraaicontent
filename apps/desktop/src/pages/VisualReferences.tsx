import { useState, useEffect } from 'react';
import { Image, Link as LinkIcon, Tag, FolderOpen, Plus, Search, Download, Pin, Eye, X, ExternalLink, Filter } from 'lucide-react';
import { visualRefsApi } from '../lib/backend-api';
import { useToast } from '../lib/toast-context';
import { Image as LazyImage } from '../components/ui/Image';

interface VisualRef {
  id: string;
  imageUrl: string;
  sourceUrl: string;
  tags: string[];
  collection: string;
  station: string;
  topicId: string;
  uploadedBy: string;
  createdAt: string;
}

const STATIONS = ['All', 'Lebanon', 'Abu Dhabi', 'Investigations', 'Clips'];

const SEED_REFS: VisualRef[] = [
  { id: '1', imageUrl: 'https://picsum.photos/seed/ref1/600/400', sourceUrl: 'https://dribbble.com/shots/example1', tags: ['editorial', 'dark', 'luxury'], collection: 'Brand Identity', station: 'Abu Dhabi', topicId: '', uploadedBy: 'Sarah J.', createdAt: new Date().toISOString() },
  { id: '2', imageUrl: 'https://picsum.photos/seed/ref2/400/600', sourceUrl: 'https://behance.net/gallery/example2', tags: ['vibrant', 'social', 'youth'], collection: 'Social Media', station: 'Clips', topicId: '', uploadedBy: 'Radix Team', createdAt: new Date().toISOString() },
  { id: '3', imageUrl: 'https://picsum.photos/seed/ref3/500/400', sourceUrl: 'https://pinterest.com/pin/example3', tags: ['investigative', 'bold', 'red'], collection: 'News Graphics', station: 'Investigations', topicId: '', uploadedBy: 'Elena R.', createdAt: new Date().toISOString() },
  { id: '4', imageUrl: 'https://picsum.photos/seed/ref4/600/500', sourceUrl: 'https://unsplash.com/photos/example4', tags: ['landscape', 'mediterranean', 'warm'], collection: 'Brand Identity', station: 'Lebanon', topicId: '', uploadedBy: 'Sarah J.', createdAt: new Date().toISOString() },
  { id: '5', imageUrl: 'https://picsum.photos/seed/ref5/400/400', sourceUrl: 'https://dribbble.com/shots/example5', tags: ['minimal', 'clean', 'typography'], collection: 'Social Media', station: 'All', topicId: '', uploadedBy: 'Radix Team', createdAt: new Date().toISOString() },
  { id: '6', imageUrl: 'https://picsum.photos/seed/ref6/500/700', sourceUrl: 'https://behance.net/gallery/example6', tags: ['gradient', 'abstract', 'dark'], collection: 'News Graphics', station: 'Investigations', topicId: '', uploadedBy: 'Elena R.', createdAt: new Date().toISOString() },
];

function getRefs(): VisualRef[] {
  const stored = localStorage.getItem('radix_visual_refs');
  return stored ? JSON.parse(stored) : SEED_REFS;
}
function saveRefs(r: VisualRef[]) { localStorage.setItem('radix_visual_refs', JSON.stringify(r)); }

export default function VisualReferences() {
  const [refs, setRefs] = useState<VisualRef[]>(getRefs);
  const [station, setStation] = useState('All');
  const [collection, setCollection] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VisualRef | null>(null);
  const [form, setForm] = useState({ imageUrl: '', sourceUrl: '', tags: '', collection: 'General', station: 'All' });

  useEffect(() => { saveRefs(refs); }, [refs]);

  const collections = ['All', ...Array.from(new Set(refs.map(r => r.collection)))];

  const filtered = refs.filter(r => {
    if (station !== 'All' && r.station !== station) return false;
    if (collection !== 'All' && r.collection !== collection) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return r.tags.some(t => t.toLowerCase().includes(q)) || r.collection.toLowerCase().includes(q);
    }
    return true;
  });

  const handleAdd = () => {
    if (!form.imageUrl || !form.sourceUrl) return;
    const newRef: VisualRef = {
      id: crypto.randomUUID(),
      imageUrl: form.imageUrl,
      sourceUrl: form.sourceUrl,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      collection: form.collection || 'General',
      station: form.station,
      topicId: '',
      uploadedBy: 'User',
      createdAt: new Date().toISOString(),
    };
    setRefs(prev => [newRef, ...prev]);
    setForm({ imageUrl: '', sourceUrl: '', tags: '', collection: 'General', station: 'All' });
    setShowAdd(false);
  };

  const { success: toastOk, error: toastErr } = useToast();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this visual reference?')) return;
    try {
      await visualRefsApi.delete(id);
      toastOk('Reference deleted');
    } catch (err: any) {
      toastErr(err?.message || 'Delete failed');
      return;
    }
    setRefs(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Library</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold" style={{ color: 'var(--color-fg)' }}>Visual References</h1>
          <p className="text-zinc-500 mt-1">Central image library. Every reference needs a source URL</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity" style={{ background: 'var(--color-info)' }}>
          <Plus className="h-4 w-4" /> Import Reference
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tags, collections..."
            className="w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-[color:var(--color-info)] focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          {STATIONS.map(s => (
            <button key={s} onClick={() => setStation(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${station === s ? '' : 'text-zinc-500 hover:text-zinc-300'}`}
              style={station === s ? { background: 'var(--color-info-subtle)', color: 'var(--color-info)' } : undefined}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1">
          <FolderOpen className="h-3.5 w-3.5 text-zinc-500" />
          {collections.map(c => (
            <button key={c} onClick={() => setCollection(c)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${collection === c ? '' : 'text-zinc-500 hover:text-zinc-300'}`}
              style={collection === c ? { background: 'var(--color-info-subtle)', color: 'var(--color-info)' } : undefined}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-6 text-xs text-zinc-500">
        <span>{filtered.length} references</span>
        <span>·</span>
        <span>{collections.length - 1} collections</span>
      </div>

      {/* Masonry Grid */}
      {filtered.length > 0 ? (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {filtered.map(ref => (
            <div key={ref.id} className="break-inside-avoid bg-[#111] border border-white/10 rounded-xl overflow-hidden group shadow-sm">
              <div className="relative cursor-pointer" onClick={() => setPreview(ref)}>
                <LazyImage
                  src={ref.imageUrl}
                  alt="reference"
                  className="w-full"
                  style={{ aspectRatio: '4 / 3' }}
                  onError={(e: any) => { (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/fallback/400/300'; }}
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button className="p-2 rounded-lg text-white" style={{ background: 'var(--color-info)' }}><Eye className="h-4 w-4" /></button>
                  <a href={ref.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    className="p-2 bg-white/20 rounded-lg text-white hover:bg-white/30"><ExternalLink className="h-4 w-4" /></a>
                  <button onClick={e => { e.stopPropagation(); handleDelete(ref.id); }}
                    className="p-2 rounded-lg text-white" style={{ background: 'var(--color-danger)' }}><X className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="p-3">
                <a href={ref.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] hover:opacity-80 truncate mb-2" style={{ color: 'var(--color-info)' }}>
                  <LinkIcon className="h-3 w-3 shrink-0" />
                  {ref.sourceUrl}
                </a>
                <div className="flex flex-wrap gap-1 mb-2">
                  {ref.tags.map((tag, i) => (
                    <span key={i} className="text-[9px] text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>{ref.station}</span>
                  <span className="text-[10px] text-zinc-600">{ref.collection}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : refs.length === 0 ? (
        <div className="text-center py-20 bg-[#111] border border-white/10 rounded-xl">
          <Image className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400">No visual references found</p>
          <p className="text-zinc-600 text-sm mt-1">Import references to get started</p>
        </div>
      ) : (
        <div className="text-center py-20 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--color-surface-hover)' }}>
            <Search className="h-6 w-6" style={{ color: 'var(--color-fg-subtle)' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--color-fg)' }}>No references match</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>Try a different station, collection, or search term.</p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Import Visual Reference</h2>
              <button onClick={() => setShowAdd(false)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Image URL *</label>
                <input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://example.com/image.jpg"
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-[color:var(--color-info)] focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Source URL * (mandatory)</label>
                <input value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://dribbble.com/shots/..."
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-[color:var(--color-info)] focus:border-transparent" />
              </div>
              <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Tags (comma separated): dark, luxury, editorial"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-[color:var(--color-info)] focus:border-transparent" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.collection} onChange={e => setForm({ ...form, collection: e.target.value })} placeholder="Collection name"
                  className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-[color:var(--color-info)] focus:border-transparent" />
                <select value={form.station} onChange={e => setForm({ ...form, station: e.target.value })}
                  className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                  {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {form.imageUrl && (
                <div className="bg-white/5 rounded-lg p-2">
                  <img src={form.imageUrl} alt="Preview" className="w-full max-h-32 object-contain rounded"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              )}
              <button onClick={handleAdd} disabled={!form.imageUrl || !form.sourceUrl}
                className="w-full text-white py-2.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity" style={{ background: 'var(--color-info)' }}>
                Add to Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute top-6 right-6 text-white/50 hover:text-white"><X className="h-6 w-6" /></button>
          <div className="max-w-4xl max-h-[85vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <img src={preview.imageUrl} alt="reference" className="max-h-[65vh] object-contain rounded-xl" />
            <div className="mt-4 text-center">
              <a href={preview.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 hover:opacity-80 text-sm font-medium" style={{ color: 'var(--color-info)' }}>
                <ExternalLink className="h-4 w-4" /> {preview.sourceUrl}
              </a>
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>{preview.station}</span>
                <span className="text-xs bg-white/10 text-zinc-400 px-2 py-0.5 rounded-full">{preview.collection}</span>
                {preview.tags.map((t, i) => <span key={i} className="text-xs bg-white/5 text-zinc-500 px-2 py-0.5 rounded-full">{t}</span>)}
              </div>
              <div className="text-xs text-zinc-600 mt-2">Uploaded by {preview.uploadedBy}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
