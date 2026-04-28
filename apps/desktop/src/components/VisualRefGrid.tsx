import { ExternalLink, Image as ImageIcon, Search } from 'lucide-react';
import type { VisualRef } from '../lib/backend-api';
import { ArtifactRenderer, classifyPath } from './ArtifactRenderer';

// Legacy local-store shape (from contentBriefs in store.tsx)
interface LegacyVisualRefImage {
  imageUrl: string;
  sourceUrl: string;
  description: string;
}

interface AssetLink {
  asset?: {
    id?: string;
    name?: string;
    fileUrl?: string;
    thumbUrl?: string;
    mimeType?: string;
  };
  // Some endpoints flatten the asset on the link itself
  id?: string;
  name?: string;
  fileUrl?: string;
  thumbUrl?: string;
  mimeType?: string;
}

interface PostLike {
  id?: string;
  title?: string;
  visualRefs?: VisualRef[];
  assets?: AssetLink[];
  visualRefImages?: LegacyVisualRefImage[];   // legacy local-store fallback
  referenceQuery?: string;
}

interface Props {
  post: PostLike;
  onSearchClick?: (query: string) => void;
  className?: string;
  cols?: number;   // default 4
}

const FALLBACK_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1a1a1a"/><text x="50%" y="50%" fill="#555" font-family="sans-serif" font-size="11" text-anchor="middle" dy=".3em">No image</text></svg>'
)}`;

function Card({
  thumbnailUrl,
  sourceUrl,
  sourceDomain,
  title,
}: {
  thumbnailUrl: string;
  sourceUrl: string;
  sourceDomain?: string;
  title?: string;
}) {
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg overflow-hidden border border-white/[0.05] hover:border-amber-500/30 transition-colors bg-zinc-900"
      title={title || sourceDomain || sourceUrl}
    >
      <div className="aspect-square relative">
        <img
          src={thumbnailUrl}
          alt={title || sourceDomain || ''}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (img.src !== FALLBACK_SVG) img.src = FALLBACK_SVG;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
          <div className="flex items-center gap-1 text-[10px] text-white/90 font-medium">
            <ExternalLink className="w-3 h-3" />
            Open source
          </div>
        </div>
      </div>
      {sourceDomain && (
        <div className="px-2 py-1 text-[9px] text-zinc-500 truncate border-t border-white/[0.04]">
          {sourceDomain}
        </div>
      )}
    </a>
  );
}

export default function VisualRefGrid({ post, onSearchClick, className = '', cols = 4 }: Props) {
  const visualRefs = post?.visualRefs || [];
  const assets = post?.assets || [];
  const legacy = post?.visualRefImages || [];
  const refQuery = post?.referenceQuery?.trim() || '';

  const colsClass =
    cols === 6 ? 'grid-cols-6' :
    cols === 5 ? 'grid-cols-5' :
    cols === 3 ? 'grid-cols-3' :
    cols === 2 ? 'grid-cols-2' :
    'grid-cols-4';

  // 1. External visual refs (preferred)
  if (visualRefs.length > 0) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Visual References</span>
          <span className="text-[9px] text-zinc-700">({visualRefs.length})</span>
          {onSearchClick && refQuery && (
            <button
              onClick={() => onSearchClick(refQuery)}
              className="ml-auto text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Search className="w-3 h-3" /> Find more
            </button>
          )}
        </div>
        <div className={`grid ${colsClass} gap-2`}>
          {visualRefs.map((ref) => (
            <Card
              key={ref.id}
              thumbnailUrl={ref.thumbnailUrl}
              sourceUrl={ref.sourceUrl}
              sourceDomain={ref.sourceDomain}
              title={ref.title}
            />
          ))}
        </div>
      </div>
    );
  }

  // 2. Internal assets (fallback)
  if (assets.length > 0) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Linked Assets</span>
          <span className="text-[9px] text-zinc-700">({assets.length})</span>
          {onSearchClick && refQuery && (
            <button
              onClick={() => onSearchClick(refQuery)}
              className="ml-auto text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Search className="w-3 h-3" /> Find inspiration
            </button>
          )}
        </div>
        <div className={`grid ${colsClass} gap-2`}>
          {assets.map((link, i) => {
            const a = link.asset || link;
            const src = a.thumbUrl || a.fileUrl || '';
            const fileUrl = a.fileUrl || src;
            const kind = classifyPath(a.name || fileUrl, a.mimeType);
            // Image assets: keep tight thumbnail grid (existing Card).
            // Non-image (pdf/video/pptx): inline ArtifactRenderer so users see real previews.
            if (kind === 'image') {
              return (
                <Card
                  key={a.id || i}
                  thumbnailUrl={src}
                  sourceUrl={fileUrl}
                  sourceDomain="internal"
                  title={a.name}
                />
              );
            }
            return (
              <ArtifactRenderer
                key={a.id || i}
                url={fileUrl}
                name={a.name}
                mimeType={a.mimeType}
                className="aspect-square"
              />
            );
          })}
        </div>
      </div>
    );
  }

  // 3. Legacy local-store visualRefImages (still used by old localStorage briefs)
  if (legacy.length > 0) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Visual References</span>
          <span className="text-[9px] text-zinc-700">({legacy.length})</span>
        </div>
        <div className={`grid ${colsClass} gap-2`}>
          {legacy.map((r, i) => (
            <Card
              key={i}
              thumbnailUrl={r.imageUrl}
              sourceUrl={r.sourceUrl || r.imageUrl}
              sourceDomain="legacy"
              title={r.description}
            />
          ))}
        </div>
      </div>
    );
  }

  // 4. Reference query → "Search inspiration" CTA
  if (refQuery) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Visual References</span>
        </div>
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-3 flex items-center gap-3">
          <Search className="w-4 h-4 text-zinc-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-500 truncate">Suggested search:</p>
            <p className="text-xs text-zinc-300 italic truncate">"{refQuery}"</p>
          </div>
          {onSearchClick && (
            <button
              onClick={() => onSearchClick(refQuery)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
            >
              Search inspiration
            </button>
          )}
        </div>
      </div>
    );
  }

  // 5. Nothing
  return null;
}
