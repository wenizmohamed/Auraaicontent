/**
 * PublishButton — kicks off a platform publish for an approved CalendarPost.
 *
 * Disabled when:
 *   - post.status !== 'approved'
 *   - no connected PlatformConnection for the post's platform on the client
 *
 * Click → POST /api/calendar-posts/:postId/publish → background job; we poll
 * /api/jobs/:jobId every 3s for up to ~3min. On success, surface the platform
 * post URL via toast + a green check on the button.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { publishApi, jobsApi } from '../../lib/backend-api';
import { PublishConfirmDialog } from './PublishConfirmDialog';

interface Props {
  postId: string;
  postStatus: string;
  /** 'meta_ig' | 'tiktok' | 'linkedin' — the platform to publish to. */
  platform: 'meta_ig' | 'tiktok' | 'linkedin';
  /** Pre-loaded publish status (from CalendarPost.platformPublishStatus[platform]). */
  publishedStatus?: { status?: string; url?: string; externalId?: string; publishedAt?: string; error?: string } | null;
  /** True if a connection for this platform exists on the client. */
  hasConnection: boolean;
  /** Optional context fed into the confirmation dialog preview. */
  caption?: string;
  imageUrl?: string | null;
  accountName?: string | null;
  /** TikTok-specific — drives the unaudited SELF_ONLY warning. */
  audited?: boolean;
  /** Called after a successful publish so the parent can re-fetch the post. */
  onPublished?: () => void;
  /** Compact icon-only variant for tight surfaces (calendar tile). */
  compact?: boolean;
}

export function PublishButton({
  postId, postStatus, platform, publishedStatus, hasConnection,
  caption, imageUrl, accountName, audited = true, onPublished, compact,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => () => { cancelRef.current = true; }, []);

  const isPublished = publishedStatus?.status === 'published';
  const lastError   = publishedStatus?.status === 'error' ? publishedStatus.error : undefined;
  const liveUrl     = publishedStatus?.url;

  const disabled = busy || isPublished || postStatus !== 'approved' || !hasConnection;
  const tooltip =
    isPublished               ? 'Published — click ↗ to open' :
    postStatus !== 'approved' ? 'Approve the post before publishing' :
    !hasConnection            ? `Connect ${platform.replace('_', ' ')} in Settings → Integrations first` :
                                'Publish to ' + platform.replace('_', ' ');

  function openConfirm() {
    if (disabled) return;
    setDialogOpen(true);
  }

  async function publish() {
    setDialogOpen(false);
    setBusy(true);
    cancelRef.current = false;
    try {
      const { jobId } = await publishApi.publish(postId, platform);
      // Poll
      for (let i = 0; i < 60; i++) {
        if (cancelRef.current) return;
        await new Promise(r => setTimeout(r, 3000));
        const job = await jobsApi.get(jobId);
        if (job.status === 'completed') {
          const url = (job.result as any)?.url;
          toast.success(`Published${url ? ' — opening…' : ''}`);
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
          onPublished?.();
          return;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Publish failed on server');
        }
      }
      throw new Error('Publish timed out after 3 minutes');
    } catch (err: any) {
      toast.error(err?.message || 'Publish failed');
    } finally {
      if (!cancelRef.current) setBusy(false);
    }
  }

  if (isPublished && liveUrl) {
    return (
      <a
        href={liveUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className={`inline-flex items-center gap-1.5 rounded-lg ${compact ? 'h-7 w-7 justify-center' : 'px-2.5 py-1.5'} text-[11px] font-medium transition-colors`}
        style={{
          background: 'var(--color-success-subtle, rgba(16,185,129,0.12))',
          color: 'var(--color-success, #34d399)',
        }}
      >
        <Check className="h-3 w-3" />
        {!compact && (<>Published <ExternalLink className="h-2.5 w-2.5 opacity-70" /></>)}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openConfirm}
        disabled={disabled}
        title={tooltip}
        aria-label={tooltip}
        className={`inline-flex items-center gap-1.5 rounded-lg ${compact ? 'h-7 w-7 justify-center' : 'px-2.5 py-1.5'} text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed`}
        style={{
          background: lastError ? 'var(--color-danger-subtle, rgba(239,68,68,0.12))' : 'var(--color-accent)',
          color: lastError ? 'var(--color-danger, #f87171)' : 'var(--color-fg-on-accent)',
        }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : lastError ? <AlertCircle className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        {!compact && (busy ? 'Publishing…' : lastError ? 'Retry' : 'Publish now')}
      </button>
      <PublishConfirmDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={publish}
        platform={platform}
        accountName={accountName}
        caption={caption || ''}
        imageUrl={imageUrl}
        audited={audited}
      />
    </>
  );
}

export default PublishButton;
