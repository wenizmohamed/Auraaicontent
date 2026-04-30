/**
 * Workspace.StudioDetail — full asset preview pane. Image renders inline,
 * video gets a <video controls> player. Falls back to a metadata card if
 * the asset isn't found.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, Wand2, Image as ImageIcon } from 'lucide-react';
import { galleryApi, type GalleryAsset } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { Badge, Button, EmptyState, Separator } from '../components/ui';

export default function StudioDetail({ pieceId: assetId }: { pieceId: string }) {
  const navigate = useNavigate();
  const { selectedClientId } = useClients();
  const [asset, setAsset] = useState<GalleryAsset | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // galleryApi has no get(id) — list and pick. The list is small per client.
    galleryApi.list(selectedClientId ? { clientId: selectedClientId, take: 200 } : { take: 200 })
      .then((rows) => { if (!cancelled) setAsset(rows.find(r => r.id === assetId) ?? null); })
      .catch(() => { if (!cancelled) setAsset(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId, selectedClientId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={ImageIcon}
          title="Asset not found"
          description="It may have been removed, or it belongs to a different client."
          compact
        />
      </div>
    );
  }

  const isVideo = asset.mimeType?.startsWith('video/');
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[18px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {asset.name || 'Untitled asset'}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge subtle tone={isVideo ? 'info' : 'accent'}>{isVideo ? 'video' : 'image'}</Badge>
            {asset.client && <Badge subtle>{asset.client.name}</Badge>}
            {asset.width && asset.height && <Badge subtle>{asset.width}×{asset.height}</Badge>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => navigate('/gallery')}
        >
          Open gallery
        </Button>
      </div>
      <Separator />
      <div
        className="flex items-center justify-center overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-elevated)' }}
      >
        {isVideo ? (
          <video src={asset.fileUrl} controls className="max-h-[60vh] w-full">
            <track kind="captions" />
          </video>
        ) : (
          <img src={asset.fileUrl} alt={asset.name || ''} className="max-h-[60vh] w-auto" />
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>
        Created {new Date(asset.createdAt).toLocaleString()}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" leftIcon={<Wand2 size={12} />} onClick={() => navigate('/creative')}>
          Open in editor
        </Button>
      </div>
    </div>
  );
}
