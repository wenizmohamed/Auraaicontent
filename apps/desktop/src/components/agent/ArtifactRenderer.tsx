// ArtifactRenderer — inline preview of a generated file emitted by the agent.
// Dispatches to image/video/pdf/text/office previews based on mimeType or extension.
import { useMemo } from 'react';
import {
  Download,
  FileText,
  Image as ImageIcon,
  Film,
  ExternalLink,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Artifact } from '../../state/agent-store';

interface ArtifactRendererProps {
  artifact: Artifact;
}

type Kind = 'image' | 'video' | 'pdf' | 'text' | 'markdown' | 'office' | 'unknown';

const FILE_SERVER_BASE = 'http://localhost:8080';

function formatBytes(bytes?: number): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function basename(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function extOf(path: string): string {
  const name = basename(path).toLowerCase();
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1);
}

function classify(mime: string | undefined, ext: string): Kind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown' || m === 'text/markdown') return 'markdown';
  if (m.startsWith('text/') || ['txt', 'log', 'csv', 'json', 'yaml', 'yml'].includes(ext)) return 'text';
  if (
    m.includes('officedocument') ||
    ['pptx', 'docx', 'xlsx', 'ppt', 'doc', 'xls'].includes(ext)
  ) {
    return 'office';
  }
  return 'unknown';
}

function officeLabel(ext: string): string {
  const e = ext.toUpperCase();
  if (e === 'PPTX' || e === 'PPT') return 'PPTX';
  if (e === 'DOCX' || e === 'DOC') return 'DOCX';
  if (e === 'XLSX' || e === 'XLS') return 'XLSX';
  return e || 'Office document';
}

function resolveUrl(path: string): string | null {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/uploads/')) return `${FILE_SERVER_BASE}${path}`;
  return null;
}

export default function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  const filename = useMemo(() => basename(artifact.path), [artifact.path]);
  const ext = useMemo(() => extOf(artifact.path), [artifact.path]);
  const kind = useMemo(() => classify(artifact.mimeType, ext), [artifact.mimeType, ext]);
  const url = useMemo(() => resolveUrl(artifact.path), [artifact.path]);
  const sizeLabel = formatBytes(artifact.bytes);

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/10">
        <div className="shrink-0 text-zinc-400">
          {kind === 'image' ? (
            <ImageIcon className="h-4 w-4" />
          ) : kind === 'video' ? (
            <Film className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-100 truncate" title={filename}>
            {filename}
          </div>
          {sizeLabel && <div className="text-xs text-zinc-500">{sizeLabel}</div>}
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            download={filename}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        ) : (
          <span className="shrink-0 text-xs text-zinc-500">no url</span>
        )}
      </div>

      <div className="p-3">
        {!url ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ExternalLink className="h-3.5 w-3.5" />
            Preview unavailable for <span className="font-mono text-zinc-400">{artifact.path}</span>
          </div>
        ) : kind === 'image' ? (
          <img
            src={url}
            alt={filename}
            loading="lazy"
            className="max-h-96 w-full object-contain rounded-lg bg-black/30"
          />
        ) : kind === 'video' ? (
          <video
            src={url}
            controls
            className="max-h-96 w-full rounded-lg bg-black/30"
          />
        ) : kind === 'pdf' ? (
          <iframe
            src={url}
            title={filename}
            className="w-full rounded-lg bg-black/30 border border-white/5"
            style={{ height: 500 }}
          />
        ) : kind === 'markdown' || kind === 'text' ? (
          artifact.preview != null ? (
            <div className="prose prose-invert prose-sm max-w-none text-zinc-200 p-1">
              <ReactMarkdown>{artifact.preview}</ReactMarkdown>
            </div>
          ) : (
            <iframe
              src={url}
              title={filename}
              className="w-full rounded-lg bg-black/30 border border-white/5"
              style={{ height: 400 }}
            />
          )
        ) : kind === 'office' ? (
          <div className="flex items-center gap-3 rounded-lg bg-black/20 p-4">
            <FileText className="h-8 w-8 text-blue-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-zinc-100 truncate">{filename}</div>
              <div className="text-xs text-zinc-500">{officeLabel(ext)}</div>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              download={filename}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs text-white bg-[#F97316] hover:bg-[#ea6a0b] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-black/20 p-4">
            <FileText className="h-8 w-8 text-zinc-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-zinc-100 truncate">{filename}</div>
              <div className="text-xs text-zinc-500">{ext ? ext.toUpperCase() : 'File'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
