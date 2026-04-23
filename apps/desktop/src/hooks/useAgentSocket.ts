// Headless socket orchestrator: the ONE place events hit the store.
// Mount at the top of the /agent route so every child sees consistent state
// via Zustand selectors — no prop drilling, no context re-render storm.

import { useEffect, useRef } from 'react';
import { getAgentSocket, type AgentSocket } from '../lib/socket';
import { useAgentStore, generateMessageId } from '../state/agent-store';
import type { AgentEventPayloads } from '../lib/agent-events';

interface Options {
  sessionUid: string | null;
}

export function useAgentSocket({ sessionUid }: Options): AgentSocket | null {
  const socketRef = useRef<AgentSocket | null>(null);
  const store = useAgentStore;

  useEffect(() => {
    if (!sessionUid) return;

    const socket = getAgentSocket();
    socketRef.current = socket;

    const join = () => socket.emit('session:join', { sessionUid });
    if (socket.connected) join();
    else socket.once('connect', join);

    const onStart = (p: AgentEventPayloads['agent:start']) => {
      store.getState().pushMessage(sessionUid, {
        id: generateMessageId(),
        role: 'user',
        text: p.input,
        createdAt: p.at,
      });
      store.getState().setPhase(sessionUid, 'running');
    };

    const onThought = (p: AgentEventPayloads['agent:thought']) => {
      store.getState().pushThought(sessionUid, {
        id: generateMessageId(),
        text: p.text,
        at: p.at,
      });
    };

    const onToolStart = (p: AgentEventPayloads['agent:tool_start']) => {
      store.getState().pushToolStart(sessionUid, p);
    };

    const onToolResult = (p: AgentEventPayloads['agent:tool_result']) => {
      store.getState().pushToolResult(sessionUid, p);
    };

    const onArtifact = (p: AgentEventPayloads['agent:artifact']) => {
      store.getState().pushArtifact(sessionUid, p);
    };

    const onMessage = (p: AgentEventPayloads['agent:message']) => {
      // Non-streaming (finalized) messages land in the store; streamed deltas
      // are handled by useStreamEvent at the component level.
      if (!p.streaming) {
        store.getState().pushMessage(sessionUid, {
          id: generateMessageId(),
          role: 'assistant',
          text: p.text,
          createdAt: p.at,
        });
      }
    };

    const onComplete = (p: AgentEventPayloads['agent:complete']) => {
      // Do NOT push summary here — the server already emits the finalized
      // `agent:message` (streaming=false) which onMessage turns into the
      // assistant bubble.  Duplicate push produces two identical bubbles.
      store.getState().setPhase(sessionUid, 'complete');
      void p;
    };

    const onError = (p: AgentEventPayloads['agent:error']) => {
      store.getState().setPhase(
        sessionUid,
        p.message.toLowerCase().includes('abort') ? 'aborted' : 'error',
        p.message,
      );
    };

    socket.on('agent:start', onStart);
    socket.on('agent:thought', onThought);
    socket.on('agent:tool_start', onToolStart);
    socket.on('agent:tool_result', onToolResult);
    socket.on('agent:artifact', onArtifact);
    socket.on('agent:message', onMessage);
    socket.on('agent:complete', onComplete);
    socket.on('agent:error', onError);

    return () => {
      socket.off('agent:start', onStart);
      socket.off('agent:thought', onThought);
      socket.off('agent:tool_start', onToolStart);
      socket.off('agent:tool_result', onToolResult);
      socket.off('agent:artifact', onArtifact);
      socket.off('agent:message', onMessage);
      socket.off('agent:complete', onComplete);
      socket.off('agent:error', onError);
      socket.emit('session:leave', { sessionUid });
    };
  }, [sessionUid, store]);

  return socketRef.current;
}

// Ref-backed stream tail — returns a callback that registers a DOM node for
// direct textContent mutation on streamed deltas.  Bypasses React reconciler
// to keep 20hz token updates from thrashing the tree.
export function useStreamTail(sessionUid: string | null) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const bufferRef = useRef<string>('');

  useEffect(() => {
    if (!sessionUid) return;
    const socket = getAgentSocket();
    const onMessage = (p: AgentEventPayloads['agent:message']) => {
      if (!p.streaming) {
        // Flush on finalize — the store adds a proper message; clear tail.
        bufferRef.current = '';
        if (nodeRef.current) nodeRef.current.textContent = '';
        return;
      }
      bufferRef.current += p.text;
      if (nodeRef.current) nodeRef.current.textContent = bufferRef.current;
    };
    socket.on('agent:message', onMessage);
    return () => {
      socket.off('agent:message', onMessage);
    };
  }, [sessionUid]);

  return {
    ref: (el: HTMLElement | null) => { nodeRef.current = el; },
    clear: () => {
      bufferRef.current = '';
      if (nodeRef.current) nodeRef.current.textContent = '';
    },
  };
}
