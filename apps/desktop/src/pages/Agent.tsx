// Agent workspace — manus-grade 3-pane shell.
// Left: SessionSidebar. Center: ChatPanel. Right: ComputerPanel.
// Session creation is LAZY — we don't persist a row until the user actually
// sends a prompt.  This stops junk "New agent session" rows from flooding
// the sidebar every time someone opens /agent.

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAgentSocket } from '../hooks/useAgentSocket';
import { useSessionHydration } from '../hooks/useSessionHydration';
import { useAgentStore, selectPhase } from '../state/agent-store';
import { useClients } from '../lib/client-context';
import SessionSidebar from '../components/agent/SessionSidebar';
import ChatPanel from '../components/agent/ChatPanel';
import ComputerPanel from '../components/agent/ComputerPanel';
import PanelErrorBoundary from '../components/agent/PanelErrorBoundary';
import { API_URL } from '../lib/api-url';

function generateDraftUid(): string {
  // crypto.randomUUID is safer than Math.random for collision-resistance in
  // multi-tab scenarios.  Keep `draft-` prefix so routing/backend still
  // detects drafts via startsWith('draft-').
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'draft-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }
  return 'draft-' + Math.random().toString(36).slice(2, 12);
}

export default function Agent() {
  const { sessionUid: routeUid } = useParams<{ sessionUid?: string }>();
  const navigate = useNavigate();
  const { selectedClientId } = useClients();
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  const setActive = useAgentStore((s) => s.setActive);
  const upsertSession = useAgentStore((s) => s.upsertSession);

  // Phase watcher — bounce the sidebar key ONLY on terminal phases so the
  // sidebar list re-fetches the updated row status.  Including 'running'
  // here used to remount SessionSidebar mid-run, stealing focus from the
  // composer textarea on every phase transition (aura-debug 2026-04-20:
  // Weni's "can't type" report).
  const phase = useAgentStore(selectPhase(routeUid ?? null));
  useEffect(() => {
    if (phase === 'complete' || phase === 'error' || phase === 'aborted') {
      setSidebarRefresh((n) => n + 1);
    }
  }, [phase]);

  // Seed a DRAFT session (client-side only, no DB row) when we land without one.
  // The real AgentSession row gets upserted by the backend on first `agent:run`.
  useEffect(() => {
    if (!routeUid) {
      const draftUid = generateDraftUid();
      upsertSession({
        uid: draftUid,
        title: 'New agent session',
        clientId: selectedClientId ?? undefined,
      });
      navigate(`/agent/${draftUid}`, { replace: true });
    }
  }, [routeUid, navigate, selectedClientId, upsertSession]);

  useEffect(() => {
    setActive(routeUid ?? null);
    if (routeUid && !routeUid.startsWith('draft-')) {
      upsertSession({ uid: routeUid, clientId: selectedClientId ?? undefined });
    }
  }, [routeUid, setActive, upsertSession, selectedClientId]);

  // Hydrate store from server state — ONLY for non-draft sessions.  Draft
  // sessions haven't been persisted yet, so there's nothing to fetch.
  useSessionHydration(routeUid && !routeUid.startsWith('draft-') ? routeUid : null);

  useAgentSocket({ sessionUid: routeUid ?? null });

  const handleSelectSession = useCallback((uid: string) => {
    navigate(`/agent/${uid}`);
  }, [navigate]);

  const handleNewSession = useCallback(() => {
    const draftUid = generateDraftUid();
    upsertSession({
      uid: draftUid,
      title: 'New agent session',
      clientId: selectedClientId ?? undefined,
    });
    navigate(`/agent/${draftUid}`);
  }, [navigate, selectedClientId, upsertSession]);

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-8 bg-zinc-950 text-white overflow-hidden">
      <div key={sidebarRefresh} className="shrink-0">
        <SessionSidebar
          activeSessionUid={routeUid ?? null}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
        />
      </div>
      <div className="flex-1 flex min-w-0">
        <div className="flex-1 min-w-0 border-r border-white/10">
          {routeUid ? (
            <PanelErrorBoundary label="ChatPanel">
              <ChatPanel sessionUid={routeUid} clientId={selectedClientId ?? undefined} />
            </PanelErrorBoundary>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              Starting session…
            </div>
          )}
        </div>
        <div className="w-[480px] shrink-0">
          {routeUid && (
            <PanelErrorBoundary label="ComputerPanel">
              <ComputerPanel sessionUid={routeUid} />
            </PanelErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export API_URL so ChatPanel can use it if needed.
export { API_URL };
