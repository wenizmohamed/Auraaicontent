import { useState } from 'react';
import { review } from '../lib/api';

export default function PostReview({ token, post, clientName, onBack }: {
  token: string; post: any; clientName: string; onBack: () => void;
}) {
  const [comments, setComments] = useState(post.comments || []);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState(post.status);
  const [sending, setSending] = useState(false);

  const handleComment = async () => {
    if (!name.trim() || !comment.trim()) return;
    setSending(true);
    const result = await review.addComment(token, post.id, { authorName: name, comment });
    setComments((prev: any[]) => [...prev, result]);
    setComment('');
    setSending(false);
  };

  const handleApprove = async () => {
    await review.approvePost(token, post.id);
    setStatus('approved');
  };

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.back}>← Back to all posts</button>

      <div style={styles.card}>
        <div style={styles.meta}>
          <span style={styles.platform}>{post.platform}</span>
          <span style={styles.format}>{post.format}</span>
          <span>{post.date}</span>
          <span style={{ marginLeft: 'auto', color: status === 'approved' ? '#22c55e' : '#3b82f6', fontWeight: 600 }}>
            {status}
          </span>
        </div>

        <h2 style={{ fontSize: 20, margin: '12px 0 6px' }}>{post.title}</h2>

        {post.keyMessage && (
          <div style={styles.section}>
            <label style={styles.label}>Key Message (on visual)</label>
            <p style={styles.keyMessage}>{post.keyMessage}</p>
          </div>
        )}

        <div style={styles.section}>
          <label style={styles.label}>Caption</label>
          <p style={styles.caption}>{post.caption}</p>
        </div>

        {post.cta && (
          <div style={styles.section}>
            <label style={styles.label}>Call to Action</label>
            <p style={{ ...styles.caption, color: '#16a34a', fontWeight: 600 }}>{post.cta}</p>
          </div>
        )}

        {post.hashtags?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {post.hashtags.map((h: string, i: number) => (
              <span key={i} style={styles.tag}>#{h}</span>
            ))}
          </div>
        )}

        {post.visualDirection && (
          <div style={styles.section}>
            <label style={styles.label}>Visual Direction</label>
            <p style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>{post.visualDirection}</p>
          </div>
        )}

        {status !== 'approved' && (
          <button onClick={handleApprove} style={styles.approveBtn}>Approve This Post</button>
        )}
      </div>

      <div style={styles.commentsSection}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Comments ({comments.length})</h3>

        {comments.map((c: any, i: number) => (
          <div key={i} style={styles.commentCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={{ fontSize: 13 }}>{c.authorName}</strong>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{c.source}</span>
            </div>
            <p style={{ fontSize: 13, color: '#334155', margin: 0 }}>{c.comment}</p>
          </div>
        ))}

        <div style={styles.commentForm}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
            style={styles.input} />
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..."
            rows={3} style={{ ...styles.input, resize: 'vertical' }} />
          <button onClick={handleComment} disabled={sending || !name.trim() || !comment.trim()}
            style={{ ...styles.submitBtn, opacity: sending ? 0.5 : 1 }}>
            {sending ? 'Sending...' : 'Add Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 700, margin: '0 auto', padding: '24px 16px', fontFamily: 'Inter, sans-serif' },
  back: { background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 },
  meta: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' },
  platform: { background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  format: { background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 6 },
  section: { marginTop: 12 },
  label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#94a3b8', display: 'block', marginBottom: 4 },
  keyMessage: { fontSize: 15, color: '#d97706', background: '#fffbeb', padding: '10px 14px', borderRadius: 8, fontWeight: 500, margin: 0 },
  caption: { fontSize: 14, color: '#334155', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' as const },
  tag: { fontSize: 12, color: '#6366f1', background: '#eef2ff', padding: '2px 8px', borderRadius: 6 },
  approveBtn: { marginTop: 16, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer', width: '100%' },
  commentsSection: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  commentCard: { background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 8 },
  commentForm: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 16 },
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontFamily: 'Inter, sans-serif' },
  submitBtn: { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
};
