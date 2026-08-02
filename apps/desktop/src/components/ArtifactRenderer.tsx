import { useState } from 'react';
import {
  FileText,
  FileCode,
  Image as ImgIcon,
  Video,
  Presentation,
  Download,
  ExternalLink,
} from 'lucide-react';

export type ArtifactKind = 'image' | 'video' | 'pptx' | 'pdf' | 'code' | 'text';

export function classifyPath(path: string, mimeType?: string): ArtifactKind {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('presentation') || m.includes('pptx')) return 'pptx';

  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return 'video';
  if (/\.pptx?$/i.test(path)) return 'pptx';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(py|ts|tsx|js|jsx|json|yaml|yml|sh|bash|go|rs|rb|java|cs|cpp|c|h|md)$/i.test(path)) return 'code';
  return 'text';
}

interface Props {
  url: string;
  name?: string;
  mimeType?: string;
  className?: string;
  fallbackSrc?: string;
  onClick?: () => void;
}

export function ArtifactRenderer({
  url,
  name,
  mimeType,
  className = '',
  fallbackSrc,
  onClick,
}: Props) {
  const [errored, setErrored] = useState(false);
  const kind = classifyPath(name || url, mimeType);
  const displayName = name || url.split('/').pop() || 'asset';

  if (errored) {
    return <FallbackCard url={url} name={displayName} kind={kind} className={className} fallbackSrc={fallbackSrc} />;
  }

  if (kind === 'image') {
    return (
      <figure
        className={`group rounded-lg overflow-hidden border border-white/[0.05] hover:border-accent/30 transition-colors bg-surface ${className}`}
        onClick={onClick}
      >
        <div className="aspect-square relative">
          <img
            src={url}
            alt={displayName}
            loading="lazy"
            onError={() => {
              if (fallbackSrc) {
                const img = document.createElement('img');
                img.src = fallbackSrc;
              } else {
                setErrored(true);
              }
            }}
            className="w-full h-full object-cover"
          />
        </div>
      </figure>
    );
  }

  if (kind === 'video') {
    return (
      <figure className={`rounded-lg overflow-hidden border border-white/[0.05] bg-black ${className}`}>
        <video
          src={url}
          controls
          onError={() => setErrored(true)}
          className="w-full max-h-[60vh] block"
        />
        <figcaption className="px-3 py-2 text-[11px] text-fg-subtle border-t border-white/[0.05] flex items-center justify-between bg-surface">
          <span className="font-mono truncate">{displayName}</span>
          <a href={url} download className="hover:text-accent flex items-center gap-1">
            <Download className="w-3 h-3" /> Download
          </a>
        </figcaption>
      </figure>
    );
  }

  if (kind === 'pdf') {
    return (
      <figure className={`rounded-lg overflow-hidden border border-white/[0.05] ${className}`}>
        <iframe
          src={url}
          title={displayName}
          onError={() => setErrored(true)}
          className="w-full h-[60vh] bg-zinc-50"
        />
        <figcaption className="px-3 py-2 text-[11px] text-fg-subtle border-t border-white/[0.05] flex items-center justify-between bg-surface">
          <span className="font-mono truncate">{displayName}</span>
          <a href={url} download className="hover:text-accent flex items-center gap-1">
            <Download className="w-3 h-3" /> Download
          </a>
        </figcaption>
      </figure>
    );
  }

  if (kind === 'pptx') {
    return (
      <FallbackCard
        url={url}
        name={displayName}
        kind="pptx"
        className={className}
        icon={<Presentation className="w-10 h-10 text-accent" />}
        subtitle="PowerPoint deck"
      />
    );
  }

  return <FallbackCard url={url} name={displayName} kind={kind} className={className} />;
}

function FallbackCard({
  url,
  name,
  kind,
  className,
  icon,
  subtitle,
  fallbackSrc,
}: {
  url: string;
  name: string;
  kind: ArtifactKind;
  className?: string;
  icon?: React.ReactNode;
  subtitle?: string;
  fallbackSrc?: string;
}) {
  const Icon =
    kind === 'image' ? ImgIcon :
    kind === 'video' ? Video :
    kind === 'pptx' ? Presentation :
    kind === 'code' ? FileCode :
    FileText;

  if (fallbackSrc && kind === 'image') {
    return (
      <figure className={`rounded-lg overflow-hidden border border-white/[0.05] bg-surface ${className || ''}`}>
        <div className="aspect-square">
          <img src={fallbackSrc} alt={name} className="w-full h-full object-cover" />
        </div>
      </figure>
    );
  }

  return (
    <div className={`rounded-lg border border-white/[0.05] bg-surface p-4 flex flex-col items-center text-center gap-2 ${className || ''}`}>
      {icon ?? <Icon className="w-10 h-10 text-fg-subtle" />}
      <div className="font-mono text-[11px] text-fg-muted truncate max-w-full">{name}</div>
      {subtitle && <div className="text-[10px] text-fg-subtle">{subtitle}</div>}
      <a
        href={url}
        download
        className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 text-accent border border-accent/20 text-[10px] font-medium hover:bg-accent/20 transition-colors"
      >
        <Download className="w-3 h-3" /> Download
      </a>
    </div>
  );
}

export function ArtifactLink({ url, name, mimeType, className = '' }: Props) {
  const kind = classifyPath(name || url, mimeType);
  const displayName = name || url.split('/').pop() || 'asset';
  const Icon =
    kind === 'image' ? ImgIcon :
    kind === 'video' ? Video :
    kind === 'pptx' ? Presentation :
    kind === 'pdf' ? FileText :
    kind === 'code' ? FileCode :
    FileText;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-hover ${className}`}
    >
      <Icon className="w-3 h-3" />
      <span className="truncate max-w-[200px]">{displayName}</span>
      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
    </a>
  );
}
