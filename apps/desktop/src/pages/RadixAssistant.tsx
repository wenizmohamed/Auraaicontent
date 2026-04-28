import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, Trash2, MessageSquare, AlertCircle, Zap, Search, FileText, Calendar, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { assistantApi, type ChatMessage } from '../lib/backend-api';
import { useClients } from '../lib/client-context';
import { useNavigate } from 'react-router-dom';
import { Z } from '../lib/z-index';

interface ActionResult {
  type: string;
  params: Record<string, any>;
  result: any;
}

interface EnrichedMessage extends ChatMessage {
  action?: ActionResult;
}

export default function RadixAssistant() {
  const navigate = useNavigate();
  const { selectedClientId, currentClient, fetchClients, setSelectedClientId } = useClients();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<EnrichedMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSend = async (overrideInput?: string) => {
    const content = (overrideInput || input).trim();
    if (!content || loading) return;

    const userMsg: EnrichedMessage = { role: 'user', content };
    const chatMessages: ChatMessage[] = [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content }];
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const out = await assistantApi.chat(chatMessages, selectedClientId || undefined);
      const action = (out as any).action as ActionResult | undefined;
      const assistantMsg: EnrichedMessage = { ...out.message, action };
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
      setError(err?.message || 'Chat failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => { setMessages([]); setError(''); };

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
      {/* Floating launcher — DNA avatar */}
      <button
        onClick={() => setOpen(!open)}
        style={{ zIndex: Z.widget }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl hover:scale-105 transition-transform cursor-pointer overflow-hidden border-2 border-amber-500/40"
        title={open ? 'Close assistant' : 'Open Radix Assistant'}
      >
        {open ? <X className="w-6 h-6 text-white absolute inset-0 m-auto z-10" /> : null}
        <img src="./radix-dna.jpg" alt="Radix AI" className={`w-full h-full object-cover ${open ? 'opacity-30' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            style={{ zIndex: Z.widgetOpen }}
            className="fixed bottom-24 right-6 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-8rem)] bg-[#0c0c0c] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden border border-amber-500/30">
                <img src="./radix-dna.jpg" alt="Radix" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Radix</p>
                <p className="text-[10px] text-zinc-500">
                  {currentClient ? `${currentClient.name} · Agent mode` : 'Agent mode'}
                </p>
              </div>
              {messages.length > 0 && (
                <button onClick={handleClear} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors cursor-pointer" title="Clear chat">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
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
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] ${m.role === 'user' ? '' : ''}`}>
                    <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-amber-500 text-black rounded-br-sm'
                        : 'bg-white/[0.04] text-zinc-200 border border-white/[0.06] rounded-bl-sm'
                    }`}>
                      {m.content}
                    </div>
                    {m.action && renderActionCard(m.action)}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-white/[0.04] border border-white/[0.06] px-3.5 py-2 text-sm text-zinc-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> Working on it...
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-white/[0.06] p-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={loading ? 'Working...' : 'Ask Radix anything...'}
                  disabled={loading}
                  className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 disabled:opacity-50 transition-colors"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
