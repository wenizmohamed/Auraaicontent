import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, Trash2, MessageSquare, AlertCircle } from 'lucide-react';
import { assistantApi, type ChatMessage } from '../lib/backend-api';
import { useClients } from '../lib/client-context';

export default function RadixAssistant() {
  const { selectedClientId } = useClients();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = { role: 'user', content };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const out = await assistantApi.chat(next, selectedClientId || undefined);
      setMessages(prev => [...prev, out.message]);
    } catch (err: any) {
      setError(err?.message || 'Chat failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError('');
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-2xl hover:scale-105 transition-transform"
        title={open ? 'Close assistant' : 'Open Radix Assistant'}
      >
        {open ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-8rem)] bg-[#0c0c0c] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <Bot className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Radix Assistant</p>
                <p className="text-[10px] text-zinc-500">Backend AI router</p>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <MessageSquare className="w-10 h-10 text-zinc-800 mb-3" />
                  <p className="text-sm text-zinc-500">Ask anything about your content briefs, calendars, or strategy.</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-amber-500 text-black rounded-br-sm'
                        : 'bg-white/[0.04] text-zinc-200 border border-white/[0.06] rounded-bl-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-white/[0.04] border border-white/[0.06] px-3.5 py-2 text-sm text-zinc-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking...
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
                  placeholder="Type a message..."
                  disabled={loading}
                  className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/40 disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed"
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
