import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Image as ImageIcon, Video as VideoIcon, X, Download, Trash2, Calendar, Building2, Loader2, Sparkles, Filter , Share2} from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { useClients } from '../lib/client-context';
import { galleryApi, assetsApi, galleryShareApi, type GalleryAsset } from '../lib/backend-api';
import { useToast } from '../lib/toast-context';
import { Skeleton, SkeletonAnnouncer } from '../components/ui/Skeleton';
import { motionUI, motionBase, motionInstant } from '../lib/motion';
import { Image } from '../components/ui/Image';
import { Dropzone } from '../components/ui/Dropzone';

type FilterType = 'all' | 'image' | 'video';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(iso);
}

export default function Gallery() {
  const { effectiveTheme } = useTheme();
  const { clients, currentClient } = useClients();
  const { success: toastOk, error: toastErr } = useToast();
  const isDark = effectiveTheme !== 'light';

  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterClient, setFilterClient] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [preview, setPreview] = useState<GalleryAsset | null>(null);
  const [sharing, setSharing] = useState(false);

  // Create a client-facing collaboration gallery link + copy it to clipboard.
  const handleShare = async () => {
    if (!currentClient) { toastErr('Select a client first'); return; }
    setSharing(true);
    try {
      const { url } = await galleryShareApi.create(currentClient.id, `${currentClient.name} — gallery`);
      try { await navigator.clipboard.writeText(url); toastOk('Share link copied — send it to your client'); }
      catch { toastOk(`Share link: ${url}`); }
    } catch (e) {
      toastErr(e instanceof Error ? e.message : 'Could not create share link');
    } finally { setSharing(false); }
  };

  useEffect(() => {
    setLoading(true);
    galleryApi.list({ take: 500 })
      .then(setAssets)
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (filterType === 'image' && !a.mimeType.startsWith('image/')) return false;
      if (filterType === 'video' && !a.mimeType.startsWith('video/')) return false;
      if (filterClient !== 'all' && a.client?.id !== filterClient) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const inName = a.name.toLowerCase().includes(q);
        const inClient = a.client?.name.toLowerCase().includes(q);
        if (!inName && !inClient) return false;
      }
      return true;
    });
  }, [assets, filterType, filterClient, searchQuery]);

  const counts = useMemo(() => ({
    all: assets.length,
    image: assets.filter(a => a.mimeType.startsWith('image/')).length,
    video: assets.filter(a => a.mimeType.startsWith('video/')).length,
  }), [assets]);

  const handleDelete = async (asset: GalleryAsset) => {
    if (!confirm(`Delete "${asset.name}"?`)) return;
    try {
      await galleryApi.delete(asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      setPreview(null);
      toastOk('Asset deleted');
    } catch (err: any) {
      toastErr(err?.message || 'Delete failed');
    }
  };

  // Theming
  const bg = isDark ? 'bg-[#0a0a0f]' : 'bg-slate-50';
  const cardBg = isDark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-white border-slate-200 shadow-sm';
  const cardBgHover = isDark ? 'hover:border-white/[0.12] hover:bg-white/[0.05]' : 'hover:border-slate-300 hover:shadow-md';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-zinc-400' : 'text-slate-600';
  const textMuted = isDark ? 'text-zinc-600' : 'text-slate-500';
  const inputBg = isDark ? 'bg-white/[0.04] border-white/[0.08] text-white placeholder-zinc-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400';
  const chipBase = isDark ? 'bg-white/[0.04] hover:bg-white/[0.08]' : 'bg-slate-100 hover:bg-slate-200';
  const chipActive = isDark ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-amber-100 text-amber-700 border border-amber-300';

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionBase}
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Assets</p>
          <h1 className={`font-display text-3xl sm:text-4xl font-bold tracking-tight ${textPrimary}`}>Gallery</h1>
          <p className={`text-sm mt-1 ${textSecondary}`}>
            All generated images and videos across your clients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            disabled={sharing || !currentClient}
            title={currentClient ? `Create a shareable review link for ${currentClient.name}` : 'Select a client to share'}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition-colors"
          >
            <Share2 className="w-4 h-4" />
            {sharing ? 'Creating…' : 'Share with client'}
          </button>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${cardBg} border`}>
            <Sparkles className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
            <span className={`text-sm font-semibold tabular-nums ${textPrimary}`}>{counts.all}</span>
            <span className={`text-xs ${textMuted}`}>assets</span>
          </div>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionBase, delay: 0.05 }}
        className={`rounded-2xl p-4 border ${cardBg}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textMuted}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by filename or client..."
              className={`w-full pl-10 pr-3 py-2 text-sm rounded-lg border ${inputBg} focus:outline-none focus:ring-2 focus:ring-amber-500/40`}
            />
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1">
            {([
              { key: 'all', label: 'All', count: counts.all, icon: Filter },
              { key: 'image', label: 'Images', count: counts.image, icon: ImageIcon },
              { key: 'video', label: 'Videos', count: counts.video, icon: VideoIcon },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => setFilterType(opt.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${filterType === opt.key ? chipActive : `${chipBase} ${textSecondary}`}`}
              >
                <opt.icon className="w-3.5 h-3.5" />
                {opt.label}
                <span className={`text-[10px] tabular-nums ${filterType === opt.key ? '' : textMuted}`}>{opt.count}</span>
              </button>
            ))}
          </div>

          {/* Client filter */}
          {clients.length > 0 && (
            <select
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              className={`text-sm rounded-lg border px-3 py-2 cursor-pointer ${inputBg} focus:outline-none focus:ring-2 focus:ring-amber-500/40`}
            >
              <option value="all">All clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </motion.div>

      {/* Dropzone — drag-drop upload, gated on having an active client. */}
      {currentClient ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionBase, delay: 0.08 }}
        >
          <Dropzone
            label={`Drop files to upload to ${currentClient.name}`}
            sublabel="or click to browse — images & video, up to 50 MB"
            onUpload={async (file) => {
              await assetsApi.upload(currentClient.id, file);
              const fresh = await galleryApi.list({ take: 500 });
              setAssets(fresh);
            }}
          />
        </motion.div>
      ) : null}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <SkeletonAnnouncer label="Loading gallery…" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton
              key={i}
              height={0}
              radius="xl"
              delay={i * 60}
              style={{ aspectRatio: '1 / 1', height: 'auto' }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={`rounded-2xl border ${cardBg} p-16 text-center`}>
          <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDark ? 'bg-white/[0.04]' : 'bg-slate-100'}`}>
            <ImageIcon className={`w-7 h-7 ${textMuted}`} />
          </div>
          <h3 className={`text-lg font-bold mb-2 ${textPrimary}`}>
            {assets.length === 0 ? 'No assets yet' : 'No matches'}
          </h3>
          <p className={`text-sm ${textSecondary}`}>
            {assets.length === 0
              ? 'Generate images or videos in Creative Tools and they\'ll appear here.'
              : 'Try adjusting your filters or search query.'}
          </p>
        </div>
      ) : (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
          <AnimatePresence>
            {filtered.map((asset, i) => {
              const isVideo = asset.mimeType.startsWith('video/');
              const aspectRatio = asset.width && asset.height ? asset.width / asset.height : 1;
              return (
                <motion.div
                  key={asset.id}
                  layoutId={`asset-${asset.id}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ ...motionUI, delay: Math.min(i * 0.02, 0.5) }}
                  className={`break-inside-avoid mb-3 rounded-xl overflow-hidden border cursor-pointer group transition-all ${cardBg} ${cardBgHover}`}
                  onClick={() => setPreview(asset)}
                >
                  <div className="relative" style={{ aspectRatio }}>
                    {isVideo ? (
                      <>
                        <video
                          src={asset.fileUrl}
                          className="w-full h-full object-cover bg-black"
                          preload="metadata"
                          muted
                        />
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <VideoIcon className="w-2.5 h-2.5" /> Video
                        </div>
                      </>
                    ) : (
                      <Image
                        src={asset.thumbUrl || asset.fileUrl}
                        alt={asset.name}
                        className="w-full h-full"
                      />
                    )}

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                      <p className="text-white text-xs font-semibold truncate">{asset.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-white/70 text-[10px]">{formatRelative(asset.createdAt)}</span>
                        {asset.client && <span className="text-white/70 text-[10px] truncate ml-2">{asset.client.name}</span>}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionInstant}
            className="fixed inset-0 z-modal flex items-center justify-center bg-black/90 backdrop-blur-md p-4 cursor-pointer"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
          >
            <button
              onClick={() => setPreview(null)}
              aria-label="Close preview"
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer z-10"
            >
              <X className="w-5 h-5" />
            </button>

            <motion.div
              layoutId={preview ? `asset-${preview.id}` : undefined}
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={motionBase}
              className="max-w-6xl w-full max-h-[90vh] flex flex-col items-center cursor-default"
              onClick={e => e.stopPropagation()}
            >
              {preview.mimeType.startsWith('video/') ? (
                <video
                  src={preview.fileUrl}
                  controls
                  autoPlay
                  className="max-h-[70vh] w-auto rounded-2xl shadow-2xl bg-black"
                />
              ) : (
                <img
                  src={preview.fileUrl}
                  alt={preview.name}
                  className="max-h-[70vh] w-auto rounded-2xl shadow-2xl"
                />
              )}

              {/* Metadata bar */}
              <div className="mt-4 w-full max-w-3xl bg-zinc-900/90 backdrop-blur-xl rounded-2xl p-5 border border-white/10">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold text-base truncate">{preview.name}</h3>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-zinc-400">
                      {preview.client && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> {preview.client.name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {formatDate(preview.createdAt)}
                      </span>
                      {preview.width && preview.height && (
                        <span className="font-mono">{preview.width}×{preview.height}</span>
                      )}
                      <span className="font-mono uppercase">{preview.mimeType.split('/')[1]}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={preview.fileUrl}
                      download={preview.name}
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                    <button
                      onClick={() => handleDelete(preview)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
