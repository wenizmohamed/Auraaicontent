/**
 * ConnectorCard — single platform tile inside the Integrations panel.
 *
 * Shows: platform logo + name + status pill + Connect/Disconnect button.
 * "Connect" navigates the browser to /api/integrations/oauth/{platform}/initiate
 * which 302s to the platform consent screen and back to the panel on success.
 */
import { useMemo } from 'react';
import { Check, Plug, AlertTriangle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { motionUI } from '../../lib/motion';
import { BrandIcon } from '../ui/BrandIcon';

export type PlatformId = 'meta_ig' | 'tiktok' | 'linkedin';

const PLATFORM_META: Record<PlatformId, { label: string; subtitle: string }> = {
  meta_ig:  { label: 'Instagram Business', subtitle: 'Native publish to your IG Business account' },
  tiktok:   { label: 'TikTok Business',    subtitle: 'Direct-post photos and videos' },
  linkedin: { label: 'LinkedIn',           subtitle: 'Personal share. Pages support coming v2' },
};

export interface PlatformConnection {
  id: string;
  platform: string;
  externalAccountName?: string | null;
  externalAccountId: string;
  status: 'connected' | 'needs_reauth' | 'revoked' | 'error';
  expiresAt?: string | null;
  lastError?: string | null;
  metadata?: Record<string, any> | null;
}

interface Props {
  platform: PlatformId;
  connection?: PlatformConnection | null;
  onConnect: () => void;
  onDisconnect: () => Promise<void> | void;
  /** True while the disconnect mutation is in flight. */
  busy?: boolean;
}

export function ConnectorCard({ platform, connection, onConnect, onDisconnect, busy }: Props) {
  const meta = PLATFORM_META[platform];
  const isConnected = connection?.status === 'connected';
  const needsReauth = connection?.status === 'needs_reauth';
  const audited = connection?.metadata?.audited !== false; // default true; explicitly false only for unaudited TikTok

  const pill = useMemo(() => {
    if (!connection) return { label: 'Not connected', tone: 'neutral' as const };
    if (needsReauth) return { label: 'Needs reauth',  tone: 'warn'    as const };
    if (connection.status === 'error')   return { label: 'Error',     tone: 'danger'  as const };
    if (connection.status === 'revoked') return { label: 'Revoked',   tone: 'danger'  as const };
    return { label: 'Connected', tone: 'success' as const };
  }, [connection, needsReauth]);

  const pillStyle = {
    success: { bg: 'var(--color-success-subtle, rgba(16,185,129,0.12))', fg: 'var(--color-success, #34d399)' },
    warn:    { bg: 'var(--color-warning-subtle, rgba(245,158,11,0.12))', fg: 'var(--color-warning, #fbbf24)' },
    danger:  { bg: 'var(--color-danger-subtle,  rgba(239,68,68,0.12))',  fg: 'var(--color-danger,  #f87171)' },
    neutral: { bg: 'var(--color-surface)',                                fg: 'var(--color-fg-muted)' },
  }[pill.tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionUI}
      whileHover={{ y: -2 }}
      className="relative flex flex-col gap-3 rounded-2xl border p-4 overflow-hidden"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: isConnected ? 'var(--color-accent)' : 'var(--color-border-subtle)',
        boxShadow: isConnected
          ? '0 0 0 1px var(--color-accent), 0 10px 30px -12px color-mix(in srgb, var(--color-accent) 40%, transparent)'
          : undefined,
      }}
    >
      {isConnected && (
        <div aria-hidden className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(circle at 100% 0%, var(--color-accent-subtle), transparent 55%)' }} />
      )}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'var(--color-bg-sunken)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <BrandIcon brand={platform} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[14px] font-semibold tracking-tight" style={{ color: 'var(--color-fg)' }}>
              {meta.label}
            </h3>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: pillStyle.bg, color: pillStyle.fg }}
            >
              {isConnected && <Check size={9} />}
              {needsReauth && <AlertTriangle size={9} />}
              {pill.label}
            </span>
          </div>
          {connection?.externalAccountName ? (
            <p className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
              {connection.externalAccountName}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
              {meta.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* TikTok-specific audit warning — surfaces the silent SELF_ONLY behaviour */}
      {platform === 'tiktok' && isConnected && !audited && (
        <p
          className="rounded-lg border px-2.5 py-1.5 text-[11px]"
          style={{
            background: 'var(--color-warning-subtle, rgba(245,158,11,0.08))',
            borderColor: 'var(--color-warning, rgba(245,158,11,0.3))',
            color: 'var(--color-fg-muted)',
          }}
        >
          TikTok hasn't audited this app yet. Published posts are only visible to you until they approve (~2-4 weeks).
        </p>
      )}

      {connection?.lastError && (needsReauth || connection.status === 'error') && (
        <p className="truncate text-[11px]" style={{ color: 'var(--color-danger, #f87171)' }} title={connection.lastError}>
          {connection.lastError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {connection ? (
          <>
            {needsReauth ? (
              <button
                onClick={onConnect}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
              >
                <Plug size={12} /> Reconnect
              </button>
            ) : null}
            <button
              onClick={() => onDisconnect()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'var(--color-bg-elevated)',
                color: 'var(--color-fg-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
          >
            <Plug size={12} /> Connect
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default ConnectorCard;
