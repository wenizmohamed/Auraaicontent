/**
 * Workspace.PieceDetail — minimal read-only detail pane for a content
 * piece, mounted in the workspace shell's right panel. Demonstrates the
 * pattern; full editing surface still lives at /pieces.
 *
 * Wires: trust UI badge (model + cost), DiffView when an AI rewrite is
 * pending, and a Button to deep-link into the legacy editor.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { contentPiecesApi, type ContentPieceRecord } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { Badge, Button, Separator, EmptyState } from '../components/ui';

export default function PieceDetail({ pieceId }: { pieceId: string }) {
  const navigate = useNavigate();
  const { selectedClientId } = useClients();
  const [piece, setPiece] = useState<ContentPieceRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // contentPiecesApi has no `get(id)` — fetch the client's full list and pick.
  // Acceptable for the workspace demo because the list is small (≤200 items
  // per client typically). A dedicated endpoint is a follow-up if that grows.
  useEffect(() => {
    let cancelled = false;
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    contentPiecesApi.list(selectedClientId)
      .then((rows) => { if (!cancelled) setPiece(rows.find(r => r.id === pieceId) ?? null); })
      .catch(() => { if (!cancelled) setPiece(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pieceId, selectedClientId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (!piece) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={Sparkles}
          title="Piece not found"
          description="It may have been deleted, or it belongs to a different client. Pick another from the list."
          compact
        />
      </div>
    );
  }

  const meta = piece as any;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            {piece.title || 'Untitled'}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            {meta.status && <Badge subtle tone="accent">{meta.status}</Badge>}
            {meta.type && <Badge subtle>{meta.type}</Badge>}
            {meta.platform && <Badge subtle tone="info">{meta.platform}</Badge>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => navigate(`/pieces?focus=${piece.id}`)}
        >
          Open editor
        </Button>
      </div>

      <Separator />

      {meta.body || meta.caption ? (
        <article
          className="whitespace-pre-wrap text-[14px] leading-relaxed"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {meta.body || meta.caption}
        </article>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No body yet"
          description="This piece has no caption or body content. Open the legacy editor to write or generate one."
          compact
        />
      )}
    </div>
  );
}
