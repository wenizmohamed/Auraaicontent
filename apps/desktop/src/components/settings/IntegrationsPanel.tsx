/**
 * IntegrationsPanel — Settings → Integrations surface.
 *
 * Shows a grid of ConnectorCard tiles (one per supported platform) for the
 * currently-selected client. Connect 302s through /api/integrations/oauth/...
 * and the platform's consent screen, returning to ?connected=<platform>.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plug, Loader2 } from 'lucide-react';
import { useClients } from '../../lib/client-context';
import { integrationsApi, type IntegrationSummary, type SupportedPlatform } from '../../lib/backend-api';
import { ConnectorCard, type PlatformId } from './ConnectorCard';

export function IntegrationsPanel() {
  const { clients, currentClient, setSelectedClientId } = useClients();
  const [params, setParams] = useSearchParams();
  const clientId = currentClient?.id || clients[0]?.id;
  const [supported, setSupported] = useState<SupportedPlatform[]>([]);
  const [connections, setConnections] = useState<IntegrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) { setConnections([]); setSupported([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await integrationsApi.list(clientId);
      setSupported(r.supported);
      setConnections(r.connections);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Surface the OAuth callback toast if we just landed back from a provider.
  useEffect(() => {
    const connected = params.get('connected');
    if (connected) {
      toast.success(`${connected.replace('_', ' ')} connected`);
      const next = new URLSearchParams(params);
      next.delete('connected');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  function connect(platform: PlatformId) {
    if (!clientId) {
      toast.error('Pick a client first');
      return;
    }
    integrationsApi.initiate(platform, clientId);
  }

  async function disconnect(connectionId: string) {
    if (!confirm('Disconnect this account? Existing scheduled publishes will fail until reconnected.')) return;
    setBusyId(connectionId);
    try {
      await integrationsApi.revoke(connectionId);
      toast.success('Disconnected');
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Disconnect failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[20px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            Integrations
          </h1>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--color-fg-muted)' }}>
            Connect your platforms once and Radix can publish drafted posts directly from the calendar.
          </p>
        </div>

        {clients.length > 1 && (
          <select
            value={clientId || ''}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-[12px]"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-fg)',
            }}
            aria-label="Pick which client to connect platforms for"
          >
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {!clientId ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
        >
          <Plug className="mx-auto h-6 w-6" style={{ color: 'var(--color-fg-subtle)' }} />
          <p className="mt-3 text-[13px]" style={{ color: 'var(--color-fg-muted)' }}>
            Create a client first — integrations are scoped per brand.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {supported.map((s) => {
            const conn = connections.find(c => c.platform === s.id) || null;
            return (
              <ConnectorCard
                key={s.id}
                platform={s.id as PlatformId}
                connection={conn as any}
                onConnect={() => connect(s.id as PlatformId)}
                onDisconnect={() => conn ? disconnect(conn.id) : Promise.resolve()}
                busy={conn ? busyId === conn.id : false}
              />
            );
          })}
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'var(--color-fg-subtle)' }}>
        Tokens are encrypted at rest. Disconnecting revokes the stored credentials immediately.
      </p>
    </div>
  );
}

export default IntegrationsPanel;
