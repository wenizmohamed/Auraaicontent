// PublicGallery — the client-facing collaboration gallery (T3#15). Opened via a
// shared /g/:token link with NO login. The client browses their brand's
// generated assets and leaves per-asset feedback (approve / request changes +
// a comment). Feedback flows back to the agency in-app.
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { galleryShareApi, type ShareAsset, type AssetFeedbackRec } from '../lib/backend-api';

const NAME_KEY = 'radix_gallery_reviewer_name';
const assetUrl = (u: string) => galleryShareApi.downloadUrl(u);

export default function PublicGallery() {
  const { token = '' } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [assets, setAssets] = useState<ShareAsset[]>([]);
  const [feedback, setFeedback] = useState<AssetFeedbackRec[]>([]);
  const [selected, setSelected] = useState<ShareAsset | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || '');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await galleryShareApi.publicGet(token);
      setTitle(r.title); setClientName(r.clientName); setAssets(r.assets); setFeedback(r.feedback);
      setState('ready');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'This gallery link is no longer active.');
      setState('error');
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const feedbackFor = (assetId: string) => feedback.filter((f) => f.assetId === assetId);

  const submit = async (decision?: 'approved' | 'changes') => {
    if (!selected || !name.trim() || (!comment.trim() && !decision)) return;
    setSending(true);
    try {
      localStorage.setItem(NAME_KEY, name.trim());
      await galleryShareApi.publicFeedback(token, selected.id, { authorName: name.trim(), comment: comment.trim() || undefined, decision });
      setComment(''); setJustSent(true);
      await load();
      setTimeout(() => setJustSent(false), 2500);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Could not send feedback');
    } finally { setSending(false); }
  };

  if (state === 'loading') {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-fg-subtle text-sm">Loading gallery…</div>;
  }
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-fg-muted font-medium mb-1">Gallery unavailable</p>
          <p className="text-fg-subtle text-sm">{errMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-white/10 px-6 py-5 sticky top-0 bg-bg/90 backdrop-blur z-10">
        <p className="text-[11px] uppercase tracking-[0.2em] text-accent/80 font-bold">{clientName} · Review gallery</p>
        <h1 className="text-xl font-bold mt-1">{title || 'Content gallery'}</h1>
        <p className="text-xs text-fg-subtle mt-1">{assets.length} items · tap any to approve or request changes.</p>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {assets.length === 0 ? (
          <p className="text-center text-fg-subtle py-20">No items shared yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {assets.map((a) => {
              const fb = feedbackFor(a.id);
              const decided = fb.find((f) => f.decision);
              return (
                <button key={a.id} onClick={() => { setSelected(a); setComment(''); setJustSent(false); }}
                  className="group relative rounded-xl overflow-hidden border border-white/10 hover:border-accent/50 bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
                  {a.mimeType.startsWith('video') ? (
                    <video src={assetUrl(a.fileUrl)} className="w-full aspect-square object-cover" muted />
                  ) : (
                    <img src={assetUrl(a.thumbUrl || a.fileUrl)} alt={a.name} loading="lazy" className="w-full aspect-square object-cover" />
                  )}
                  {decided && (
                    <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${decided.decision === 'approved' ? 'bg-success text-white' : 'bg-accent text-fg-on-accent'}`}>
                      {decided.decision === 'approved' ? 'Approved' : 'Changes'}
                    </span>
                  )}
                  {fb.length > 0 && <span className="absolute bottom-2 left-2 text-[10px] bg-black/70 rounded-full px-2 py-0.5">💬 {fb.length}</span>}
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* Detail + feedback panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Review ${selected.name}`} onClick={(e) => e.stopPropagation()}
            className="bg-surface rounded-2xl border border-white/10 w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col sm:flex-row shadow-2xl">
            <div className="sm:w-1/2 bg-black flex items-center justify-center">
              {selected.mimeType.startsWith('video')
                ? <video src={assetUrl(selected.fileUrl)} controls className="w-full max-h-[50vh] sm:max-h-[92vh] object-contain" />
                : <img src={assetUrl(selected.fileUrl)} alt={selected.name} className="w-full max-h-[50vh] sm:max-h-[92vh] object-contain" />}
            </div>
            <div className="sm:w-1/2 p-5 flex flex-col overflow-y-auto">
              <div className="flex justify-between items-start mb-3">
                <h2 className="font-semibold text-sm pr-2 break-words">{selected.name}</h2>
                <button aria-label="Close" onClick={() => setSelected(null)} className="text-fg-muted hover:text-white shrink-0">✕</button>
              </div>
              <div className="flex-1 space-y-3 mb-4">
                {feedbackFor(selected.id).length === 0 && <p className="text-xs text-fg-subtle italic">No feedback yet. Be the first.</p>}
                {feedbackFor(selected.id).map((f) => (
                  <div key={f.id} className="bg-white/[0.04] rounded-lg p-3 text-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-fg">{f.authorName}</span>
                      {f.decision && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${f.decision === 'approved' ? 'text-success' : 'text-accent'}`}>{f.decision === 'approved' ? 'Approved' : 'Changes'}</span>}
                    </div>
                    {f.comment && <p className="text-fg-muted">{f.comment}</p>}
                  </div>
                ))}
              </div>
              <div className="border-t border-white/10 pt-3 space-y-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Add a comment (optional)…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none resize-none focus-visible:ring-2 focus-visible:ring-accent/60" />
                <div className="flex gap-2">
                  <button disabled={!name.trim() || sending} onClick={() => submit('approved')}
                    className="flex-1 py-2 rounded-lg bg-success-strong hover:bg-success disabled:opacity-40 text-white text-sm font-medium">Approve</button>
                  <button disabled={!name.trim() || sending} onClick={() => submit('changes')}
                    className="flex-1 py-2 rounded-lg bg-accent-pressed hover:bg-accent disabled:opacity-40 text-fg-on-accent text-sm font-medium">Request changes</button>
                  <button disabled={!name.trim() || !comment.trim() || sending} onClick={() => submit()}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm">Comment</button>
                </div>
                {justSent && <p className="text-success text-xs text-center">✓ Sent. Thank you!</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
