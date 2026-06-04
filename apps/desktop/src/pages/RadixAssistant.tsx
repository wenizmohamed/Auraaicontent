import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, Trash2, MessageSquare, AlertCircle, Zap, Search, FileText, Calendar, Image as ImageIcon, ExternalLink, Copy, RefreshCw, Check, Sparkles, Quote, Brain, ChevronDown, Palette, Database, Lightbulb, Languages, Scissors, Shuffle, Maximize2, Minimize2, Plus, StopCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { assistantApi, agentApi, type ChatMessage, type AgentTemplateSummary } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useNavigate } from 'react-router-dom';
import { Z } from '../lib/z-index';
import { ThinkingIndicator } from '../components/ui/ThinkingIndicator';
import { motionUI } from '../lib/motion';

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

export default function RadixAssistant() {
  const navigate = useNavigate();
  const { selectedClientId, currentClient, fetchClients, setSelectedClientId } = useClients();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // focus mode — larger panel for agent runs
  const [messages, setMessages] = useState<EnrichedMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null); // aborts the in-flight run (Stop)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

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

  const handleSend = async (overrideInput?: string) => {
    const content = (overrideInput || input).trim();
    if (!content || loading) return;

    const userMsg: EnrichedMessage = { role: 'user', content };
    const chatMessages: ChatMessage[] = [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content }];
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError('');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const out = await assistantApi.chat(chatMessages, selectedClientId || undefined, controller.signal);
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
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const handleClear = () => { setMessages([]); setError(''); abortRef.current?.abort(); };

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

  // Action card renderer
  const renderActionCard = (action: ActionResult) => {
    const r = action.result;
    if (!r) return null;

    if (action.type === 'search_visual_refs' && r.images?.length) {
      return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {r.images.slice(0, 6).map((img: any, i: number) => (
            <a key={i} href={img.pinUrl} target="_blank" rel="noopener noreferrer"
              className="aspect-square rounded-lg overflow-hidden border border-white/[0.06] hover:border-amber-500/30 transition-colors relative group">
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
          className="mt-2 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-amber-500/20 transition-colors">
          <Calendar className="w-3.5 h-3.5" /> View Calendar →
        </button>
      );
    }

    if (action.type === 'create_client' && (r.created || r.alreadyExists) && r.id) {
      const verb = r.created ? 'Created' : 'Already exists';
      return (
        <button onClick={() => { navigate('/clients'); setOpen(false); }}
          className="mt-2 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-amber-500/20 transition-colors">
          <FileText className="w-3.5 h-3.5" /> {verb}: {r.name} · Open Clients →
        </button>
      );
    }

    if (action.type === 'list_clients' && Array.isArray(r)) {
      return (
        <div className="mt-2 space-y-1">
          {r.slice(0, 5).map((c: any) => (
            <div key={c.id} className="text-[11px] text-zinc-400 bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
              <span className="text-zinc-200 font-medium">{c.name}</span>
              {c.industry && <span className="text-zinc-600 ml-1">· {c.industry}</span>}
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
              className="w-full text-left text-[11px] text-zinc-400 bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04] cursor-pointer hover:border-white/[0.1] transition-colors">
              <span className="text-zinc-200 font-medium">{m.month}</span>
              <span className="text-zinc-600 ml-1">· {m.postCount} posts · {m.status}</span>
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
            <div key={s.label} className="text-[11px] text-zinc-400 bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
              <span className="text-zinc-200 font-bold">{s.value}</span> <span className="text-zinc-600">{s.label}</span>
            </div>
          ))}
        </div>
      );
    }

    if (action.type === 'delete_calendar' && r.deleted) {
      return (
        <div className="mt-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5">
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
        title={open ? 'Close assistant' : 'Open Radix Assistant'}
        aria-label={open ? 'Close assistant' : 'Open Radix Assistant'}
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
              <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-amber-500/30 shrink-0">
                <img src="./radix-dna.jpg" alt="Radix" className="w-full h-full object-cover" />
                {/* Live status dot — pulses while a run is in flight. */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: loading ? 'var(--color-warning)' : 'var(--color-success)', borderColor: '#0c0c0c' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white flex items-center gap-1.5">
                  Radix
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5"
                    style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>Agent</span>
                </p>
                <p className="text-[10px] text-zinc-500 truncate">
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
                  <div className="w-14 h-14 rounded-2xl overflow-hidden border border-amber-500/20 mb-3 shadow-[0_0_30px_-8px_rgba(245,158,11,0.3)]">
                    <img src="./radix-dna.jpg" alt="Radix" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-sm text-zinc-400 mb-1 font-medium">I'm Radix — your content strategist.</p>
                  <p className="text-xs text-zinc-600 mb-4">I can generate content, search visual refs, pull your brief, and more.</p>

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-2 w-full max-w-[280px]">
                    {quickActions.map(qa => (
                      <button key={qa.label} onClick={() => handleSend(qa.prompt)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-zinc-400 hover:text-white hover:border-white/[0.12] transition-all cursor-pointer">
                        <qa.icon className="w-3.5 h-3.5 text-amber-500/60" />
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
                />
              ))}

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
                    <button key={s.label} type="button" onClick={() => handleSend(s.prompt)}
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
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
            </div>

            {/* Input — polished prompt box: auto-resize textarea, send-inside,
                Enter to send + Shift+Enter for newline, char counter at limit */}
            <PromptBox
              value={input}
              onChange={setInput}
              onSend={() => handleSend()}
              loading={loading}
              maxChars={4000}
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
}

function PromptBox({ value, onChange, onSend, loading, maxChars }: PromptBoxProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

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
          placeholder={loading ? 'Working…' : 'Ask Radix anything…  (Enter to send, Shift+Enter for newline)'}
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
}

function MessageRow({ message, isLast, onRetry, renderAction }: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error('Copy failed — clipboard unavailable');
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
