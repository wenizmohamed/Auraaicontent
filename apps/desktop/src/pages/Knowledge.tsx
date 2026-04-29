import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Trash2, Search, Loader2, Database, Zap, X, AlertCircle, CheckCircle2, Image as ImageIcon, FileType, FileCode, FileJson, Paperclip } from 'lucide-react';
import { knowledgeApi, type KnowledgeItemRecord } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useToast } from '../lib/toast-context';
import { EmptyState, EmptyStateAction } from '../components/ui/EmptyState';

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
  if (mime?.includes('text') || mime?.includes('markdown')) return <FileText className={`${className} text-zinc-400`} aria-label="text" />;
  if (mime?.includes('word') || mime?.includes('document')) return <FileText className={`${className} text-blue-400`} aria-label="document" />;
  if (mime?.includes('json')) return <FileJson className={`${className} text-emerald-400`} aria-label="json" />;
  return <Paperclip className={`${className} text-zinc-500`} aria-label="file" />;
}

export default function Knowledge() {
  const { selectedClientId, currentClient } = useClients();
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<KnowledgeItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [retrieving, setRetrieving] = useState(false);
  const [retrieveResults, setRetrieveResults] = useState<Array<{ text: string; score: number; itemTitle?: string }>>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleUpload(file: File) {
    if (!selectedClientId) {
      toastError('Select a client before uploading.');
      return;
    }
    setUploading(true);
    try {
      const created = await knowledgeApi.upload(selectedClientId, file);
      setItems((prev) => [created, ...prev]);
      toastSuccess(`Uploaded ${file.name}`);
      // Auto-embed in background
      setEmbeddingId(created.id);
      knowledgeApi
        .embed(created.id)
        .then((r) => toastSuccess(`Embedded ${file.name} (${r.chunks} chunks)`))
        .catch((err) => toastError(`Embed failed: ${err?.message || 'unknown'}`))
        .finally(() => setEmbeddingId(null));
    } catch (err: any) {
      toastError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
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

  if (!selectedClientId) {
    return (
      <div className="max-w-[1400px] mx-auto p-6">
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-12 text-center">
          <Database className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-zinc-300 mb-2">No client selected</h2>
          <p className="text-sm text-zinc-500">Pick a client from the top bar to manage their knowledge base.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <Database className="w-6 h-6 text-amber-400" />
            Knowledge Base
            <span className="text-sm font-medium text-zinc-500">· {currentClient?.name || 'client'}</span>
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Upload briefs, brand guides, and reference docs. Auto-embedded for retrieval-augmented generation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.docx,.json,.csv,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-amber-500 text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Upload File'}
          </button>
        </div>
      </motion.div>

      {/* Retrieval test */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-bold text-zinc-300">Test retrieval</h2>
          <span className="text-[11px] text-zinc-600">— ask a question, see which chunks match</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRetrieve(); }}
            placeholder="What's our policy on refunds?"
            className="flex-1 bg-black/40 border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/40"
          />
          <button
            type="button"
            onClick={handleRetrieve}
            disabled={!query.trim() || retrieving}
            className="flex items-center gap-2 bg-violet-500/20 border border-violet-500/30 text-violet-300 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-violet-500/30 disabled:opacity-50 cursor-pointer"
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
                    <span className="text-[10px] uppercase tracking-wider text-violet-400/70 font-bold">{r.itemTitle || `Chunk ${i + 1}`}</span>
                    <span className="text-[10px] text-zinc-600 font-mono">score {r.score?.toFixed(3)}</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">{r.text}</p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* List */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={Database}
          title="No knowledge items yet"
          description="Upload briefs, brand guides, references — anything the AI should know about. Documents are auto-embedded for retrieval-augmented generation."
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
                className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 group hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="shrink-0 leading-none mt-0.5"><TypeIcon mime={item.type} className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate" title={item.title}>{item.title}</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {item.type.split('/')[1] || item.type} · {relTime(item.createdAt)}
                      </p>
                    </div>
                  </div>
                  {item.metadata?.embedded ? (
                    <span title="Embedded" className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                      <CheckCircle2 className="w-2.5 h-2.5" /> embedded
                    </span>
                  ) : (
                    <span title="Not yet embedded" className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-500 bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5">
                      <AlertCircle className="w-2.5 h-2.5" /> raw
                    </span>
                  )}
                </div>

                {item.metadata?.size != null && (
                  <p className="text-[10px] text-zinc-700 mb-3">{formatBytes(item.metadata.size)}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleEmbed(item.id)}
                    disabled={isEmbedding}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold px-2 py-1.5 rounded-lg hover:bg-violet-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isEmbedding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isEmbedding ? 'Embedding…' : 'Re-embed'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-pressed={isArmed}
                    aria-label={isArmed ? `Confirm: click again within 6s to delete ${item.title}` : `Delete ${item.title}`}
                    className={`flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                      isArmed
                        ? 'bg-red-500/30 border-red-500/50 text-red-200 animate-pulse'
                        : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                    }`}
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
    </div>
  );
}
