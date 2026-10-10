import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Trash2, Search, Loader2, Database, Zap, X, AlertCircle, CheckCircle2, Image as ImageIcon, FileType, FileCode, FileJson, Paperclip } from 'lucide-react';
import { knowledgeApi, type KnowledgeItemRecord } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useToast } from '../lib/toast-context';
import { EmptyState, EmptyStateAction } from '../components/ui/EmptyState';
import { SkeletonRow, SkeletonAnnouncer } from '../components/ui/Skeleton';
import { motionUI } from '../lib/motion';
import { useMultiSelect } from '../lib/use-multi-select';
import { BulkActionBar } from '../components/ui/BulkActionBar';
import { Square, CheckSquare, FolderUp } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (!bytes) return '--';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TypeIcon({ mime, className = 'w-5 h-5' }: { mime: string; className?: string }) {
  if (mime?.startsWith('image/')) return <ImageIcon className={`${className} text-violet-400`} aria-label="image" />;
  if (mime?.includes('pdf')) return <FileType className={`${className} text-red-400`} aria-label="pdf" />;
  if (mime?.includes('text') || mime?.includes('markdown')) return <FileText className={`${className} text-fg-muted`} aria-label="text" />;
  if (mime?.includes('word') || mime?.includes('document')) return <FileText className={`${className} text-blue-400`} aria-label="document" />;
  if (mime?.includes('json')) return <FileJson className={`${className} text-emerald-400`} aria-label="json" />;
  return <Paperclip className={`${className} text-fg-subtle`} aria-label="file" />;
}

// Server accepts up to 50 MB per file.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// What a whole-folder upload keeps. A project folder is full of things that are
// not knowledge (code, lock files, caches); single-file uploads are not filtered.
const DOCUMENT_EXT = /\.(pdf|txt|md|csv|json|html?|rtf|docx?|pptx?|xlsx?|jpe?g|png|webp|gif|avif|bmp|tiff?|mp4|mov|webm|m4v|mp3|wav|m4a)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|__pycache__|\.venv|dist|build)(\/|$)/;
const SKIP_NAME = /^(thumbs\.db|desktop\.ini|\.ds_store)$|^~\$/i;

function keepFromFolder(file: File, relPath: string): boolean {
  return file.size > 0 && !SKIP_PATH.test(relPath) && !SKIP_NAME.test(file.name) && DOCUMENT_EXT.test(file.name);
}

/** Every file under whatever was dropped: loose files and whole folders alike. */
async function filesFromDrop(dt: DataTransfer): Promise<{ files: File[]; leftOut: number; hadFolder: boolean }> {
  const roots = Array.from(dt.items || [])
    .map(it => (it.kind === 'file' ? (it as any).webkitGetAsEntry?.() : null))
    .filter(Boolean) as any[];
  if (roots.length === 0) return { files: Array.from(dt.files || []), leftOut: 0, hadFolder: false };
  const files: File[] = [];
  let leftOut = 0;
  let hadFolder = false;
  const readAll = (reader: any) => new Promise<any[]>((resolve) => {
    const all: any[] = [];
    const next = () => reader.readEntries((batch: any[]) => {
      if (!batch.length) return resolve(all);
      all.push(...batch);
      next(); // readEntries returns at most 100 entries per call
    }, () => resolve(all));
    next();
  });
  const visit = async (entry: any, inFolder: boolean): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
      const rel = String(entry.fullPath || file.name).replace(/^\//, '');
      if (!inFolder || keepFromFolder(file, rel)) files.push(file); else leftOut += 1;
    } else if (entry.isDirectory) {
      hadFolder = true;
      if (SKIP_PATH.test(`${entry.fullPath}/`)) return;
      for (const child of await readAll(entry.createReader())) await visit(child, true);
    }
  };
  for (const root of roots) await visit(root, false).catch(() => {});
  return { files, leftOut, hadFolder };
}

export default function Knowledge({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedClientId, currentClient } = useClients();
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<KnowledgeItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  // Whole folder picked with the Upload Folder button.
  function handleFolderPicked(picked: File[]) {
    const keep = picked.filter(f => keepFromFolder(f, (f as any).webkitRelativePath || f.name));
    const leftOut = picked.length - keep.length;
    if (keep.length === 0) { toastError('No documents found in that folder.'); return; }
    if (leftOut > 0) toastSuccess(`${keep.length} documents found. ${leftOut} other files (code, system files) left out`);
    handleUpload(keep);
  }

  // Files or folders dropped anywhere on the page.
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (uploading) return;
    const { files, leftOut, hadFolder } = await filesFromDrop(e.dataTransfer);
    if (files.length === 0) { toastError(hadFolder ? 'No documents found in that folder.' : 'Nothing to upload.'); return; }
    if (leftOut > 0) toastSuccess(`${files.length} documents found. ${leftOut} other files (code, system files) left out`);
    handleUpload(files);
  }
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [retrieving, setRetrieving] = useState(false);
  const [retrieveResults, setRetrieveResults] = useState<Array<{ text: string; score: number; itemTitle?: string }>>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-select for bulk delete (Phase 5).
  const ms = useMultiSelect<string>(items.map((i) => i.id));

  useEffect(() => {
    if (!selectedClientId) {
      setItems([]);
      return;
    }
    setLoading(true);
    knowledgeApi
      .list(selectedClientId)
      .then(setItems)
      .catch((err) => toastError(err?.message || 'Failed to load knowledge'))
      .finally(() => setLoading(false));
  }, [selectedClientId, toastError]);

  // Upload one or many files. They go up one after another (the endpoint takes
  // a single file per request) with a running count on the button, and one
  // summary at the end instead of a toast per file.
  async function handleUpload(files: File[]) {
    if (!selectedClientId) {
      toastError('Select a client before uploading.');
      return;
    }
    if (files.length === 0) return;
    const clientId = selectedClientId;
    setUploading(true);
    const failed: string[] = [];
    let done = 0;
    try {
      for (const file of files) {
        setUploadProgress({ current: done + failed.length + 1, total: files.length });
        if (file.size > MAX_UPLOAD_BYTES) {
          failed.push(`${file.name} (over 50 MB)`);
          continue;
        }
        try {
          const created = await knowledgeApi.upload(clientId, file);
          setItems((prev) => [created, ...prev]);
          done += 1;
        } catch (err: any) {
          failed.push(`${file.name}${err?.message ? ` (${err.message})` : ''}`);
        }
      }
      if (done > 0) {
        toastSuccess(
          files.length === 1
            ? `Uploaded ${files[0].name}. Reading it in the background`
            : `Uploaded ${done} of ${files.length} files. Reading them in the background`,
        );
      }
      if (failed.length > 0) toastError(`Could not upload: ${failed.join(', ')}`);
      // NOTE: the server auto-embeds on upload (fire-and-forget), so we do NOT
      // call /embed here — running both races the worker's deleteMany+recreate.
      // Refresh twice to surface chunk counts: text files finish in seconds,
      // images, audio and video take longer because a model has to read them.
      if (done > 0) {
        for (const delay of [6000, 25000]) {
          setTimeout(() => {
            knowledgeApi.list(clientId).then(setItems).catch(() => {});
          }, delay);
        }
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleEmbed(id: string) {
    setEmbeddingId(id);
    try {
      const r = await knowledgeApi.embed(id);
      toastSuccess(`Embedded (${r.chunks} chunks)`);
    } catch (err: any) {
      toastError(`Embed failed: ${err?.message || 'unknown'}`);
    } finally {
      setEmbeddingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete((curr) => (curr === id ? null : curr)), 6000);
      return;
    }
    try {
      await knowledgeApi.remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toastSuccess('Deleted');
    } catch (err: any) {
      toastError(err?.message || 'Delete failed');
    } finally {
      setPendingDelete(null);
    }
  }

  async function handleBulkDelete(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => knowledgeApi.remove(id)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    if (fail === 0) toastSuccess(`Deleted ${ok} items`);
    else toastError(`Deleted ${ok}, ${fail} failed`);
  }

  async function handleRetrieve() {
    const q = query.trim();
    if (!q || !selectedClientId) return;
    setRetrieving(true);
    setRetrieveResults([]);
    try {
      const out = await knowledgeApi.retrieve(selectedClientId, q, 5);
      setRetrieveResults(out.chunks || []);
      if ((out.chunks || []).length === 0) toastError('No matching chunks. Embed some content first.');
    } catch (err: any) {
      toastError(err?.message || 'Retrieve failed');
    } finally {
      setRetrieving(false);
    }
  }

  // The hidden file input + the Upload File button. Rendered in the header when
  // standalone, or in a tab-local toolbar when embedded — must stay mounted in
  // BOTH modes (hiding the header alone would drop the only upload entry point).
  const uploadControls = (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) handleUpload(picked);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || !selectedClientId}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading
          ? (uploadProgress && uploadProgress.total > 1 ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…` : 'Uploading…')
          : 'Upload Files'}
      </button>
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        // Non-standard but supported everywhere that matters: pick a whole folder.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length) handleFolderPicked(picked);
        }}
      />
      <button
        type="button"
        onClick={() => folderInputRef.current?.click()}
        disabled={uploading || !selectedClientId}
        title="Upload every document in a folder, including its subfolders"
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border disabled:opacity-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-fg)', background: 'var(--color-surface)' }}
      >
        <FolderUp className="w-4 h-4" />
        Upload Folder
      </button>
    </div>
  );

  // No-client state. When embedded we render an inline card inside the tab body
  // (the merged page owns the outer container); standalone keeps its own.
  if (!selectedClientId) {
    const card = (
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-12 text-center">
        <Database className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-fg-subtle)' }} />
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-fg-muted)' }}>No client selected</h2>
        <p className="text-sm" style={{ color: 'var(--color-fg-subtle)' }}>Pick a client from the top bar to manage their knowledge base.</p>
      </div>
    );
    if (embedded) return card;
    return <div className="max-w-[1400px] mx-auto p-6">{card}</div>;
  }

  const body = (
    <>
      {/* Header — hidden in embedded mode (the merged AI Memory page owns it). */}
      {!embedded && (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Knowledge</p>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-3" style={{ color: 'var(--color-fg)' }}>
            <Database className="w-6 h-6" style={{ color: 'var(--color-accent)' }} />
            Knowledge Base
            <span className="text-sm font-medium" style={{ color: 'var(--color-fg-subtle)' }}>· {currentClient?.name || 'client'}</span>
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-fg-subtle)' }}>
            Upload briefs, brand guides, and reference docs. Auto-embedded for retrieval-augmented generation.
          </p>
        </div>
        {uploadControls}
      </motion.div>
      )}

      {/* Embedded toolbar — keeps the Upload entry point visible without a header. */}
      {embedded && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm" style={{ color: 'var(--color-fg-subtle)' }}>
            Documents grounding this client's generations via retrieval-augmented generation.
          </p>
          {uploadControls}
        </div>
      )}

      {/* Retrieval test */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionUI, delay: 0.05 }}
        className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-fg-muted">Test retrieval</h2>
          <span className="text-[11px] text-fg-subtle">ask a question, see which chunks match</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRetrieve(); }}
            placeholder="What's our policy on refunds?"
            className="flex-1 bg-black/40 border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-white placeholder:text-fg-subtle focus:outline-none focus:border-accent/40"
          />
          <button
            type="button"
            onClick={handleRetrieve}
            disabled={!query.trim() || retrieving}
            className="flex items-center gap-2 bg-accent/20 border border-accent/30 text-accent px-4 py-2 rounded-xl text-sm font-semibold hover:bg-accent/30 disabled:opacity-50 cursor-pointer"
          >
            {retrieving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Retrieve
          </button>
        </div>
        <AnimatePresence>
          {retrieveResults.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="mt-3 space-y-2 overflow-hidden">
              {retrieveResults.map((r, i) => (
                <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-accent/70 font-bold">{r.itemTitle || `Chunk ${i + 1}`}</span>
                    <span className="text-[10px] text-fg-subtle font-mono">score {r.score?.toFixed(3)}</span>
                  </div>
                  <p className="text-xs text-fg-muted leading-relaxed">{r.text}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* List */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <SkeletonAnnouncer label="Loading knowledge items…" />
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} delay={i * 80} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={Database}
          spotlight
          title="No knowledge items yet"
          description="Upload briefs, brand guides, references. Anything the AI should know about. Documents are auto-embedded for retrieval-augmented generation."
          primary={
            <EmptyStateAction onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4" /> Upload first document
            </EmptyStateAction>
          }
        />
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => {
            const isArmed = pendingDelete === item.id;
            const isEmbedding = embeddingId === item.id;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`relative rounded-2xl border p-4 group transition-colors ${
                  ms.isSelected(item.id)
                    ? ''
                    : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                }`}
                style={ms.isSelected(item.id) ? { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)' } : undefined}
              >
                {/* Multi-select checkbox — visible on hover or when any row is selected */}
                <button
                  type="button"
                  onClick={(e) => ms.onRowClick(item.id, e)}
                  aria-label={ms.isSelected(item.id) ? 'Deselect' : 'Select'}
                  className={`absolute top-3 right-3 z-10 rounded-md p-1 transition-opacity cursor-pointer ${
                    ms.hasSelection || ms.isSelected(item.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{ color: ms.isSelected(item.id) ? 'var(--color-accent)' : 'var(--color-fg-subtle)' }}
                >
                  {ms.isSelected(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
                <div className="flex items-start justify-between gap-2 mb-3 pr-8">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="shrink-0 leading-none mt-0.5"><TypeIcon mime={item.type} className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate" title={item.title}>{item.title}</p>
                      <p className="text-[10px] text-fg-subtle mt-0.5">
                        {item.type.split('/')[1] || item.type} · {relTime(item.createdAt)}
                      </p>
                    </div>
                  </div>
                  {(item.metadata?.embedded || ((item as any)._count?.chunks ?? 0) > 0) ? (
                    <span title="Read and searchable by the AI" className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--color-success)', background: 'var(--color-success-subtle)', border: '1px solid var(--color-success)' }}>
                      <CheckCircle2 className="w-2.5 h-2.5" /> ready
                    </span>
                  ) : item.metadata?.readError ? (
                    <span title={String(item.metadata.readError)} className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--color-danger)', background: 'var(--color-danger-subtle)', border: '1px solid var(--color-danger)' }}>
                      <AlertCircle className="w-2.5 h-2.5" /> could not read
                    </span>
                  ) : (
                    <span title="Not read yet" className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider text-fg-subtle bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5">
                      <AlertCircle className="w-2.5 h-2.5" /> reading
                    </span>
                  )}
                </div>

                {item.metadata?.readError && !(((item as any)._count?.chunks ?? 0) > 0) && (
                  <p className="text-[10px] mb-3" style={{ color: 'var(--color-danger)' }}>{String(item.metadata.readError)}</p>
                )}
                {item.metadata?.size != null && (
                  <p className="text-[10px] text-fg-subtle mb-3">{formatBytes(item.metadata.size)}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleEmbed(item.id)}
                    disabled={isEmbedding}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-accent/10 border border-accent/20 text-accent text-xs font-semibold px-2 py-1.5 rounded-lg hover:bg-accent/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isEmbedding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isEmbedding ? 'Reading…' : 'Read again'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-pressed={isArmed}
                    aria-label={isArmed ? `Confirm: click again within 6s to delete ${item.title}` : `Delete ${item.title}`}
                    className={`flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                      isArmed ? 'animate-pulse' : ''
                    }`}
                    style={
                      isArmed
                        ? { background: 'var(--color-danger)', borderColor: 'var(--color-danger-strong)', color: 'var(--color-fg-on-accent)' }
                        : { background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }
                    }
                  >
                    {isArmed ? <X className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                    {isArmed ? 'Confirm' : ''}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Bulk action bar — slides up when ≥1 item is selected. */}
      <BulkActionBar count={ms.count} onClear={ms.clear}>
        <button
          type="button"
          onClick={async () => {
            const ids = [...ms.selected];
            ms.clear();
            await handleBulkDelete(ids);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
          style={{ background: 'var(--color-danger)', color: 'var(--color-fg-on-accent)' }}
        >
          <Trash2 size={12} /> Delete
        </button>
      </BulkActionBar>
    </>
  );

  // The whole page is a drop target: drag files or a folder in from the desktop.
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    onDrop: handleDrop,
  };
  const dropHint = dragOver && (
    <div
      className="rounded-2xl border-2 border-dashed p-6 text-center text-sm font-semibold"
      style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'var(--color-surface)' }}
    >
      Drop files or a whole folder to add them to {currentClient?.name || 'this client'}'s knowledge base
    </div>
  );

  if (embedded) return <div className="space-y-6" {...dropProps}>{dropHint}{body}</div>;
  return <div className="max-w-[1400px] mx-auto p-6 space-y-6" {...dropProps}>{dropHint}{body}</div>;
}
