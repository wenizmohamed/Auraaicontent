/**
 * Workspace.StrategyDetail — read-only view for a brief or knowledge item.
 *
 * itemId encoding (set by the StrategyList in Workspace.tsx):
 *   "brief"          → render the client's brief JSON
 *   "knowledge:<id>" → render a single knowledge item
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, FileText } from 'lucide-react';
import { briefsApi, knowledgeApi, type KnowledgeItemRecord } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { Badge, Button, EmptyState, Separator } from '../components/ui';

export default function StrategyDetail({ pieceId }: { pieceId: string }) {
  const navigate = useNavigate();
  const { selectedClientId } = useClients();
  const isBrief = pieceId === 'brief';
  const knowledgeId = useMemo(() => {
    return pieceId.startsWith('knowledge:') ? pieceId.slice('knowledge:'.length) : null;
  }, [pieceId]);

  const [brief, setBrief] = useState<any>(null);
  const [item, setItem] = useState<KnowledgeItemRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    if (isBrief) {
      briefsApi.get(selectedClientId)
        .then((b) => { if (!cancelled) setBrief(b); })
        .catch(() => { if (!cancelled) setBrief(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else if (knowledgeId) {
      // Same trick as PieceDetail — knowledgeApi has no get(id).
      knowledgeApi.list(selectedClientId)
        .then((rows) => { if (!cancelled) setItem(rows.find(r => r.id === knowledgeId) ?? null); })
        .catch(() => { if (!cancelled) setItem(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [isBrief, knowledgeId, selectedClientId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (isBrief) {
    if (!brief) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            icon={FileText}
            title="No brief yet"
            description="Open the brief editor to create one for this client."
            primary={<Button onClick={() => navigate('/brief')}>Open brief editor</Button>}
          />
        </div>
      );
    }
    const entries = Object.entries(brief).filter(([, v]) => v != null && v !== '');
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
              Brief
            </h1>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
              Single source of truth for tone, audience, platforms, and campaigns.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<ExternalLink size={12} />}
            onClick={() => navigate('/brief')}
          >
            Open editor
          </Button>
        </div>
        <Separator />
        <dl className="space-y-3 text-[13px]">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-3">
              <dt className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-fg-subtle)' }}>{k}</dt>
              <dd className="whitespace-pre-wrap break-words" style={{ color: 'var(--color-fg-muted)' }}>
                {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={FileText}
          title="Knowledge item not found"
          description="It may have been removed, or it belongs to a different client."
          compact
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {item.title || 'Untitled knowledge item'}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge subtle tone="accent">{item.type}</Badge>
            {item.fileUrl && <Badge subtle tone="info">file</Badge>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => navigate('/knowledge')}
        >
          Open editor
        </Button>
      </div>
      <Separator />
      {item.textContent ? (
        <article
          className="whitespace-pre-wrap text-[14px] leading-relaxed"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {item.textContent}
        </article>
      ) : item.fileUrl ? (
        <p className="text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
          File: <a href={item.fileUrl} className="underline" target="_blank" rel="noreferrer">{item.fileUrl}</a>
        </p>
      ) : (
        <EmptyState
          icon={FileText}
          title="No content"
          description="This knowledge item has neither text nor a file attached."
          compact
        />
      )}
    </div>
  );
}
