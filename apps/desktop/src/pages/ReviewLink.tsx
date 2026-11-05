// ReviewLink is the client-facing monthly content review. The agency mints
// ${APP_BASE_URL}/review/<token> from ContentCalendar and sends it on. The
// recipient is a client, not an AuraAI user: no login, no account, no app chrome.
//
// The token IS the auth. Everything here talks to the public, unauthenticated
// endpoints in server/src/routes/review.ts:
//   GET  /api/review/:token                            payload
//   POST /api/review/:token/posts/:postId/comments     { authorName, comment, status? }
//   POST /api/review/:token/posts/:postId/approve      per post
//   POST /api/review/:token/month/approve              whole month
//
// Deliberately does NOT use lib/backend-api request(), which attaches the
// agency JWT. A client browser has no token and must never be asked for one.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiUrl } from '../lib/backend-api';
import { AlertCircle, Check, MessageSquare, RotateCcw, CalendarDays } from 'lucide-react';

const NAME_KEY = 'radix_review_reviewer_name';

interface ReviewComment {
  id: string;
  authorName: string;
  comment: string;
  status?: string | null;
  source?: string | null;
  createdAt?: string;
}

interface ReviewPost {
  id: string;
  date: string;
  title: string;
  platform: string;
  format: string;
  pillar?: string | null;
  hook?: string | null;
  keyMessage?: string | null;
  caption: string;
  cta?: string | null;
  hashtags?: unknown;
  visualDirection?: string | null;
  status: string;
  comments?: ReviewComment[];
  // Optional image carriers. The payload does not include assets today, so
  // every one of these is checked defensively and the block is skipped when
  // none resolve.
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  visualRefs?: Array<{ thumbnailUrl?: string | null }> | null;
}

interface ReviewMonth {
  id: string;
  month: string;
  status: string;
  posts?: ReviewPost[];
}

interface ReviewPayload {
  client: { name?: string | null; slug?: string | null; industry?: string | null; logoUrl?: string | null } | null;
  month: ReviewMonth | null;
  linkId: string;
  orgId: string;
}

class ReviewError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new ReviewError('Could not reach the server. Check your connection and try again.', 0);
  }
  const raw = await res.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!res.ok) throw new ReviewError(body?.error || `Request failed (${res.status})`, res.status);
  return body as T;
}

// "2026-07" reads as July 2026. Anything else is shown as stored.
function monthLabel(month?: string | null): string {
  if (!month) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(date?: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function hashtagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((h) => String(h)).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

function absolute(url: string): string {
  return /^(https?:|data:|blob:)/.test(url) ? url : `${getApiUrl()}${url}`;
}

function pickImage(post: ReviewPost): string | null {
  const meta = post.metadata && typeof post.metadata === 'object' && !Array.isArray(post.metadata)
    ? (post.metadata as Record<string, unknown>)
    : {};
  const candidates = [
    post.imageUrl,
    post.thumbnailUrl,
    meta.imageUrl,
    meta.thumbnailUrl,
    post.visualRefs?.[0]?.thumbnailUrl,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return absolute(c.trim());
  }
  return null;
}

export default function ReviewLink() {
  const { token = '' } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [expired, setExpired] = useState(false);
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowNote, setRowNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) {
      setExpired(true);
      setErrMsg('This link is missing its review code. Ask your account manager to resend it.');
      setState('error');
      return;
    }
    setState('loading');
    try {
      const data = await publicRequest<ReviewPayload>(`/api/review/${encodeURIComponent(token)}`);
      setPayload(data);
      setState('ready');
    } catch (e) {
      const status = e instanceof ReviewError ? e.status : 0;
      setExpired(status === 404);
      setErrMsg(
        status === 404
          ? 'This review link is no longer active. It may have expired or been replaced. Ask your account manager for a fresh link.'
          : e instanceof Error ? e.message : 'Something went wrong loading this review.',
      );
      setState('error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const rememberName = (value: string) => {
    setName(value);
    try { localStorage.setItem(NAME_KEY, value.trim()); } catch { /* private browsing */ }
  };

  const flash = (key: string, message: string) => {
    setRowNote((prev) => ({ ...prev, [key]: message }));
    setTimeout(() => setRowNote((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    }), 3000);
  };

  const clearRow = (key: string) => {
    setRowError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const run = async (key: string, action: () => Promise<void>, okMessage: string) => {
    setBusy(key);
    clearRow(key);
    try {
      await action();
      await load();
      flash(key, okMessage);
    } catch (e) {
      const status = e instanceof ReviewError ? e.status : 0;
      const message = status === 404
        ? 'This link is no longer active, so nothing was saved. Ask your account manager for a fresh link.'
        : e instanceof Error ? e.message : 'That did not save.';
      setRowError((prev) => ({ ...prev, [key]: `${message} Nothing was lost, you can try again.` }));
    } finally {
      setBusy(null);
    }
  };

  const approvePost = (postId: string) => run(
    postId,
    () => publicRequest(`/api/review/${encodeURIComponent(token)}/posts/${postId}/approve`, { method: 'POST' }),
    'Approved. The team can see it.',
  );

  const sendComment = (postId: string, status: 'note' | 'revision') => {
    const comment = (drafts[postId] || '').trim();
    const author = name.trim();
    if (!author || !comment) return;
    return run(
      postId,
      async () => {
        await publicRequest(`/api/review/${encodeURIComponent(token)}/posts/${postId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ authorName: author, comment, status }),
        });
        setDrafts((prev) => ({ ...prev, [postId]: '' }));
      },
      status === 'revision' ? 'Change request sent to the team.' : 'Comment sent to the team.',
    );
  };

  const approveMonth = () => run(
    'month',
    () => publicRequest(`/api/review/${encodeURIComponent(token)}/month/approve`, { method: 'POST' }),
    'Whole month approved.',
  );

  const shell = 'min-h-screen w-full';
  const shellStyle = { background: 'var(--color-bg)', color: 'var(--color-fg)' };

  if (state === 'loading') {
    return (
      <div className={`${shell} flex items-center justify-center`} style={shellStyle}>
        <p className="text-sm" style={{ color: 'var(--color-fg-subtle)' }}>Loading your content review...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`${shell} flex items-center justify-center p-6`} style={shellStyle}>
        <div className="max-w-md text-center">
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl mb-5"
            style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}
          >
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight mb-2">
            {expired ? 'This review link is not available' : 'We could not load this review'}
          </h1>
          <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--color-fg-muted)' }}>{errMsg}</p>
          {!expired && (
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)', outlineColor: 'var(--color-accent)' }}
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const client = payload?.client;
  const month = payload?.month;
  const posts = month?.posts ?? [];
  const approvedCount = posts.filter((p) => p.status === 'approved').length;
  const monthApproved = posts.length > 0 && approvedCount === posts.length;

  return (
    <div className={shell} style={shellStyle}>
      <header
        className="sticky top-0 z-10 px-5 py-5 sm:px-8"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="mx-auto flex max-w-4xl items-start gap-3">
          {client?.logoUrl ? (
            <img
              src={absolute(client.logoUrl)}
              alt=""
              className="h-11 w-11 rounded-xl object-cover shrink-0"
              style={{ border: '1px solid var(--color-border)' }}
            />
          ) : null}
          <div className="min-w-0 flex-1 text-start">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--color-accent)' }}>
              {client?.name || 'Content'} review
            </p>
            <h1 className="mt-1 truncate text-xl font-bold tracking-tight">{monthLabel(month?.month) || 'Content plan'}</h1>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
              {posts.length === 0
                ? 'Nothing to review yet'
                : `${posts.length} post${posts.length === 1 ? '' : 's'}, ${approvedCount} approved`}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        {posts.length === 0 ? (
          <div
            className="rounded-2xl px-6 py-14 text-center"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div
              className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
            >
              <CalendarDays className="h-5 w-5" />
            </div>
            <p className="font-semibold">This month has no posts yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
              The plan is still being put together. Keep this link, it stays valid. Your account manager will tell you
              when there is something to look at.
            </p>
            <button
              onClick={load}
              className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-fg)', outlineColor: 'var(--color-accent)' }}
            >
              <RotateCcw className="h-4 w-4" />
              Check again
            </button>
          </div>
        ) : (
          <>
            {/* Who is reviewing. Stored on this device only so the client types it once. */}
            <div
              className="mb-5 rounded-2xl p-4"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
            >
              <label htmlFor="reviewer-name" className="block text-xs font-semibold" style={{ color: 'var(--color-fg-muted)' }}>
                Your name
              </label>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                So the team knows whose feedback this is. Needed before you can comment or request changes.
              </p>
              <input
                id="reviewer-name"
                value={name}
                onChange={(e) => rememberName(e.target.value)}
                placeholder="e.g. Sara from marketing"
                className="mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-fg)',
                  outlineColor: 'var(--color-accent)',
                }}
              />
            </div>

            <ul className="space-y-4">
              {posts.map((post) => {
                const image = pickImage(post);
                const tags = hashtagList(post.hashtags);
                const comments = post.comments ?? [];
                const isApproved = post.status === 'approved';
                const working = busy === post.id;
                const draft = drafts[post.id] || '';
                const canComment = !!name.trim() && !!draft.trim() && !working;
                return (
                  <li
                    key={post.id}
                    className="overflow-hidden rounded-2xl"
                    style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-fg-muted)' }}>{dayLabel(post.date)}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                      >
                        {post.platform}
                      </span>
                      {post.format ? (
                        <span className="text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>{post.format}</span>
                      ) : null}
                      <span className="ms-auto">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                          style={isApproved
                            ? { background: 'var(--color-success-subtle)', color: 'var(--color-success)' }
                            : { background: 'var(--color-surface-hover)', color: 'var(--color-fg-subtle)' }}
                        >
                          {isApproved ? 'Approved' : 'Awaiting you'}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-col gap-4 p-4 sm:flex-row">
                      {image ? (
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          className="w-full rounded-xl object-cover sm:w-40 sm:shrink-0"
                          style={{ border: '1px solid var(--color-border)' }}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1 text-start">
                        <h2 className="text-base font-semibold leading-snug">{post.title}</h2>
                        {post.hook ? (
                          <p className="mt-1 text-sm italic" style={{ color: 'var(--color-fg-muted)' }}>{post.hook}</p>
                        ) : null}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>
                          {post.caption}
                        </p>
                        {post.cta ? (
                          <p className="mt-2 text-sm font-medium" style={{ color: 'var(--color-accent)' }}>{post.cta}</p>
                        ) : null}
                        {tags.length > 0 ? (
                          <p className="mt-2 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                            {tags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                          </p>
                        ) : null}
                        {post.visualDirection ? (
                          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--color-fg-subtle)' }}>
                            <span className="font-semibold">Visual: </span>{post.visualDirection}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {comments.length > 0 ? (
                      <div className="space-y-2 px-4 pb-3">
                        {comments.map((c) => (
                          <div key={c.id} className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-bg-sunken)' }}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{c.authorName}</span>
                              {c.status && c.status !== 'note' ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>
                                  {c.status === 'revision' ? 'Changes requested' : c.status}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-fg-muted)' }}>{c.comment}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                      <textarea
                        value={draft}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                        rows={2}
                        aria-label={`Feedback on ${post.title}`}
                        placeholder="What would you like changed, or anything you want the team to know"
                        className="mt-3 w-full resize-none rounded-xl px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={{
                          background: 'var(--color-bg-elevated)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-fg)',
                          outlineColor: 'var(--color-accent)',
                        }}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => approvePost(post.id)}
                          disabled={working || isApproved}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2"
                          style={{ background: 'var(--color-success)', color: 'var(--color-fg-on-accent)', outlineColor: 'var(--color-accent)' }}
                        >
                          <Check className="h-4 w-4" />
                          {isApproved ? 'Approved' : 'Approve'}
                        </button>
                        <button
                          onClick={() => sendComment(post.id, 'revision')}
                          disabled={!canComment}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2"
                          style={{ background: 'var(--color-warning)', color: 'var(--color-fg-on-accent)', outlineColor: 'var(--color-accent)' }}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Request changes
                        </button>
                        <button
                          onClick={() => sendComment(post.id, 'note')}
                          disabled={!canComment}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2"
                          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-fg)', outlineColor: 'var(--color-accent)' }}
                        >
                          <MessageSquare className="h-4 w-4" />
                          Comment
                        </button>
                      </div>
                      {!name.trim() ? (
                        <p className="mt-2 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                          Add your name at the top of the page to send a comment or a change request.
                        </p>
                      ) : null}
                      {rowError[post.id] ? (
                        <p className="mt-2 text-xs" style={{ color: 'var(--color-danger)' }}>{rowError[post.id]}</p>
                      ) : null}
                      {rowNote[post.id] ? (
                        <p className="mt-2 text-xs" style={{ color: 'var(--color-success)' }}>{rowNote[post.id]}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div
              className="mt-6 rounded-2xl p-4"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p className="text-sm font-semibold">Happy with everything?</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
                Approving the month marks every post above as approved in one go. You can still leave comments after.
              </p>
              <button
                onClick={approveMonth}
                disabled={busy === 'month' || monthApproved}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ background: 'var(--color-success)', color: 'var(--color-fg-on-accent)', outlineColor: 'var(--color-accent)' }}
              >
                <Check className="h-4 w-4" />
                {monthApproved ? 'Month approved' : 'Approve the whole month'}
              </button>
              {rowError.month ? (
                <p className="mt-2 text-xs" style={{ color: 'var(--color-danger)' }}>{rowError.month}</p>
              ) : null}
              {rowNote.month ? (
                <p className="mt-2 text-xs" style={{ color: 'var(--color-success)' }}>{rowNote.month}</p>
              ) : null}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs leading-relaxed" style={{ color: 'var(--color-fg-subtle)' }}>
          This is a private link from your agency. You do not need an account, and nothing here creates one.
        </p>
      </main>
    </div>
  );
}
