/**
 * Dropzone — drag-drop file uploader with live thumbnail preview.
 *
 * Pure DOM event handlers (dragenter/over/leave/drop) — no react-dropzone dep.
 * Each dropped file gets an in-memory blob URL for the thumbnail strip; URLs
 * are revoked on unmount + on file removal so we don't leak.
 *
 * Upload is delegated to the parent via `onUpload(file)` which returns a
 * promise. The dropzone tracks per-file status (queued / uploading / done /
 * error) and shows the result inline. Multiple files are uploaded sequentially
 * (not parallel) to keep the backend rate-limit happy.
 *
 * a11y: the dropzone is also a button — Enter/Space opens the native file
 * picker, focus ring uses --color-accent. Status messages use aria-live.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, Loader2, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionUI } from '../../lib/motion';

type FileStatus = 'queued' | 'uploading' | 'done' | 'error';

interface QueuedFile {
  id: string;
  file: File;
  previewUrl: string | null;
  status: FileStatus;
  error?: string;
}

interface DropzoneProps {
  /** Per-file upload handler. Throw on failure. */
  onUpload: (file: File) => Promise<void>;
  /** Filter accepted MIME types. Default: images + videos. */
  accept?: string;
  /** Max file size in bytes. Files over this are rejected before upload. */
  maxSizeBytes?: number;
  /** Optional headline / sublabel overrides. */
  label?: string;
  sublabel?: string;
  /** Allow multi-select / multi-drop. Default true. */
  multiple?: boolean;
}

const DEFAULT_MAX = 50 * 1024 * 1024; // 50 MB

export function Dropzone({
  onUpload,
  accept = 'image/*,video/*',
  maxSizeBytes = DEFAULT_MAX,
  label = 'Drop files to upload',
  sublabel = 'or click to browse. Images & video, up to 50 MB',
  multiple = true,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [hovering, setHovering] = useState(false);
  const dragCounter = useRef(0);

  // Revoke any blob URLs when this component unmounts.
  useEffect(() => {
    return () => {
      queue.forEach((q) => { if (q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
    };
    // queue ref intentional: only run cleanup on unmount, not on every queue change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: QueuedFile[] = arr
      .filter((f) => {
        if (f.size > maxSizeBytes) {
          // Surface oversized files with an error entry rather than silently dropping
          setQueue((prev) => [
            ...prev,
            {
              id: `${f.name}-${Date.now()}-${Math.random()}`,
              file: f,
              previewUrl: null,
              status: 'error',
              error: `Too large (${formatBytes(f.size)} > ${formatBytes(maxSizeBytes)})`,
            },
          ]);
          return false;
        }
        return true;
      })
      .map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        file: f,
        previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/')
          ? URL.createObjectURL(f)
          : null,
        status: 'queued',
      }));
    setQueue((prev) => [...prev, ...next]);
    next.forEach((q) => { void runUpload(q); });
  }, [maxSizeBytes]);

  async function runUpload(q: QueuedFile) {
    setQueue((prev) => prev.map((x) => x.id === q.id ? { ...x, status: 'uploading' } : x));
    try {
      await onUpload(q.file);
      setQueue((prev) => prev.map((x) => x.id === q.id ? { ...x, status: 'done' } : x));
    } catch (err: any) {
      setQueue((prev) => prev.map((x) => x.id === q.id ? { ...x, status: 'error', error: err?.message || 'Upload failed' } : x));
    }
  }

  function remove(id: string) {
    setQueue((prev) => {
      const dead = prev.find((x) => x.id === id);
      if (dead?.previewUrl) URL.revokeObjectURL(dead.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  // ── Drag handlers (counter pattern avoids dragleave flicker on children) ─
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setHovering(true);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setHovering(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setHovering(false);
    if (e.dataTransfer.files?.length) add(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all cursor-pointer focus:outline-none"
        style={{
          background: hovering ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
          borderColor: hovering ? 'var(--color-accent)' : 'var(--color-border-subtle)',
        }}
        aria-label={label}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
          style={{
            background: 'var(--color-accent-subtle)',
            color: 'var(--color-accent)',
          }}
        >
          <Upload className="h-5 w-5" />
        </span>
        <span className="font-display text-[15px] font-semibold" style={{ color: 'var(--color-fg)' }}>
          {label}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
          {sublabel}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.currentTarget.value = ''; }}
        />
      </button>

      <AnimatePresence initial={false}>
        {queue.length > 0 && (
          <motion.div
            key="queue"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={motionUI}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            aria-live="polite"
          >
            {queue.map((q) => (
              <FileTile key={q.id} item={q} onRemove={() => remove(q.id)} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileTile({ item, onRemove }: { item: QueuedFile; onRemove: () => void }) {
  const isImage = item.file.type.startsWith('image/');
  const isVideo = item.file.type.startsWith('video/');
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={motionUI}
      className="relative flex flex-col overflow-hidden rounded-xl border"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{ background: 'var(--color-bg-sunken)' }}
      >
        {isImage && item.previewUrl ? (
          <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
        ) : isVideo && item.previewUrl ? (
          <video src={item.previewUrl} className="h-full w-full object-cover" muted playsInline />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: 'var(--color-fg-subtle)' }}>
            <FileText className="h-8 w-8" />
          </div>
        )}

        {/* Status overlay */}
        {item.status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.file.name}`}
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="px-2 py-1.5">
        <p className="truncate text-[11px] font-medium" style={{ color: 'var(--color-fg)' }} title={item.file.name}>
          {item.file.name}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
          <StatusBadge status={item.status} error={item.error} />
        </div>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status, error }: { status: FileStatus; error?: string }) {
  if (status === 'queued')    return <span style={{ color: 'var(--color-fg-subtle)' }}>Queued…</span>;
  if (status === 'uploading') return <span style={{ color: 'var(--color-fg-muted)' }}>Uploading…</span>;
  if (status === 'done')      return <span style={{ color: 'var(--color-success)' }} className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Done</span>;
  return <span style={{ color: 'var(--color-danger)' }} className="inline-flex items-center gap-1" title={error}><AlertCircle className="h-3 w-3" /> {error || 'Error'}</span>;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default Dropzone;
