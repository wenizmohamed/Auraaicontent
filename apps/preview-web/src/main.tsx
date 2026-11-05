import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Preview from './pages/Preview';

function App() {
  // Extract token from URL: /review/:token
  const path = window.location.pathname;
  const match = path.match(/\/review\/([a-f0-9]+)/);
  const token = match?.[1] || new URLSearchParams(window.location.search).get('token') || '';

  if (!token) {
    return (
      <div style={{ fontFamily: 'Inter, sans-serif', textAlign: 'center', padding: '60px 20px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '0.2em' }}>AURAAI</h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>Client Preview Portal</p>
        <p style={{ color: '#ef4444', marginTop: 20 }}>No review token provided. Use the link shared by your agency.</p>
      </div>
    );
  }

  return <Preview token={token} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
