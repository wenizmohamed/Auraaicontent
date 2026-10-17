import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, Trash2, MessageSquare, AlertCircle, Zap, Search, FileText, Calendar, Image as ImageIcon, ExternalLink, Copy, RefreshCw, Check, Sparkles, Quote, Brain, ChevronDown, Palette, Database, Lightbulb, Languages, Scissors, Shuffle, Maximize2, Minimize2, Plus, StopCircle, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { io, type Socket } from 'socket.io-client';
import { assistantApi, agentApi, getApiUrl, type ChatMessage, type AgentTemplateSummary } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useNavigate } from 'react-router-dom';
import { Z } from '../lib/z-index';
import { ThinkingIndicator } from '../components/ui/ThinkingIndicator';
import { motionUI } from '../lib/motion';
import { usePersistentDraft } from '../lib/use-persistent-draft';

interface ActionResult {
  type: string;
  params: Record<string, any>;
  result: any;
}

interface Citation {
  title: string;
  url?: string;
  /** Optional source kind so the bubble can pick an icon. */
  kind?: 'knowledge' | 'web' | 'brief' | 'asset';
  /** Relevance score 0..1; not all backends return this. */
  score?: number;
}

interface EnrichedMessage extends ChatMessage {
  action?: ActionResult;
  /** Trust UI — model that generated this message. */
  provider?: string;
  /** Trust UI — round-trip latency in ms. */
  latencyMs?: number;
  /** RAG sources / web citations cited by this reply, if the backend returned them. */
  citations?: Citation[];
  /** Optional chain-of-thought / reasoning trace. Hidden behind a toggle. */
  reasoning?: string;
  /** Agent run: the tool activity timeline attached to the final reply. */
  steps?: AgentToolStep[];
  /** Agent run: why the run stopped early, when it did. */
  runError?: string;
}

// ─── Agent run stream (Socket.IO /agent namespace) ───────────────────
// Mirrors the server contract in server/src/realtime/events.ts: the loop
// emits agent:start / agent:message (text deltas) / agent:tool_start /
// agent:tool_result / agent:complete / agent:error into the room keyed by
// sessionUid. The client joins with session:join and starts a run with
// agent:run. This consumes the REAL loop (server/src/agent/loop.ts), not a
// parallel implementation.

interface AgentToolStep {
  /** toolCallId from the loop; pairs tool_start with tool_result. */
  id: string;
  tool: string;
  status: 'running' | 'done' | 'failed';
  /** One-line human summary of the result (never raw JSON). */
  summary?: string;
  /** Failure detail when status is failed. */
  error?: string;
  /** In-app destination where the persisted output can be seen. */
  link?: { to: string; label: string };
}

interface AgentRunView {
  sessionUid: string;
  phase: 'connecting' | 'running';
  /** Streamed narrative text accumulated from agent:message deltas. */
  text: string;
  steps: AgentToolStep[];
  /** Client the run was started for, captured at start so the once-registered
   * socket handlers never read a stale selectedClientId. */
  clientId?: string | null;
}

/** Plain-language labels for tool activity. Unknown tools fall back to the
 * de-underscored tool name so new tools degrade gracefully. */
const TOOL_LABELS: Record<string, string> = {
  brief_analyze: 'Reading the brief',
  pieces_generate: 'Creating posts',
  calendar_plan: 'Building the calendar',
  calendar_read: 'Reading the calendar',
  caption_write: 'Writing captions',
  hashtag_research: 'Researching hashtags',
  compliance_check: 'Checking compliance',
  client_switch: 'Switching client',
  image_generate: 'Generating an image',
  competitor_scrape: 'Scanning competitors',
  visual_search: 'Finding reference visuals',
  asset_search: 'Searching brand assets',
  web_research: 'Researching the web',
  post_schedule: 'Scheduling the post',
  brief_save: 'Saving the brief',
  video_generate: 'Generating a video',
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ');
}

/** Detect a soft failure: the handler returned normally but reported it
 * could not do the job (post_schedule {scheduled:false}, web_research
 * {error}, ...). compliance_check passed:false is a finding, not a failure. */
function resultFailure(result: unknown): string | null {
  if (result == null || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.error === 'string' && r.error) return r.error;
  if (r.ok === false || r.scheduled === false) return 'The tool reported it could not finish';
  return null;
}

/** One-line human summary of a successful tool result. Never raw JSON. */
function summarizeToolResult(tool: string, result: unknown): string {
  if (result == null) return 'Done';
  if (typeof result === 'string') return result.slice(0, 140);
  const r = result as Record<string, any>;
  switch (tool) {
    case 'pieces_generate': {
      const n = Array.isArray(r.pieces) ? r.pieces.length : Array.isArray(r.postIds) ? r.postIds.length : 0;
      return r.calendarMonthId ? `${n} posts drafted and saved to the calendar` : `${n} posts drafted`;
    }
    case 'calendar_plan': {
      const n = Array.isArray(r.postIds) ? r.postIds.length : 0;
      return `Calendar built with ${n} posts placed across the month`;
    }
    case 'calendar_read': {
      if (Array.isArray(r.posts)) return `${r.totalPosts ?? r.posts.length} posts read from ${r.month || 'the month'}`;
      if (Array.isArray(r.months)) return `${r.months.length} months found on the calendar`;
      return 'Calendar read';
    }
    case 'caption_write':
      return r.persistedPostId ? 'Caption written and saved to the post' : 'Caption drafted';
    case 'post_schedule':
      return r.scheduledAt ? `Scheduled for ${new Date(r.scheduledAt).toLocaleString()}` : 'Post scheduled';
    case 'compliance_check': {
      const n = Array.isArray(r.issues) ? r.issues.length : 0;
      return r.passed ? 'Passed the compliance check' : `${n} compliance issue${n === 1 ? '' : 's'} found`;
    }
    case 'hashtag_research': {
      const n = Array.isArray(r.hashtags) ? r.hashtags.length : 0;
      return r.persistedPostId ? `${n} hashtags researched and merged into the post` : `${n} hashtags researched`;
    }
    case 'brief_analyze':
      return `Brief read${r.clientName ? ` for ${r.clientName}` : ''}${typeof r.knowledgeItemCount === 'number' ? ` with ${r.knowledgeItemCount} knowledge items` : ''}`;
    case 'asset_search': {
      const n = typeof r.total === 'number' ? r.total : Array.isArray(r.assets) ? r.assets.length : 0;
      return `${n} matching brand asset${n === 1 ? '' : 's'} found`;
    }
    case 'web_research': {
      const f = Array.isArray(r.findings) ? r.findings.length : 0;
      const s = Array.isArray(r.sources) ? r.sources.length : 0;
      return `${f} finding${f === 1 ? '' : 's'} from ${s} source${s === 1 ? '' : 's'}`;
    }
    case 'visual_search': {
      const n = Array.isArray(r.results) ? r.results.length : 0;
      return `${n} reference visual${n === 1 ? '' : 's'} found`;
    }
    case 'image_generate':
      return r.url ? 'Image generated and saved to the gallery' : 'Image generated';
    case 'video_generate':
      return r.url ? 'Video generated and saved to History' : 'Video generated';
    case 'brief_save':
      return r.created ? 'Brief created and saved' : 'Brief updated';
    case 'competitor_scrape': {
      const n = Array.isArray(r.handles) ? r.handles.length : 0;
      return `${n} competitor profile${n === 1 ? '' : 's'} scanned`;
    }
    default: {
      if (typeof r.summary === 'string' && r.summary) return r.summary.slice(0, 140);
      if (typeof r.note === 'string' && r.note) return r.note.slice(0, 140);
      return 'Done';
    }
  }
}

/** Where to see what the run persisted. Only tools that write return a link
 * (the app's core contract: the user should never have to guess). */
function linkForStep(tool: string, result: unknown, clientId?: string | null): { to: string; label: string } | undefined {
  const r = (result ?? {}) as Record<string, any>;
  const q = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
  switch (tool) {
    case 'calendar_plan':
      return { to: `/calendar${q}`, label: 'Open the calendar' };
    case 'pieces_generate':
      return r.calendarMonthId ? { to: `/calendar${q}`, label: 'Open the calendar' } : undefined;
    case 'post_schedule':
      return r.scheduled ? { to: `/calendar${q}`, label: 'Open the calendar' } : undefined;
    case 'caption_write':
    case 'compliance_check':
    case 'hashtag_research':
      return r.persistedPostId ? { to: '/content-review', label: 'See it in Content Review' } : undefined;
    case 'image_generate':
      return r.assetId || r.url ? { to: '/gallery', label: 'Open the gallery' } : undefined;
    case 'video_generate':
      return r.url ? { to: '/history', label: 'Open History' } : undefined;
    case 'brief_save':
      return r.briefId ? { to: `/brief${q}`, label: 'Open the brief' } : undefined;
    default:
      return undefined;
  }
}

function newSessionUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 22);
}

/**
 * Provider tier colors for the model chip. Using token-derived rgba so the
 * chip recolors with the active theme instead of hardcoded hex.
 */
const PROVIDER_TIERS: Record<string, { label: string; tint: string; ring: string }> = {
  gemini:    { label: 'Gemini',  tint: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', ring: 'var(--color-accent)' },
  google:    { label: 'Gemini',  tint: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', ring: 'var(--color-accent)' },
  grok:      { label: 'Grok',    tint: 'color-mix(in srgb, var(--color-fg) 8%, transparent)',     ring: 'var(--color-fg-muted)' },
  xai:       { label: 'Grok',    tint: 'color-mix(in srgb, var(--color-fg) 8%, transparent)',     ring: 'var(--color-fg-muted)' },
  kimi:      { label: 'Kimi',    tint: 'color-mix(in srgb, var(--color-fg) 6%, transparent)',     ring: 'var(--color-fg-subtle)' },
  moonshot:  { label: 'Kimi',    tint: 'color-mix(in srgb, var(--color-fg) 6%, transparent)',     ring: 'var(--color-fg-subtle)' },
};

// ─── Conversation persistence ────────────────────────────────────────
// The transcript lived only in React state, so a refresh wiped the whole
// conversation and both modes lost their context (the agent is sent these
// turns as its memory). It is now saved to localStorage per signed-in user and
// org, restored on load, and an agent run that was still working when the page
// reloaded is picked back up from the server.

interface PendingRun {
  sessionUid: string;
  clientId?: string | null;
  startedAt: number;
}

/** A chat-mode reply still being generated. The server keeps the finished
 * reply under this turn id, so a reload can collect it. */
interface PendingChat {
  turnId: string;
  startedAt: number;
}

interface StoredConversation {
  v: 1;
  messages: EnrichedMessage[];
  mode: 'chat' | 'agent';
  pendingRun?: PendingRun | null;
  pendingChat?: PendingChat | null;
  /** ms timestamp of the last change. The copy with the higher value wins
   * between this browser and the server (another tab or device). */
  rev?: number;
}

const CONVERSATION_PREFIX = 'radix.assistant.conversation.v1.';
const MAX_STORED_MESSAGES = 80;
const MAX_STORED_CHARS = 600_000; // well inside the ~5 MB localStorage quota
const RESUME_WINDOW_MS = 30 * 60 * 1000; // a run older than this is not resumed
const CHAT_RESUME_WINDOW_MS = 5 * 60 * 1000; // a chat reply is collected for this long
const SERVER_SAVE_DEBOUNCE_MS = 800;

function newTurnId(): string {
  return `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Storage key scoped to the signed-in user and org, read from the auth token. */
function conversationKey(): string | null {
  try {
    const token = localStorage.getItem('radix_auth_token');
    const part = token?.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { userId?: string; orgId?: string };
    if (!payload.userId) return null;
    return `${CONVERSATION_PREFIX}${payload.orgId || 'org'}.${payload.userId}`;
  } catch {
    return null;
  }
}

function loadConversation(): StoredConversation | null {
  const key = conversationKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConversation;
    if (parsed?.v !== 1 || !Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages.filter(
      m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    );
    return {
      v: 1, messages, mode: parsed.mode === 'agent' ? 'agent' : 'chat',
      pendingRun: parsed.pendingRun ?? null, pendingChat: parsed.pendingChat ?? null,
      rev: typeof parsed.rev === 'number' ? parsed.rev : 0,
    };
  } catch {
    return null;
  }
}

type ConversationState = {
  messages: EnrichedMessage[];
  mode: 'chat' | 'agent';
  pendingRun: PendingRun | null;
  pendingChat: PendingChat | null;
  rev: number;
};

/** Trim to the storage budget (oldest turns go first). Returns what is saved
 * both locally and on the server, so the two copies are identical. */
function packConversation(state: ConversationState): StoredConversation {
  let messages = state.messages.slice(-MAX_STORED_MESSAGES);
  const pack = (): StoredConversation => ({
    v: 1, messages, mode: state.mode, pendingRun: state.pendingRun, pendingChat: state.pendingChat, rev: state.rev,
  });
  while (JSON.stringify(pack()).length > MAX_STORED_CHARS && messages.length > 2) {
    messages = messages.slice(Math.ceil(messages.length / 4));
  }
  return pack();
}

function saveConversation(packed: StoredConversation): void {
  const key = conversationKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(packed));
  } catch {
    // Storage blocked or full: the server copy still holds the conversation.
  }
}

export default function RadixAssistant() {
  const navigate = useNavigate();
  const { selectedClientId, currentClient, fetchClients, setSelectedClientId } = useClients();
  // Reopen after a refresh if it was open, so the restored conversation is in view.
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem('radix.assistant.open') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('radix.assistant.open', open ? '1' : '0'); } catch { /* storage blocked */ }
  }, [open]);
  const [expanded, setExpanded] = useState(false); // focus mode. Larger panel for agent runs
  // Restored once, on first render, from the last saved conversation.
  const restoredRef = useRef<StoredConversation | null | undefined>(undefined);
  if (restoredRef.current === undefined) restoredRef.current = loadConversation();
  const [messages, setMessages] = useState<EnrichedMessage[]>(() => restoredRef.current?.messages ?? []);
  // Draft survives refresh — the prompt you were typing is restored on reload.
  const [input, setInput] = usePersistentDraft('assistant.input', '');
  // Multimodal attachments for the next turn (images go to the vision model;
  // docs/video noted in text for now).
  const [attachments, setAttachments] = useState<{ dataUrl: string; mimeType: string; name: string; kind: 'image' | 'video' | 'doc' }[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null); // aborts the in-flight run (Stop)

  // ── Agent mode ──────────────────────────────────────────────────
  // 'chat' = the existing single-turn assistant (actions + citations).
  // 'agent' = the real multi-step tool loop streamed over Socket.IO.
  const [mode, setMode] = useState<'chat' | 'agent'>(() => restoredRef.current?.mode ?? 'chat');
  // The agent run in flight, if any. Saved so a reload can pick it back up.
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(() => restoredRef.current?.pendingRun ?? null);
  // The chat reply in flight, if any (see PendingChat).
  const [pendingChat, setPendingChat] = useState<PendingChat | null>(() => restoredRef.current?.pendingChat ?? null);
  const revRef = useRef<number>(restoredRef.current?.rev ?? 0);
  const firstSaveRef = useRef(true); // the mount pass is a restore, not a change
  const fromServerRef = useRef(false); // the next save pass applies a server copy as-is
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatResumeStopRef = useRef(false); // Stop or Clear pressed while collecting a reply
  const [agentRun, setAgentRun] = useState<AgentRunView | null>(null);
  const agentRunRef = useRef<AgentRunView | null>(null); // socket handlers read the live value
  const agentSocketRef = useRef<Socket | null>(null);
  const agentSessionRef = useRef<string | null>(null);
  const breakAfterToolRef = useRef(false); // paragraph break between iterations
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, agentRun]);

  // Save the conversation on every change: to this browser at once, and to the
  // server shortly after so it is there on any other device.
  useEffect(() => {
    if (firstSaveRef.current) { firstSaveRef.current = false; return; }
    const adopted = fromServerRef.current;
    fromServerRef.current = false;
    if (!adopted) revRef.current = Date.now();
    const packed = packConversation({ messages, mode, pendingRun, pendingChat, rev: revRef.current });
    saveConversation(packed);
    if (adopted) return; // it came from the server; nothing to send back
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(() => {
      assistantApi.saveConversation(packed, packed.rev ?? 0).catch(() => { /* offline: the local copy stands */ });
    }, SERVER_SAVE_DEBOUNCE_MS);
  }, [messages, mode, pendingRun, pendingChat]);

  // Load the server copy on open and whenever the tab regains focus. Whichever
  // side changed last wins: a newer server copy (another device or tab)
  // replaces what is on screen, a newer local copy is pushed up.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (agentRunRef.current || abortRef.current) return; // never swap the transcript mid-answer
      try {
        const remote = await assistantApi.getConversation();
        if (cancelled || agentRunRef.current || abortRef.current) return;
        const data = remote.data as StoredConversation | null;
        if (data && Array.isArray(data.messages) && remote.rev > revRef.current) {
          revRef.current = remote.rev;
          fromServerRef.current = true;
          setMessages(data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'));
          setMode(data.mode === 'agent' ? 'agent' : 'chat');
        } else if (revRef.current > remote.rev || !data) {
          // Local is newer, or the server has nothing yet (a conversation from
          // before server saving existed): push this browser's copy up.
          const local = loadConversation();
          if (local && local.messages.length > 0) {
            if (!revRef.current) revRef.current = Date.now();
            assistantApi.saveConversation({ ...local, rev: revRef.current }, revRef.current).catch(() => {});
          }
        }
      } catch {
        // Offline or signed out: carry on with the local copy.
      }
    };
    sync();
    const onFocus = () => { sync(); };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  // Collect a chat-mode reply that was still being generated when the page
  // reloaded. The request died with the old page, but the server finished the
  // answer and kept it under the turn id.
  useEffect(() => {
    const pending = restoredRef.current?.pendingChat;
    if (!pending) return;
    if (Date.now() - pending.startedAt > CHAT_RESUME_WINDOW_MS) { setPendingChat(null); return; }
    let stopped = false;
    chatResumeStopRef.current = false;
    setLoading(true);
    const deadline = Date.now() + 150 * 1000;
    const tick = async () => {
      if (stopped || chatResumeStopRef.current) return;
      try {
        const out = await assistantApi.getTurn(pending.turnId);
        if (stopped || chatResumeStopRef.current) return;
        if (out.ready && out.turn) {
          const turn = out.turn;
          if (turn.message) {
            const action = turn.action as ActionResult | undefined;
            setMessages(prev => [...prev, { ...turn.message!, action, provider: turn.provider, latencyMs: turn.latencyMs }]);
            if (action?.type === 'create_client' && action.result?.id) fetchClients().catch(() => {});
          } else {
            setError(turn.error || 'Chat failed');
          }
          setPendingChat(null);
          setLoading(false);
          return;
        }
      } catch {
        // network blip: keep trying until the deadline
      }
      if (Date.now() > deadline) {
        setPendingChat(null);
        setLoading(false);
        setError('That reply did not finish before the page reloaded. Send it again');
        return;
      }
      setTimeout(tick, 2000);
    };
    tick();
    return () => { stopped = true; };
    // Runs once on mount by design: it collects whatever was pending before the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up an agent run that was still working when the page reloaded. The
  // run keeps going server-side regardless of the browser, so poll its session
  // until it finishes, rebuilding the activity timeline from the stored events.
  useEffect(() => {
    const pending = restoredRef.current?.pendingRun;
    if (!pending) return;
    if (Date.now() - pending.startedAt > RESUME_WINDOW_MS) { setPendingRun(null); return; }
    let stopped = false;
    const run: AgentRunView = { sessionUid: pending.sessionUid, phase: 'running', text: '', steps: [], clientId: pending.clientId };
    agentRunRef.current = run;
    agentSessionRef.current = pending.sessionUid;
    setAgentRun(run);
    setLoading(true);
    const deadline = Date.now() + 15 * 60 * 1000;
    let misses = 0; // consecutive failed lookups (the run may never have started)
    const tick = async () => {
      if (stopped || agentRunRef.current?.sessionUid !== pending.sessionUid) return;
      try {
        const { session } = await agentApi.getSession(pending.sessionUid);
        if (stopped || agentRunRef.current?.sessionUid !== pending.sessionUid) return;
        const steps: AgentToolStep[] = [];
        let text = '';
        let errorMessage: string | undefined;
        for (const ev of session.events) {
          const p = (ev.payload ?? {}) as Record<string, any>;
          if (ev.type === 'agent:message' && typeof p.text === 'string') text += p.text;
          else if (ev.type === 'agent:tool_start') steps.push({ id: p.toolCallId, tool: p.tool, status: 'running' });
          else if (ev.type === 'agent:tool_result') {
            const st = steps.find(x => x.id === p.toolCallId);
            if (st) {
              const soft = p.ok ? resultFailure(p.result) : null;
              const failed = !p.ok || soft != null;
              st.status = failed ? 'failed' : 'done';
              st.summary = failed ? undefined : summarizeToolResult(p.tool, p.result);
              st.error = failed ? (p.error || soft || 'No detail returned') : undefined;
              st.link = failed ? undefined : linkForStep(p.tool, p.result, pending.clientId);
            }
          } else if (ev.type === 'agent:error' && typeof p.message === 'string') errorMessage = p.message;
        }
        misses = 0;
        const finished = session.status === 'completed' || session.status === 'failed';
        if (finished) {
          // Long runs can exceed the event page; the saved reply is the source of truth.
          const saved = [...session.messages].reverse().find(m => m.role === 'assistant')?.content || '';
          agentRunRef.current = { ...run, steps, text: saved || text };
          finalizeRun(session.status === 'failed' ? (errorMessage || 'The run stopped before finishing') : undefined);
          return;
        }
        patchRun(prev => ({ ...prev, steps, text }));
      } catch {
        // Session not found (the reload beat the run's start) or a network blip.
        misses += 1;
        if (misses >= 5) { finalizeRun('That run did not start before the page reloaded. Send it again'); return; }
      }
      if (Date.now() > deadline) { finalizeRun('Lost track of the run. Check Session history'); return; }
      setTimeout(tick, 3000);
    };
    tick();
    return () => { stopped = true; };
    // Runs once on mount by design: it resumes whatever was saved before the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear the agent socket down with the widget.
  useEffect(() => () => {
    agentSocketRef.current?.disconnect();
    agentSocketRef.current = null;
  }, []);

  // ⌘J / Ctrl+J toggles the assistant from anywhere (⌘K is the command palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSend = async (overrideInput?: string, opts?: { via?: 'chat' }) => {
    const content = (overrideInput || input).trim();
    // Attachments only ride the typed turn, not quick-action/template prompts.
    const atts = overrideInput ? [] : attachments;
    if ((!content && atts.length === 0) || loading) return;

    const shownContent = content || (atts.length ? `📎 ${atts.length} attachment${atts.length === 1 ? '' : 's'}` : '');
    const userMsg: EnrichedMessage = { role: 'user', content: shownContent };
    const chatMessages: ChatMessage[] = [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content }];
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (atts.length) setAttachments([]);
    setLoading(true);
    setError('');

    // Agent runs are text-driven; attachments and forced-chat prompts
    // (quick actions, follow-up refinements) keep the proven chat path.
    if (mode === 'agent' && opts?.via !== 'chat' && atts.length === 0) {
      await startAgentRun(content, chatMessages);
    } else {
      await runChat(chatMessages, atts);
    }
  };

  const runChat = async (chatMessages: ChatMessage[], atts: typeof attachments) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = newTurnId();
    setPendingChat({ turnId, startedAt: Date.now() });
    try {
      const out = await assistantApi.chat(chatMessages, selectedClientId || undefined, controller.signal, atts.length ? atts : undefined, turnId);
      const action = (out as any).action as ActionResult | undefined;
      // The backend may surface RAG citations + reasoning trace on the response;
      // both are optional, both render only when present.
      const citations = (out as any).citations as Citation[] | undefined;
      const reasoning = (out as any).reasoning as string | undefined;
      const assistantMsg: EnrichedMessage = {
        ...out.message,
        action,
        provider: out.provider,
        latencyMs: out.latencyMs,
        citations,
        reasoning,
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Side-effects that change server state — refresh local caches so the
      // dashboard picks up the change without a manual F5 (the reason Weni
      // saw "1 client" after create_client fired 2026-04-23).
      if (action?.type === 'create_client' && action.result?.created && action.result?.id) {
        await fetchClients();
        setSelectedClientId(action.result.id);
      } else if (action?.type === 'create_client' && action.result?.alreadyExists && action.result?.id) {
        await fetchClients();
        setSelectedClientId(action.result.id);
      } else if (action?.type === 'delete_calendar' && action.result?.deleted) {
        await fetchClients();
      }
    } catch (err: any) {
      // A user-initiated abort is not an error — swallow it quietly.
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        setError('');
      } else {
        setError(err?.message || 'Chat failed');
      }
    } finally {
      setLoading(false);
      setPendingChat(null);
      abortRef.current = null;
    }
  };

  // ── Agent run machinery ─────────────────────────────────────────

  const patchRun = (fn: (prev: AgentRunView) => AgentRunView) => {
    const prev = agentRunRef.current;
    if (!prev) return;
    const next = fn(prev);
    agentRunRef.current = next;
    setAgentRun(next);
  };

  /** Fold the finished (or failed) run into the transcript as a normal
   * assistant message carrying its tool timeline, then clear the live view. */
  const finalizeRun = (runError?: string, summary?: string) => {
    const run = agentRunRef.current;
    if (!run) return;
    agentRunRef.current = null;
    setAgentRun(null);
    setPendingRun(null);
    setLoading(false);
    const text = run.text.trim() || (summary ?? '').trim();
    const msg: EnrichedMessage = {
      role: 'assistant',
      content: text || (runError ? 'The run stopped before producing a reply.' : 'Done.'),
      steps: run.steps.length ? run.steps : undefined,
      runError,
    };
    setMessages(prev => [...prev, msg]);
  };

  /** One shared socket to the /agent namespace; handlers registered once.
   * Events only arrive for rooms this client joined, and stale events are
   * dropped because agentRunRef is null between runs. */
  const getAgentSocket = (): Socket | null => {
    if (agentSocketRef.current) return agentSocketRef.current;
    const token = localStorage.getItem('radix_auth_token');
    if (!token) return null;
    const base = getApiUrl() || window.location.origin;
    const s = io(`${base}/agent`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      timeout: 4000,
    });
    // Rooms are lost on reconnect; re-join if a run is still live.
    s.on('connect', () => {
      const uid = agentSessionRef.current;
      if (uid && agentRunRef.current) s.emit('session:join', { sessionUid: uid });
    });
    s.on('agent:message', (p: { text: string; streaming?: boolean }) => {
      patchRun(prev => {
        const sep = breakAfterToolRef.current && prev.text ? '\n\n' : '';
        breakAfterToolRef.current = false;
        return { ...prev, phase: 'running', text: prev.text + sep + p.text };
      });
    });
    s.on('agent:tool_start', (p: { toolCallId: string; tool: string }) => {
      breakAfterToolRef.current = true;
      patchRun(prev => ({
        ...prev,
        phase: 'running',
        steps: [
          ...prev.steps.filter(st => st.id !== p.toolCallId),
          { id: p.toolCallId, tool: p.tool, status: 'running' as const },
        ],
      }));
    });
    s.on('agent:tool_result', (p: { toolCallId: string; tool: string; ok: boolean; result?: unknown; error?: string }) => {
      const soft = p.ok ? resultFailure(p.result) : null;
      const failed = !p.ok || soft != null;
      patchRun(prev => ({
        ...prev,
        steps: prev.steps.map(st =>
          st.id === p.toolCallId
            ? {
                ...st,
                status: failed ? ('failed' as const) : ('done' as const),
                summary: failed ? undefined : summarizeToolResult(p.tool, p.result),
                error: failed ? (p.error || soft || 'No detail returned') : undefined,
                link: failed ? undefined : linkForStep(p.tool, p.result, prev.clientId),
              }
            : st,
        ),
      }));
    });
    s.on('agent:complete', (p: { summary?: string }) => finalizeRun(undefined, p.summary));
    s.on('agent:error', (p: { message: string }) => finalizeRun(p.message));
    // If reconnection gives up mid-run, do not leave the widget spinning:
    // the run keeps going server-side and lands in Session history.
    s.io.on('reconnect_failed', () =>
      finalizeRun('Lost the live connection. The run may still finish; check Session history'));
    agentSocketRef.current = s;
    return s;
  };

  const joinSession = (socket: Socket, sessionUid: string, timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const onJoined = (p: { sessionUid: string }) => {
        if (done || p.sessionUid !== sessionUid) return;
        done = true;
        clearTimeout(timer);
        socket.off('session:joined', onJoined);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        socket.off('session:joined', onJoined);
        resolve(false);
      }, timeoutMs);
      socket.on('session:joined', onJoined);
      const doJoin = () => socket.emit('session:join', { sessionUid });
      if (socket.connected) doJoin();
      else socket.once('connect', doJoin);
    });

  const startAgentRun = async (content: string, chatFallback: ChatMessage[]) => {
    const socket = getAgentSocket();
    if (!socket) {
      // No auth token for the stream; the chat path still answers.
      await runChat(chatFallback, []);
      return;
    }
    const sessionUid = newSessionUid();
    if (agentSessionRef.current) socket.emit('session:leave', { sessionUid: agentSessionRef.current });
    agentSessionRef.current = sessionUid;
    breakAfterToolRef.current = false;
    const run: AgentRunView = { sessionUid, phase: 'connecting', text: '', steps: [], clientId: selectedClientId };
    agentRunRef.current = run;
    setAgentRun(run);

    const joined = await joinSession(socket, sessionUid, 4000);
    if (!joined) {
      agentRunRef.current = null;
      setAgentRun(null);
      toast('Live agent stream unavailable. Answered in chat mode instead.');
      await runChat(chatFallback, []);
      return;
    }
    // Carry the conversation. Each run is its own session server-side, so
    // without the earlier turns a follow-up ("do it", "this is for RTA") reached
    // the agent with nothing to refer to. chatFallback ends with this message.
    const history = chatFallback
      .slice(0, -1)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-16)
      .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
    socket.emit('agent:run', { sessionUid, input: content, clientId: selectedClientId || undefined, history });
    setPendingRun({ sessionUid, clientId: selectedClientId, startedAt: Date.now() });
  };

  const handleStop = () => {
    if (agentRunRef.current) {
      // A run resumed after a reload has no socket yet; open one so Stop still reaches the server.
      (agentSocketRef.current ?? getAgentSocket())?.emit('agent:cancel', { sessionUid: agentRunRef.current.sessionUid });
      finalizeRun('Stopped by you');
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    chatResumeStopRef.current = true;
    setPendingChat(null);
    setLoading(false);
  };

  const handleClear = () => {
    chatResumeStopRef.current = true;
    setMessages([]);
    setPendingRun(null);
    setPendingChat(null);
    setError('');
    setAttachments([]);
    abortRef.current?.abort();
    if (agentRunRef.current) {
      agentSocketRef.current?.emit('agent:cancel', { sessionUid: agentRunRef.current.sessionUid });
      agentRunRef.current = null;
      setAgentRun(null);
      setLoading(false);
    }
  };

  // Encode attached files to data URLs (images go to the vision model; others
  // are noted in text for now). Cap 6 per turn; ~15MB each to keep the JSON sane.
  const handleAttach = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    const picked = Array.from(files).slice(0, 6);
    try {
      const encoded = await Promise.all(picked.map(async (f) => {
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is over 15MB`);
        const dataUrl: string = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        const kind: 'image' | 'video' | 'doc' = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'doc';
        return { dataUrl, mimeType: f.type || 'application/octet-stream', name: f.name, kind };
      }));
      setAttachments(prev => [...prev, ...encoded].slice(0, 6));
    } catch (err: any) {
      setError(err?.message || 'Could not attach file');
    }
  };
  const removeAttachment = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  // Agent templates — fetched once, rendered alongside the static quick actions.
  const [templates, setTemplates] = useState<AgentTemplateSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    agentApi.listTemplates()
      .then((r) => { if (!cancelled) setTemplates(r.templates); })
      .catch(() => { /* templates are optional */ });
    return () => { cancelled = true; };
  }, []);

  const quickActions = [
    { label: 'Brief', icon: FileText, prompt: 'Show me the current brief' },
    { label: 'Calendar', icon: Calendar, prompt: 'What months do we have in the calendar?' },
    { label: 'Visual refs', icon: Search, prompt: `Search for visual references about ${currentClient?.industry || 'luxury branding'}` },
    { label: 'Generate', icon: Zap, prompt: `Generate content for ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}` },
    { label: 'Stats', icon: MessageSquare, prompt: 'Show me dashboard stats' },
    { label: 'Research', icon: Search, prompt: `Research content ideas for ${currentClient?.name || 'our client'}` },
  ];

  // Concrete jobs the agent can run end to end. Clicking fills the input
  // (and flips to Agent mode) so the user can adjust before sending; that
  // is what makes the agent discoverable as a doer, not just a chat.
  const nextMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const starterJobs = [
    {
      label: 'Plan next month for this client',
      prompt: `Plan ${nextMonthLabel} for ${currentClient?.name || 'the selected client'}: read the brief, draft the posts, and build the calendar.`,
    },
    {
      label: 'Rewrite the captions that failed compliance',
      prompt: 'Find the posts that failed compliance, rewrite their captions so they pass, and re-check them.',
    },
    {
      label: 'Find reference visuals for the new campaign',
      prompt: `Find reference visuals for ${currentClient?.name || 'our client'}'s next campaign and summarize the visual direction.`,
    },
  ];

  const fillPrompt = (prompt: string) => {
    setMode('agent');
    setInput(prompt);
    promptRef.current?.focus();
  };

  // Action card renderer
  const renderActionCard = (action: ActionResult) => {
    const r = action.result;
    if (!r) return null;

    if (action.type === 'search_visual_refs' && r.images?.length) {
      return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {r.images.slice(0, 6).map((img: any, i: number) => (
            <a key={i} href={img.pinUrl} target="_blank" rel="noopener noreferrer"
              className="aspect-square rounded-lg overflow-hidden border border-white/[0.06] hover:border-accent/30 transition-colors relative group">
              <img src={img.thumbUrl} alt={img.title || ''} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ExternalLink className="w-3.5 h-3.5 text-white" />
              </div>
            </a>
          ))}
        </div>
      );
    }

    if (action.type === 'generate_content' && r.jobId) {
      return (
        <button onClick={() => { navigate(`/calendar?client=${selectedClientId}&month=${encodeURIComponent(r.month)}`); setOpen(false); }}
          className="mt-2 flex items-center gap-2 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-accent/20 transition-colors">
          <Calendar className="w-3.5 h-3.5" /> View Calendar →
        </button>
      );
    }

    if (action.type === 'create_client' && (r.created || r.alreadyExists) && r.id) {
      const verb = r.created ? 'Created' : 'Already exists';
      return (
        <button onClick={() => { navigate('/clients'); setOpen(false); }}
          className="mt-2 flex items-center gap-2 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-accent/20 transition-colors">
          <FileText className="w-3.5 h-3.5" /> {verb}: {r.name} · Open Clients →
        </button>
      );
    }

    if (action.type === 'list_clients' && Array.isArray(r)) {
      return (
        <div className="mt-2 space-y-1">
          {r.slice(0, 5).map((c: any) => (
            <div key={c.id} className="text-[11px] text-fg-muted bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
              <span className="text-fg font-medium">{c.name}</span>
              {c.industry && <span className="text-fg-subtle ml-1">· {c.industry}</span>}
            </div>
          ))}
        </div>
      );
    }

    if (action.type === 'get_calendar' && Array.isArray(r)) {
      return (
        <div className="mt-2 space-y-1">
          {r.map((m: any, i: number) => (
            <button key={i} onClick={() => { navigate(`/calendar?client=${selectedClientId}&month=${encodeURIComponent(m.month)}`); setOpen(false); }}
              className="w-full text-left text-[11px] text-fg-muted bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04] cursor-pointer hover:border-white/[0.1] transition-colors">
              <span className="text-fg font-medium">{m.month}</span>
              <span className="text-fg-subtle ml-1">· {m.postCount} posts · {m.status}</span>
            </button>
          ))}
        </div>
      );
    }

    if (action.type === 'get_stats' && r.clients !== undefined) {
      return (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            { label: 'Clients', value: r.clients },
            { label: 'Posts', value: r.posts },
            { label: 'Approved', value: `${r.approvalRate}%` },
            { label: 'Months', value: r.months },
          ].map(s => (
            <div key={s.label} className="text-[11px] text-fg-muted bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
              <span className="text-fg font-bold">{s.value}</span> <span className="text-fg-subtle">{s.label}</span>
            </div>
          ))}
        </div>
      );
    }

    if (action.type === 'delete_calendar' && r.deleted) {
      return (
        <div className="mt-2 text-[11px] text-success bg-success/10 border border-success/20 rounded-lg px-3 py-1.5">
          Deleted calendar for {r.month}. You can now regenerate it.
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {/* Floating launcher — Zendesk-style widget: branded circle with the chat icon
          cross-sliding to a chevron on open/close, plus a spring pop-in. */}
      <motion.button
        onClick={() => setOpen(!open)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        transition={motionUI}
        style={{ zIndex: Z.widget, background: 'linear-gradient(135deg, var(--color-accent-hover), var(--color-accent))' }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl cursor-pointer overflow-hidden grid place-items-center"
        title={open ? 'Close assistant' : 'Open AURAAI Assistant'}
        aria-label={open ? 'Close assistant' : 'Open AURAAI Assistant'}
        aria-expanded={open}
      >
        <motion.span
          className="absolute"
          animate={{ y: open ? -30 : 0, opacity: open ? 0 : 1 }}
          transition={motionUI}
        >
          <MessageSquare className="w-6 h-6" style={{ color: 'var(--color-fg-on-accent)' }} />
        </motion.span>
        <motion.span
          className="absolute"
          animate={{ y: open ? 0 : 30, opacity: open ? 1 : 0 }}
          transition={motionUI}
        >
          <ChevronDown className="w-6 h-6" style={{ color: 'var(--color-fg-on-accent)' }} />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            style={{ zIndex: Z.widgetOpen }}
            className={`fixed bg-[#0c0c0c] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
              expanded
                ? 'bottom-6 right-6 w-[min(760px,calc(100vw-3rem))] h-[calc(100vh-3rem)]'
                : 'bottom-24 right-6 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-8rem)]'
            }`}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
              <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-accent/30 shrink-0">
                <img src="./radix-dna.jpg" alt="AuraAI" className="w-full h-full object-cover" />
                {/* Live status dot — pulses while a run is in flight. */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: loading ? 'var(--color-warning)' : 'var(--color-success)', borderColor: '#0c0c0c' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white flex items-center gap-1.5">
                  AuraAI
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5"
                    style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>Agent</span>
                </p>
                <p className="text-[10px] text-fg-subtle truncate">
                  {loading ? 'Working…' : currentClient ? `${currentClient.name} · ready` : 'ready'}
                </p>
              </div>
              {messages.length > 0 && (
                <button onClick={handleClear} title="New chat"
                  className="p-1.5 transition-colors cursor-pointer" style={{ color: 'var(--color-fg-subtle)' }}>
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => navigate('/agent')} title="Session history"
                className="p-1.5 transition-colors cursor-pointer" style={{ color: 'var(--color-fg-subtle)' }}>
                <MessageSquare className="w-4 h-4" />
              </button>
              <button onClick={() => setExpanded((e) => !e)} title={expanded ? 'Collapse' : 'Expand to focus mode'}
                className="p-1.5 transition-colors cursor-pointer" style={{ color: 'var(--color-fg-subtle)' }}>
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>

            {/* Grounding strip — surfaces the context every reply is grounded in
                (Brand Kit + Knowledge + Learnings are auto-injected by the AI
                router). Reassures the user the assistant uses THEIR data. */}
            <div className="px-4 py-1.5 border-b flex items-center gap-1.5 flex-wrap" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>Grounded in</span>
              {currentClient && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5"
                  style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                  {currentClient.name}
                </span>
              )}
              {[
                { icon: Palette, label: 'Brand Kit' },
                { icon: Database, label: 'Knowledge' },
                { icon: Lightbulb, label: 'Learnings' },
              ].map((g) => (
                <span key={g.label} className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5"
                  style={{ color: 'var(--color-fg-subtle)', border: '1px solid var(--color-border-subtle)' }}>
                  <g.icon className="w-2.5 h-2.5" /> {g.label}
                </span>
              ))}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden border border-accent/20 mb-3 shadow-[0_0_30px_-8px_rgba(245,158,11,0.3)]">
                    <img src="./radix-dna.jpg" alt="AuraAI" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-sm text-fg-muted mb-1 font-medium">I'm AuraAI. Your content strategist.</p>
                  <p className="text-xs text-fg-subtle mb-4">I can generate content, search visual refs, pull your brief, and more.</p>

                  {/* Starter jobs: real work the agent runs end to end.
                      Clicking fills the input so the user can adjust first. */}
                  <div className="w-full max-w-[280px] mb-4">
                    <p className="mb-1.5 text-start text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                      Jobs I can run for you
                    </p>
                    <div className="space-y-1">
                      {starterJobs.map(job => (
                        <button
                          key={job.label}
                          type="button"
                          onClick={() => fillPrompt(job.prompt)}
                          title="Fills the prompt so you can adjust it before sending"
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-start text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg)', outlineColor: 'var(--color-accent)' }}
                        >
                          <Zap className="w-3 h-3 shrink-0" style={{ color: 'var(--color-accent)' }} />
                          {job.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-2 w-full max-w-[280px]">
                    {quickActions.map(qa => (
                      <button key={qa.label} onClick={() => handleSend(qa.prompt, { via: 'chat' })}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-fg-muted hover:text-white hover:border-white/[0.12] transition-all cursor-pointer">
                        <qa.icon className="w-3.5 h-3.5 text-accent/60" />
                        {qa.label}
                      </button>
                    ))}
                  </div>

                  {/* Agent template launcher (catalog from /api/agent/templates) */}
                  {templates.length > 0 && (
                    <div className="mt-4 w-full max-w-[280px]">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
                        Templates
                      </p>
                      <div className="space-y-1">
                        {templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => handleSend(tpl.starterPrompt || `Use the ${tpl.name} template`)}
                            title={tpl.description}
                            className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer"
                            style={{
                              background: 'var(--color-surface)',
                              borderColor: 'var(--color-border-subtle)',
                            }}
                          >
                            <Sparkles className="mt-0.5 w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-fg)' }}>{tpl.shortLabel}</p>
                              <p className="text-[10px] line-clamp-1" style={{ color: 'var(--color-fg-muted)' }}>{tpl.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {messages.map((m, i) => (
                <MessageRow
                  key={i}
                  message={m}
                  isLast={i === messages.length - 1}
                  onRetry={
                    m.role === 'assistant'
                      ? () => {
                          // Re-send the user message that produced this assistant reply
                          const prev = messages[i - 1];
                          if (prev?.role === 'user') {
                            // Drop the assistant message so the chain reflects the retry
                            setMessages(arr => arr.slice(0, i));
                            handleSend(prev.content);
                          }
                        }
                      : undefined
                  }
                  renderAction={renderActionCard}
                  onOpenLink={(to) => { navigate(to); setOpen(false); }}
                />
              ))}

              {/* Live agent run: tool timeline + streamed narrative, updated
                  from the Socket.IO events as the loop works. */}
              {agentRun && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[88%] space-y-2">
                    <ToolTimeline
                      steps={agentRun.steps}
                      live
                      onOpenLink={(to) => { navigate(to); setOpen(false); }}
                    />
                    {agentRun.text ? (
                      <div
                        className="rounded-2xl rounded-bl-sm border px-3.5 py-2 text-sm leading-relaxed"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg)' }}
                      >
                        <Markdown text={agentRun.text} />
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Suggested follow-ups — appear under the latest assistant reply
                  (Jasper-style). Bilingual "Translate to Arabic" is first-class
                  for Gulf agencies. Tapping sends the refinement immediately. */}
              {!loading && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={motionUI}
                  className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { icon: Scissors, label: 'Make it shorter', prompt: 'Make that shorter and punchier.' },
                    { icon: Shuffle, label: '3 variations', prompt: 'Give me 3 different variations of that.' },
                    { icon: Languages, label: 'Translate to Arabic', prompt: 'Translate that into natural Gulf Arabic.' },
                    { icon: Palette, label: 'Apply brand voice', prompt: 'Rewrite that in our brand voice.' },
                  ].map((s) => (
                    <button key={s.label} type="button" onClick={() => handleSend(s.prompt, { via: 'chat' })}
                      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 transition-colors cursor-pointer"
                      style={{ color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}>
                      <s.icon className="w-3 h-3" style={{ color: 'var(--color-accent)' }} /> {s.label}
                    </button>
                  ))}
                </motion.div>
              )}

              {loading && (
                <div className="flex items-center gap-2">
                  <ThinkingIndicator />
                  <button type="button" onClick={handleStop} title="Stop generating"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors cursor-pointer"
                    style={{ color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}>
                    <StopCircle className="w-3 h-3" /> Stop
                  </button>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-danger/10 border border-danger/20 px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                  <p className="text-xs text-danger">{error}</p>
                </div>
              )}
            </div>

            {/* Input — polished prompt box: auto-resize textarea, send-inside,
                Enter to send + Shift+Enter for newline, char counter at limit */}
            {/* Attachment tray — chips for queued files + the attach control. */}
            <div className="px-3 pt-2 flex items-center gap-2 flex-wrap">
              {/* Mode switch: Chat answers, Agent runs tools end to end. */}
              <div
                role="group"
                aria-label="Assistant mode"
                className="inline-flex rounded-lg border p-0.5"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {([
                  { id: 'chat' as const, label: 'Chat', hint: 'Chat mode: quick answers and single actions' },
                  { id: 'agent' as const, label: 'Agent', hint: 'Agent mode: runs tools end to end (plan a month, write captions, schedule posts)' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-pressed={mode === m.id}
                    title={m.hint}
                    className="rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={
                      mode === m.id
                        ? { background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)', outlineColor: 'var(--color-accent)' }
                        : { color: 'var(--color-fg-muted)', outlineColor: 'var(--color-accent)' }
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                title="Attach image / file"
                aria-label="Attach image or file"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer"
                style={{ color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              {attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-lg pl-1 pr-1.5 py-0.5 text-[11px] max-w-[160px]"
                  style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-fg-muted)' }}>
                  {a.kind === 'image'
                    ? <img src={a.dataUrl} alt="" className="h-5 w-5 rounded object-cover shrink-0" />
                    : <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-accent)' }} />}
                  <span className="truncate">{a.name}</span>
                  <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`} className="shrink-0 hover:opacity-70">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.docx,.txt,.md"
                hidden
                onChange={(e) => { handleAttach(e.target.files); e.target.value = ''; }}
              />
            </div>

            <PromptBox
              value={input}
              onChange={setInput}
              onSend={() => handleSend()}
              loading={loading}
              maxChars={4000}
              textareaRef={promptRef}
              placeholder={mode === 'agent'
                ? 'Give the agent a job…  (Enter to send, Shift+Enter for newline)'
                : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── PromptBox — AI-style prompt input ───────────────────────────────
// Multi-line auto-resizing textarea with the send button INSIDE the box,
// keyboard hint (Enter ↵, Shift+Enter for newline), live char counter,
// disabled while loading. Adapted from the 21st.dev "AI Prompt Box"
// pattern and restyled against radixcontent semantic tokens.

interface PromptBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  maxChars: number;
  /** Optional shared ref so the parent can focus the textarea (starter jobs). */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
}

function PromptBox({ value, onChange, onSend, loading, maxChars, textareaRef, placeholder }: PromptBoxProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? innerRef;

  // Auto-resize: 1 line at rest, grow up to 6 lines
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 6 * 22; // ~6 lines at 22px line-height
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  const overLimit = value.length > maxChars;
  const canSend = !loading && value.trim().length > 0 && !overLimit;

  return (
    <div
      className="border-t p-3"
      style={{ borderColor: 'var(--color-border-subtle)' }}
    >
      <div
        className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors focus-within:[--ring:1]"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset',
        }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          rows={1}
          placeholder={loading ? 'Working…' : (placeholder || 'Ask AURAAI anything…  (Enter to send, Shift+Enter for newline)')}
          disabled={loading}
          className="flex-1 resize-none bg-transparent text-sm leading-snug outline-none placeholder:opacity-50 disabled:opacity-50"
          style={{ color: 'var(--color-fg)', minHeight: '22px', maxHeight: '132px' }}
        />
        <button
          type="button"
          onClick={() => canSend && onSend()}
          disabled={!canSend}
          aria-label="Send"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: canSend ? 'var(--color-accent)' : 'var(--color-surface)',
            color: canSend ? 'var(--color-fg-on-accent)' : 'var(--color-fg-muted)',
          }}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-[10px]">
        <span style={{ color: 'var(--color-fg-subtle)' }}>
          ⏎ send · ⇧⏎ newline
        </span>
        <span style={{ color: overLimit ? 'var(--color-danger)' : 'var(--color-fg-subtle)' }}>
          {value.length} / {maxChars}
        </span>
      </div>
    </div>
  );
}

// ─── Message bubble + hover actions ──────────────────────────────────
// Polished message lane (V0 AI Chat aesthetic adapted for radixcontent
// tokens): hairline-bordered bubbles, monospace model chip, hover-revealed
// copy/retry on assistant messages. Action cards render unchanged below
// the bubble via the existing renderActionCard prop.

// Compact markdown renderer for assistant replies — token-styled so lists,
// emphasis, links, and code render properly instead of as raw asterisks.
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          strong: ({ children }) => <strong className="font-bold" style={{ color: 'var(--color-fg)' }}>{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--color-accent)' }}>{children}</a>
          ),
          code: ({ children }) => (
            <code className="rounded px-1 py-0.5 font-mono text-[12px]" style={{ background: 'var(--color-bg-sunken)', color: 'var(--color-fg)' }}>{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="rounded-lg p-2.5 overflow-x-auto text-[12px] font-mono" style={{ background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border-subtle)' }}>{children}</pre>
          ),
          h1: ({ children }) => <p className="font-bold text-[15px]" style={{ color: 'var(--color-fg)' }}>{children}</p>,
          h2: ({ children }) => <p className="font-bold text-[14px]" style={{ color: 'var(--color-fg)' }}>{children}</p>,
          h3: ({ children }) => <p className="font-semibold text-[13px]" style={{ color: 'var(--color-fg)' }}>{children}</p>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

interface MessageRowProps {
  message: EnrichedMessage;
  isLast: boolean;
  onRetry?: () => void;
  renderAction: (action: ActionResult) => React.ReactNode;
  /** Navigate to an in-app destination a tool persisted output to. */
  onOpenLink?: (to: string) => void;
}

function MessageRow({ message, isLast, onRetry, renderAction, onOpenLink }: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error('Copy failed. Clipboard unavailable');
    }
  };

  return (
    <motion.div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="group max-w-[88%]">
        {/* Tool timeline first: the work, then the answer. */}
        {!isUser && message.steps && message.steps.length > 0 ? (
          <div className="mb-2">
            <ToolTimeline steps={message.steps} onOpenLink={onOpenLink} />
          </div>
        ) : null}
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isUser ? 'rounded-br-sm whitespace-pre-wrap' : 'rounded-bl-sm border'
          }`}
          style={
            isUser
              ? { background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }
              : { background: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-fg)' }
          }
        >
          {isUser ? message.content : <Markdown text={message.content} />}
        </div>

        {/* Trust strip + hover actions */}
        {!isUser ? (
          <div className="mt-1 flex h-5 items-center gap-2 px-1 text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
            <ModelChip provider={message.provider} />
            {message.latencyMs != null ? <span>{message.latencyMs}ms</span> : null}
            {message.citations && message.citations.length > 0 ? (
              <span style={{ color: 'var(--color-fg-subtle)' }}>· {message.citations.length} source{message.citations.length === 1 ? '' : 's'}</span>
            ) : null}

            {/* Reveal-on-hover actions; isLast keeps them visible on the latest reply */}
            <div className={`ml-auto flex items-center gap-1 transition-opacity ${isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button
                type="button"
                onClick={copy}
                title="Copy"
                className="rounded p-1 transition-colors"
                style={{ color: 'var(--color-fg-muted)' }}
              >
                {copied ? <Check className="h-3 w-3" style={{ color: 'var(--color-success)' }} /> : <Copy className="h-3 w-3" />}
              </button>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  title="Retry"
                  className="rounded p-1 transition-colors"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Run stopped early: say so plainly instead of a silent red blob. */}
        {!isUser && message.runError ? (
          <div
            className="mt-2 flex items-start gap-2 rounded-xl border px-3 py-2"
            style={{ background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger-subtle)' }}
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-danger)' }} />
            <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
              The run stopped early: {message.runError}. Anything finished above is already saved.
            </p>
          </div>
        ) : null}

        {!isUser && message.citations && message.citations.length > 0 ? (
          <CitationsBubble citations={message.citations} />
        ) : null}
        {!isUser && message.reasoning ? (
          <ReasoningToggle reasoning={message.reasoning} />
        ) : null}
        {message.action ? renderAction(message.action) : null}
      </div>
    </motion.div>
  );
}

// ─── Trust UI sub-components ─────────────────────────────────────────

function ModelChip({ provider }: { provider?: string }) {
  if (!provider) return null;
  const tier = PROVIDER_TIERS[provider.toLowerCase()];
  if (!tier) {
    return (
      <span
        className="rounded px-1 py-0.5 font-mono"
        style={{ background: 'var(--color-bg-sunken)', color: 'var(--color-fg-muted)' }}
      >
        {provider}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        background: tier.tint,
        color: tier.ring,
        boxShadow: `inset 0 0 0 1px ${tier.ring}`,
      }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: tier.ring }} aria-hidden />
      {tier.label}
    </span>
  );
}

function CitationsBubble({ citations }: { citations: Citation[] }) {
  return (
    <div
      className="mt-2 rounded-xl border px-2.5 py-2"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
        <Quote className="h-3 w-3" /> Sources
      </div>
      <ul className="space-y-1">
        {citations.slice(0, 6).map((c, i) => {
          const Inner = (
            <>
              <span
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold tabular-nums"
                style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--color-fg)' }}>
                {c.title}
              </span>
              {c.score != null ? (
                <span className="text-[10px] font-mono" style={{ color: 'var(--color-fg-subtle)' }}>
                  {Math.round(c.score * 100)}%
                </span>
              ) : null}
            </>
          );
          return (
            <li key={i}>
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-[color:var(--color-surface-hover)]"
                >
                  {Inner}
                  <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" style={{ color: 'var(--color-fg-subtle)' }} />
                </a>
              ) : (
                <div className="flex items-center gap-2 px-1.5 py-1">{Inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Agent tool timeline ─────────────────────────────────────────────
// Readable record of what the agent actually did: plain-language tool
// labels, running / done / failed state, a one-line result summary, and a
// direct link to wherever the run persisted output. Never raw JSON.

function StepStatusIcon({ status }: { status: AgentToolStep['status'] }) {
  if (status === 'running') {
    return (
      <Loader2
        className="mt-0.5 h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
        style={{ color: 'var(--color-accent)' }}
        aria-label="Running"
      />
    );
  }
  if (status === 'failed') {
    return <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: 'var(--color-danger)' }} aria-label="Failed" />;
  }
  return <Check className="mt-0.5 h-3 w-3 shrink-0" style={{ color: 'var(--color-success)' }} aria-label="Done" />;
}

function ToolTimeline({ steps, live, onOpenLink }: { steps: AgentToolStep[]; live?: boolean; onOpenLink?: (to: string) => void }) {
  if (steps.length === 0) return null;
  return (
    <div
      className="rounded-xl border px-2.5 py-2"
      style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-fg-subtle)' }}>
        <Zap className="h-3 w-3" /> {live ? 'Working through it' : 'What I did'}
      </div>
      <ol className="space-y-1">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 px-1 py-0.5">
            <StepStatusIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium leading-snug" style={{ color: 'var(--color-fg)' }}>
                {toolLabel(step.tool)}
                {step.status === 'running' ? (
                  <span className="ms-1.5 text-[10px] font-normal" style={{ color: 'var(--color-fg-subtle)' }}>in progress</span>
                ) : null}
              </p>
              {step.status === 'failed' ? (
                <p className="text-[10px] leading-snug" style={{ color: 'var(--color-danger)' }}>
                  Failed: {step.error || 'no detail returned'}.
                  {live ? ' I can see the error and will adjust the next step.' : ''}
                </p>
              ) : step.summary ? (
                <p className="text-[10px] leading-snug" style={{ color: 'var(--color-fg-muted)' }}>{step.summary}</p>
              ) : null}
              {step.link && onOpenLink ? (
                <button
                  type="button"
                  onClick={() => onOpenLink(step.link!.to)}
                  className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1"
                  style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', outlineColor: 'var(--color-accent)' }}
                >
                  {step.link.label} →
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReasoningToggle({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors"
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-fg-muted)',
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        <Brain className="h-3 w-3" />
        {open ? 'Hide reasoning' : 'How I got here'}
        <ChevronDown
          className="h-2.5 w-2.5 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="reasoning"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionUI}
            className="overflow-hidden"
          >
            <pre
              className="mt-1.5 whitespace-pre-wrap rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed font-mono"
              style={{
                background: 'var(--color-bg-sunken)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-fg-muted)',
              }}
            >
              {reasoning}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
