import { useState } from 'react';
import { Search, Loader2, ExternalLink, Image, Check, Sparkles, Pin, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchVisualReferences, type VisualReference, type AIProvider } from '../lib/ai';

interface VisualRefSearchProps {
  visualIdea: string;
  provider?: AIProvider;
  onSelect?: (ref: VisualReference) => void;
  onSelectMultiple?: (refs: VisualReference[]) => void;
  compact?: boolean;
}

export default function VisualRefSearch({ visualIdea, provider = 'gemini', onSelect, onSelectMultiple, compact }: VisualRefSearchProps) {
  const [query, setQuery] = useState(visualIdea || '');
  const [results, setResults] = useState<VisualReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [previewRef, setPreviewRef] = useState<VisualReference | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const refs = await searchVisualReferences(query, provider);
      setResults(refs);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (ref: VisualReference) => {
    const next = new Set(selected);
    if (next.has(ref.id)) next.delete(ref.id);
    else next.add(ref.id);
    setSelected(next);
  };

  const handleConfirmSelection = () => {
    const selectedRefs = results.filter(r => selected.has(r.id));
    onSelectMultiple?.(selectedRefs);
  };

  const SOURCE_COLORS: Record<string, string> = {
    Unsplash: 'bg-white/10 text-white',
    Pinterest: 'bg-red-500/20 text-red-400',
    Behance: 'bg-blue-500/20 text-blue-400',
    Wikimedia: 'bg-emerald-500/20 text-emerald-400',
  };

  return (
    <div className={compact ? '' : 'space-y-4'}>
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Image className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Describe the visual you need, e.g. 'person using app Dubai split screen family'"
            className="w-full pl-10 pr-3 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-fg-subtle focus:ring-2 focus:ring-accent focus:border-transparent"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-accent-pressed to-accent hover:from-accent hover:to-accent-hover text-fg-on-accent rounded-xl text-sm font-medium transition-all disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Find References
        </button>
      </div>

      {error && (
        <div className="text-danger text-xs bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-fg-subtle">{results.length} references from Wikimedia Commons</span>
            {selected.size > 0 && onSelectMultiple && (
              <button
                onClick={handleConfirmSelection}
                className="flex items-center gap-1.5 text-xs bg-success/20 text-success hover:bg-success/30 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Check className="w-3 h-3" /> Use {selected.size} selected
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <AnimatePresence>
              {results.map((ref, i) => (
                <motion.div
                  key={ref.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className={`relative group rounded-xl overflow-hidden border transition-all cursor-pointer ${
                    selected.has(ref.id)
                      ? 'border-accent ring-2 ring-accent/30'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  {/* Image */}
                  <div className="aspect-[4/3] bg-surface relative">
                    <img
                      src={ref.imageUrl}
                      alt={ref.description}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={e => {
                        (e.target as HTMLImageElement).src = `https://placehold.co/800x600/1a1a2e/a78bfa?text=${encodeURIComponent(ref.description.slice(0, 20))}`;
                      }}
                    />

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        {onSelect && (
                          <button
                            onClick={e => { e.stopPropagation(); onSelect(ref); }}
                            className="flex items-center gap-1 text-[10px] bg-accent text-fg-on-accent px-2 py-1 rounded-md font-medium hover:bg-accent-hover transition-colors"
                          >
                            <Pin className="w-3 h-3" /> Use This
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); setPreviewRef(ref); }}
                          className="flex items-center gap-1 text-[10px] bg-white/20 text-white px-2 py-1 rounded-md font-medium hover:bg-white/30 transition-colors"
                        >
                          <Search className="w-3 h-3" /> Preview
                        </button>
                        <a
                          href={ref.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] bg-white/20 text-white px-2 py-1 rounded-md font-medium hover:bg-white/30 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" /> Source
                        </a>
                        {(ref as any).pinterestUrl && (
                          <a
                            href={(ref as any).pinterestUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 text-[10px] bg-red-500/30 text-red-300 px-2 py-1 rounded-md font-medium hover:bg-red-500/40 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Pinterest
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Selection checkbox */}
                    {onSelectMultiple && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleSelect(ref); }}
                        className={`absolute top-2 right-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                          selected.has(ref.id)
                            ? 'bg-accent border-accent'
                            : 'bg-black/50 border-white/30 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {selected.has(ref.id) && <Check className="w-3.5 h-3.5 text-white" />}
                      </button>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5 bg-[#111]">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SOURCE_COLORS[ref.sourceName] || 'bg-white/10 text-fg-muted'}`}>
                        {ref.sourceName}
                      </span>
                      <a
                        href={ref.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:text-accent-hover"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-[10px] text-fg-subtle line-clamp-2 leading-relaxed">{ref.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ref.tags.slice(0, 3).map((tag, j) => (
                        <span key={j} className="text-[8px] text-fg-subtle bg-white/5 px-1 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center py-12">
          <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-fg-muted text-sm">Searching for visual references...</p>
          <p className="text-fg-subtle text-xs mt-1">Searching Wikimedia Commons + Pinterest</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && query && (
        <div className="text-center py-8">
          <Image className="w-8 h-8 text-fg-subtle mx-auto mb-2" />
          <p className="text-fg-subtle text-sm">Describe a visual and click "Find References"</p>
        </div>
      )}

      {/* Lightbox Preview */}
      {previewRef && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setPreviewRef(null)}>
          <button onClick={() => setPreviewRef(null)} className="absolute top-6 right-6 text-white/50 hover:text-white z-10">
            <X className="w-6 h-6" />
          </button>
          <div className="max-w-4xl max-h-[85vh] flex flex-col items-center px-4" onClick={e => e.stopPropagation()}>
            <img
              src={previewRef.imageUrl}
              alt={previewRef.description}
              className="max-h-[65vh] object-contain rounded-xl shadow-2xl"
            />
            <div className="mt-4 text-center">
              <p className="text-white font-medium text-sm mb-2">{previewRef.description}</p>
              <a
                href={previewRef.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium"
              >
                <ExternalLink className="w-4 h-4" />
                Open on {previewRef.sourceName} →
              </a>
              {(previewRef as any).pinterestUrl && (
              <a
                href={(previewRef as any).pinterestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-medium ml-4"
              >
                <ExternalLink className="w-4 h-4" />
                Browse on Pinterest →
              </a>
              )}
              <div className="flex items-center justify-center gap-2 mt-3">
                {previewRef.tags.map((t, i) => (
                  <span key={i} className="text-xs bg-white/10 text-fg-muted px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
              {onSelect && (
                <button
                  onClick={() => { onSelect(previewRef); setPreviewRef(null); }}
                  className="mt-4 inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-fg-on-accent px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Pin className="w-4 h-4" /> Use This Reference
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
