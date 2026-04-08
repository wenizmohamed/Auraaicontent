import { useState, useEffect } from 'react';
import { review } from '../lib/api';
import PostReview from './PostReview';

export default function Preview({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<any>(null);

  useEffect(() => {
    review.getPayload(token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleApproveMonth = async () => {
    await review.approveMonth(token);
    const fresh = await review.getPayload(token);
    setData(fresh);
  };

  if (loading) return <div style={styles.center}><p>Loading review...</p></div>;
  if (error) return <div style={styles.center}><p style={{ color: '#ef4444' }}>{error}</p></div>;
  if (!data?.month) return <div style={styles.center}><p>No content found.</p></div>;

  const { client, month } = data;
  const posts = month.posts || [];
  const approved = posts.filter((p: any) => p.status === 'approved').length;

  if (selectedPost) {
    return <PostReview token={token} post={selectedPost} clientName={client?.name} onBack={() => {
      setSelectedPost(null);
      review.getPayload(token).then(setData);
    }} />;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>RADIX</h1>
        <p style={styles.subtitle}>Content Review — {client?.name}</p>
      </header>

      <div style={styles.monthBar}>
        <span style={styles.monthLabel}>{month.month}</span>
        <span style={styles.stats}>{approved}/{posts.length} approved</span>
        {month.status !== 'approved' && (
          <button onClick={handleApproveMonth} style={styles.approveAllBtn}>Approve All</button>
        )}
        {month.status === 'approved' && <span style={styles.approvedBadge}>Month Approved</span>}
      </div>

      <div style={styles.grid}>
        {posts.map((post: any) => (
          <div key={post.id} onClick={() => setSelectedPost(post)} style={{
            ...styles.card,
            borderLeft: post.status === 'approved' ? '3px solid #22c55e' : '3px solid #3b82f6',
          }}>
            <div style={styles.cardHeader}>
              <span style={styles.platform}>{post.platform}</span>
              <span style={styles.format}>{post.format}</span>
              <span style={styles.date}>{post.date}</span>
            </div>
            <h3 style={styles.cardTitle}>{post.title}</h3>
            {post.keyMessage && <p style={styles.keyMessage}>{post.keyMessage}</p>}
            <p style={styles.caption}>{(post.caption || '').slice(0, 120)}...</p>
            <div style={styles.cardFooter}>
              <span style={{ color: post.status === 'approved' ? '#22c55e' : '#94a3b8', fontSize: '12px' }}>
                {post.status}
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>{post.comments?.length || 0} comments</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: '0 auto', padding: '24px 16px', fontFamily: 'Inter, sans-serif' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'Inter, sans-serif' },
  header: { textAlign: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 900, letterSpacing: '0.2em', margin: 0 },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  monthBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f1f5f9', borderRadius: 12, marginBottom: 20 },
  monthLabel: { fontWeight: 700, fontSize: 16 },
  stats: { fontSize: 13, color: '#64748b', flex: 1 },
  approveAllBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  approvedBadge: { background: '#dcfce7', color: '#16a34a', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  card: { background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'box-shadow 0.2s' },
  cardHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  platform: { background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  format: { background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 11 },
  date: { marginLeft: 'auto', fontSize: 11, color: '#94a3b8' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 6px' },
  keyMessage: { fontSize: 13, color: '#d97706', background: '#fffbeb', padding: '6px 10px', borderRadius: 8, marginBottom: 6 },
  caption: { fontSize: 13, color: '#475569', lineHeight: 1.5 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 10 },
};
