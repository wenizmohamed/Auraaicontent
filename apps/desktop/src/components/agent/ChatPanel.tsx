import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Send, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import {
  useAgentStore,
  selectMessages,
  selectPhase,
  type AgentPhase,
} from '../../state/agent-store';
import { useStreamTail } from '../../hooks/useAgentSocket';
import { getAgentSocket } from '../../lib/socket';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8080'
    : 'http://127.0.0.1:8080');

async function promoteDraftToSession(
  title: string,
  clientId?: string,
): Promise<string> {
  const token = typeof window !== 'undefined'
    ? window.localStorage.getItem('radix_auth_token')
    : null;
  const res = await fetch(`${API_URL}/api/agent/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ title: title.slice(0, 60), clientId }),
  });
  if (!res.ok) throw new Error(`Promote failed: ${res.status}`);
  const { uid } = (await res.json()) as { uid: string };
  return uid;
}

interface ChatPanelProps {
  sessionUid: string;
  clientId?: string;
}

const PHASE_STYLES: Record<AgentPhase, { label: string; dot: string; text: string; bg: string }> = {
  idle: { label: 'Idle', dot: 'bg-zinc-500', text: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/20' },
  running: { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  aborted: { label: 'Aborted', dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  complete: { label: 'Complete', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  error: { label: 'Error', dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
};

export default function ChatPanel({ sessionUid, clientId }: ChatPanelProps) {
  const messages = useAgentStore(selectMessages(sessionUid));
  const phase = useAgentStore(selectPhase(sessionUid));
  const session = useAgentStore((s) => s.sessions[sessionUid]);
  const upsertSession = useAgentStore((s) => s.upsertSession);
  const streamTail = useStreamTail(sessionUid);
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [promoting, setPromoting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when messages change or streaming starts/ends.
  // IntersectionObserver would double cost for a small list — scrollIntoView is enough.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, phase, reduceMotion]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || phase === 'running' || promoting) return;

    // Draft session → real session: first send creates the AgentSession row
    // on the backend and swaps the URL from draft-xxx to the real uid.
    let realUid = sessionUid;
    if (sessionUid.startsWith('draft-')) {
      setPromoting(true);
      try {
        realUid = await promoteDraftToSession(text, clientId);
        upsertSession({ uid: realUid, title: text.slice(0, 60), clientId });
        navigate(`/agent/${realUid}`, { replace: true });
      } catch (err) {
        console.error('[ChatPanel] promote failed:', err);
        setPromoting(false);
        return;
      }
      setPromoting(false);
    }

    const socket = getAgentSocket();
    // Join first so we don't miss the early events while useAgentSocket's
    // effect is still reconciling on the new sessionUid.
    socket.emit('session:join', { sessionUid: realUid });
    socket.emit('agent:run', { sessionUid: realUid, input: text, clientId });
    setInput('');
  }, [input, phase, sessionUid, clientId, promoting, upsertSession, navigate]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const phaseStyle = PHASE_STYLES[phase];
  const title = session?.title ?? 'New session';
  const fadeUp = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const } };

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950">
      {/* Header strip */}
      <div className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
          <span className="text-[10px] text-zinc-600 tabular-nums">{sessionUid.slice(0, 8)}</span>
        </div>
        <div className={clsx('inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-medium', phaseStyle.bg, phaseStyle.text)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', phaseStyle.dot, phase === 'running' && 'animate-pulse')} />
          {phaseStyle.label}
        </div>
      </div>

      {/* Messages list */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
        {messages.length === 0 && phase !== 'running' ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <p className="text-lg font-semibold text-white mb-2">Ready when you are</p>
            <p className="text-sm text-zinc-500 max-w-sm">
              Ask the agent to plan a campaign, generate pieces, or research competitors.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <motion.div
              key={m.id}
              {...fadeUp}
              className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={clsx(
                  'max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words',
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white/[0.04] text-white border border-white/10 rounded-bl-sm',
                )}
              >
                {m.text}
              </div>
            </motion.div>
          ))
        )}

        {/* Streaming tail — only rendered while running. Mutated directly via ref. */}
        {phase === 'running' && (
          <motion.div {...fadeUp} className="flex justify-start">
            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-white/[0.04] text-white border border-white/10 text-sm leading-relaxed">
              <div ref={streamTail.ref} className="whitespace-pre-wrap break-words min-h-[1.25rem]" />
              <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin inline-block mt-1" />
            </div>
          </motion.div>
        )}

        {phase === 'error' && session?.error && (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {session.error}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="h-[88px] shrink-0 border-t border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="h-full flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the agent — Shift+Enter for newline"
            rows={2}
            className="flex-1 h-full resize-none bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06] transition-colors"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={phase === 'running' || !input.trim()}
            className={clsx(
              'h-full px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all',
              phase === 'running' || !input.trim()
                ? 'bg-white/[0.04] text-zinc-600 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-[0.98]',
            )}
          >
            {phase === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
