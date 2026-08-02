/**
 * PublishConfirmDialog — final-confirmation modal before sending a post
 * to a third-party platform.
 *
 * Shows: platform brand mark + connected account name + caption preview
 * + image preview + warning that this is irreversible (Meta/TikTok/LinkedIn
 * don't support edit-after-publish via API on most surfaces).
 *
 * Pattern adapted from 21st.dev "Native Dialog" + "Card" entries scraped
 * 2026-05-03. Built on the existing Radix UI Dialog primitive (already in
 * the codebase from Phase 2 of the SOTA UI plan).
 */
import { useState } from 'react';
import { Send, X, AlertTriangle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { motionUI, motionBase } from '../../lib/motion';
import { BrandIcon, type BrandKey } from '../ui/BrandIcon';

interface PublishConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  platform: BrandKey;
  accountName?: string | null;
  caption: string;
  imageUrl?: string | null;
  /** Audited flag (currently TikTok-specific) — when false, surface the SELF_ONLY warning. */
  audited?: boolean;
}

export function PublishConfirmDialog({
  open, onClose, onConfirm, platform, accountName, caption, imageUrl, audited = true,
}: PublishConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionUI}
            onClick={busy ? undefined : onClose}
            className="fixed inset-0 z-[200]"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            aria-hidden
          />
          {/* Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-confirm-title"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={motionBase}
            className="fixed left-1/2 top-1/2 z-[201] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-subtle)',
            }}
          >
            <header
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandIcon brand={platform} size={18} title={platform} />
                <div className="min-w-0">
                  <h2 id="publish-confirm-title" className="font-display text-[15px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
                    Publish to {platform.replace('_', ' ')}
                  </h2>
                  {accountName ? (
                    <p className="truncate text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                      {accountName}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[color:var(--color-surface-hover)] disabled:opacity-40"
                style={{ color: 'var(--color-fg-subtle)' }}
              >
                <X size={14} />
              </button>
            </header>

            {imageUrl ? (
              <div
                className="aspect-square w-full overflow-hidden border-b"
                style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-sunken)' }}
              >
                <img src={imageUrl} alt="Post preview" className="h-full w-full object-cover" />
              </div>
            ) : null}

            <div className="space-y-3 p-4">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                  Caption
                </p>
                <p
                  className="whitespace-pre-wrap rounded-lg border px-2.5 py-2 text-[12px] leading-relaxed"
                  style={{
                    background: 'var(--color-surface)',
                    borderColor: 'var(--color-border-subtle)',
                    color: 'var(--color-fg)',
                    maxHeight: 160,
                    overflow: 'auto',
                  }}
                >
                  {caption}
                </p>
              </div>

              {!audited && platform === 'tiktok' ? (
                <div
                  className="flex items-start gap-2 rounded-lg border px-2.5 py-2"
                  style={{
                    background: 'var(--color-warning-subtle, rgba(245,158,11,0.08))',
                    borderColor: 'var(--color-warning, rgba(245,158,11,0.3))',
                  }}
                >
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning, #fbbf24)' }} />
                  <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                    TikTok hasn't audited this app. The post will be visible only to you until they approve (~2-4 weeks).
                  </p>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>
                  This will publish to your live account immediately. Most platforms don't support post-publish edits via API.
                </p>
              )}
            </div>

            <footer
              className="flex items-center justify-end gap-2 border-t px-4 py-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-fg-muted)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {busy ? 'Publishing…' : 'Publish now'}
              </button>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default PublishConfirmDialog;
