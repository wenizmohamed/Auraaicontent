import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { getGemini } from '../lib/gemini';
import { Loader2, Send, Bot, User, Sparkles, Paperclip, X, Video as VideoIcon, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';

type Attachment = {
  data: string;
  mimeType: string;
  url: string;
  name: string;
};

// Guard component for when AI keys are not available client-side
function AiUnavailableGuard() {
  return (
    <div className="max-w-2xl mx-auto mt-20 text-center">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8">
        <Bot className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Radix Assistant</h2>
        <p className="text-zinc-400 mb-2">Server-side AI routing in progress.</p>
        <p className="text-zinc-500 text-sm">This feature will use the backend AI provider router once migration is complete.</p>
      </div>
    </div>
  );
}

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  images?: string[];
  attachments?: Attachment[];
  searchSources?: { title: string; url: string }[];
};

export default function RadixAssistant() {
  // Guard: client-side AI keys removed for security — needs server-side routing
  return <AiUnavailableGuard />;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Hello! I am **Radix**, your autonomous AI agent. I can help you generate content calendars, write copy, research trends with Google Search, generate images, edit images, and analyze videos. \n\nUpload an image or video using the paperclip icon, or just ask me anything!'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string).split(',')[1];
        setAttachments(prev => [...prev, {
          data: base64Data,
          mimeType: file.type,
          url: URL.createObjectURL(file),
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || loading) return;

    const userText = input.trim();
    setInput('');
    
    // Add user message to UI
    setMessages(prev => [...prev, { 
      id: crypto.randomUUID(), 
      role: 'user', 
      text: userText,
      attachments: attachments.length > 0 ? [...attachments] : undefined
    }]);

    // Prepare content for backend
    const newUserParts: any[] = [];
    if (userText) newUserParts.push({ text: userText });
    
    attachments.forEach(att => {
      newUserParts.push({
        inlineData: {
          data: att.data,
          mimeType: att.mimeType
        }
      });
    });

    const newUserContent = { role: 'user', parts: newUserParts };
    let currentHistory = [...history, newUserContent];
    
    setHistory(currentHistory);
    setAttachments([]);
    setLoading(true);

    const messageId = crypto.randomUUID();
    setMessages(prev => [...prev, { 
      id: messageId, 
      role: 'model', 
      text: '',
    }]);

    try {
      const ai = getGemini();

      // Add system context for Radix-specific responses
      const systemContext = {
        role: 'user',
        parts: [{ text: 'You are RADIX AI, the intelligent assistant for Radix Media — a Dubai-based digital marketing agency managing 13 clients. You help the content team with: writing social media captions, suggesting campaign ideas, answering marketing strategy questions, explaining platform best practices (Instagram, TikTok, LinkedIn, X, Facebook), and providing creative direction. Be direct, concise, and actionable. When asked about the tool, explain: users create briefs in New Brief, AI generates 18 content pieces, team reviews in Review page, and approved content appears in Calendar. Keep responses under 200 words unless asked for detail.' }]
      };

      const fullHistory = [systemContext, ...currentHistory];

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: fullHistory,
      });

      let responseText = response.text || '';
      let searchSources: any[] = [];
      
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        searchSources = chunks.map((c: any) => ({
          title: c.web?.title || 'Source',
          url: c.web?.uri || '#'
        }));
      }

      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: responseText, searchSources } : m));
      
      currentHistory = [...currentHistory, { role: 'model', parts: [{ text: responseText }] }];
      setHistory(currentHistory);

    } catch (err: any) {
      console.error(err);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: m.text + `\n\n**Error:** ${err.message || 'Something went wrong.'}` } : m));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-8 right-8 flex items-center justify-center h-14 w-14 rounded-full bg-[#111] text-white shadow-lg shadow-black/40 hover:bg-[#1a1a1a] transition-all duration-200 z-50 border border-white/10 overflow-hidden"
            title="Chat with Radix AI"
          >
            <img src="/radix-logo.jpg" alt="Radix AI" className="w-full h-full object-cover" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
            className="fixed bottom-8 right-8 w-[400px] h-[600px] max-h-[80vh] flex flex-col bg-[#0a0a0a] rounded-3xl shadow-2xl ring-1 ring-white/10 overflow-hidden z-50 border border-white/10"
          >
            {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-[#0a0a0a]/50 backdrop-blur-md">
        <div className="flex items-center">
          <img src="/radix-logo.jpg" alt="Radix" className="h-8 w-8 rounded-lg object-cover" />
          <div className="ml-3">
            <h1 className="text-sm font-bold text-white tracking-wider">RADIX AI</h1>
            <p className="text-[10px] text-zinc-500">Content Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMessages([{
                id: 'welcome',
                role: 'model',
                text: 'Hello! I am **Radix**, your autonomous AI agent. I can help you generate content calendars, write copy, research trends with Google Search, generate images, edit images, and analyze videos. \n\nUpload an image or video using the paperclip icon, or just ask me anything!'
              }]);
              setHistory([]);
            }}
            className="text-[10px] font-medium text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/5"
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-400 hover:text-white transition-colors p-1 rounded-full hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/20 custom-scrollbar">
        {messages.map((msg) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={msg.id} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                msg.role === 'user' ? 'bg-white/5 ml-3 border border-white/10' : 'bg-indigo-500/20 mr-3 border border-indigo-500/30'
              }`}>
                {msg.role === 'user' ? <User className="h-5 w-5 text-zinc-300" /> : <Bot className="h-5 w-5 text-indigo-400" />}
              </div>
              <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                
                {/* User Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2 justify-end">
                    {msg.attachments.map((att, idx) => (
                      <div key={idx} className="relative w-48 h-48 rounded-xl border border-slate-700 overflow-hidden shadow-sm bg-slate-800">
                        {att.mimeType.startsWith('image/') ? (
                          <img src={att.url} alt="attachment" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-4">
                            <VideoIcon className="h-10 w-10 mb-3 text-indigo-400" />
                            <span className="text-xs text-center break-all line-clamp-3 text-zinc-300">{att.name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {msg.text && (
                  <div className={`px-4 py-2.5 rounded-2xl shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-tr-sm border border-indigo-500/50' 
                      : 'bg-white/5 border border-white/10 text-zinc-200 rounded-tl-sm'
                  }`}>
                    <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'prose-invert prose-p:text-zinc-300 prose-a:text-indigo-400'}`}>
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  </div>
                )}

                {/* Search Sources */}
                {msg.searchSources && msg.searchSources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.searchSources.map((source, idx) => (
                      <a 
                        key={idx} 
                        href={source.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 shadow-sm hover:bg-white/10 transition-colors text-xs text-zinc-300"
                      >
                        <Globe className="h-3 w-3 text-indigo-400" />
                        <span className="truncate max-w-[200px]">{source.title}</span>
                      </a>
                    ))}
                  </div>
                )}

                {/* Generated Images */}
                {msg.images && msg.images.length > 0 && (
                  <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2">
                    {msg.images.map((img, idx) => (
                      <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-700 shadow-sm">
                        <img src={img} alt="Generated" className="w-full h-auto object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="flex flex-row max-w-[80%]">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-indigo-500/20 mr-3 flex items-center justify-center border border-indigo-500/30">
                <Bot className="h-5 w-5 text-indigo-400" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 shadow-sm rounded-tl-sm flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                <span className="text-sm text-zinc-400">Radix is thinking...</span>
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-[#0a0a0a] border-t border-white/10">
        {/* Attachment Preview */}
        {attachments.length > 0 && (
          <div className="flex gap-2 p-3 bg-[#0a0a0a]/50 border-b border-white/10 overflow-x-auto custom-scrollbar">
            {attachments.map((att, idx) => (
              <div key={idx} className="relative flex-shrink-0 w-14 h-14 rounded-lg border border-white/10 overflow-hidden group bg-white/5 shadow-sm">
                {att.mimeType.startsWith('image/') ? (
                  <img src={att.url} alt="attachment" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/5 flex flex-col items-center justify-center">
                    <VideoIcon className="h-6 w-6 text-zinc-400 mb-1" />
                    <span className="text-[10px] text-zinc-500 truncate w-full px-1 text-center">{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2 p-3 w-full items-end">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            title="Attach image or video"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,video/mp4,video/webm"
            multiple
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask Radix anything..."
            className="flex-1 rounded-xl border-0 py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-zinc-500 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm min-h-[40px] max-h-32 resize-y bg-white/5 custom-scrollbar"
            disabled={loading}
            rows={1}
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && attachments.length === 0)}
            className="flex-shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 transition-all border border-indigo-500/50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
