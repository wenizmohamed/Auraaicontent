import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Plus, Filter, Columns, Grid, Download, Tag, Users,
  MessageSquare, X, ChevronRight, ChevronDown, Hash, Mic, Search,
  GripVertical, Radio, Newspaper, Film, MoreHorizontal, Trash2, Edit3,
  Sparkles, Link as LinkIcon, Paperclip, AlignLeft, Loader2, Wand2, Lightbulb, ExternalLink,
  Link2, Palette
} from 'lucide-react';
import { expandTopicBrief, suggestTopics, generateTopicOutline, type AIProvider, type VisualReference as AIVisualRef } from '../lib/ai';
import VisualRefSearch from '../components/VisualRefSearch';
import { motionUI } from '../lib/motion';
import { MaskedGridIcon } from '../components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TopicStatus = 'draft' | 'review' | 'approved' | 'in-production' | 'published';

interface TopicReference {
  id: string;
  url: string;
  type: 'url' | 'pdf' | 'moodboard';
  note: string;
}

interface TopicOutline {
  id: string;
  submittedBy: string;
  content: string;
  createdAt: string;
}

interface Topic {
  id: string;
  station: string;
  title: string;
  description: string;
  targetAudience: string;
  keyMessages: string;
  tone: string;
  hashtags: string[];
  status: TopicStatus;
  adAssignments: string[];
  references: TopicReference[];
  outlines: TopicOutline[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'radix_topics';

// Markets/desks (2026-07-14, Habiba): expanded from Lebanon-only to the full
// GCC + MENA set + the two editorial desks. Focus text lives in ai.ts MARKET_FOCUS.
const STATIONS = ['Oman', 'Saudi Arabia', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Egypt', 'Lebanon', 'Jordan', 'Investigations', 'Clips'] as const;

const DEFAULT_STATION_COLOR = { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/20' };
const STATION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Oman:           { bg: 'bg-red-500/15',     text: 'text-red-400',     border: 'border-red-500/20' },
  'Saudi Arabia': { bg: 'bg-green-500/15',   text: 'text-green-400',   border: 'border-green-500/20' },
  UAE:            { bg: 'bg-sky-500/15',     text: 'text-sky-400',     border: 'border-sky-500/20' },
  Qatar:          { bg: 'bg-purple-500/15',  text: 'text-purple-400',  border: 'border-purple-500/20' },
  Kuwait:         { bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    border: 'border-cyan-500/20' },
  Bahrain:        { bg: 'bg-rose-500/15',    text: 'text-rose-400',    border: 'border-rose-500/20' },
  Egypt:          { bg: 'bg-yellow-500/15',  text: 'text-yellow-400',  border: 'border-yellow-500/20' },
  Lebanon:        { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  Jordan:         { bg: 'bg-indigo-500/15',  text: 'text-indigo-400',  border: 'border-indigo-500/20' },
  Investigations: { bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-500/20' },
  Clips:          { bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-400', border: 'border-fuchsia-500/20' },
};

const STATION_ICONS: Record<string, React.ReactNode> = {
  Investigations: <Newspaper className="w-3 h-3" />,
  Clips:          <Film className="w-3 h-3" />,
};
const DEFAULT_STATION_ICON = <Radio className="w-3 h-3" />;

const KANBAN_COLUMNS: { id: TopicStatus; label: string; color: string; dot: string }[] = [
  { id: 'draft',         label: 'Draft',          color: 'text-zinc-400',    dot: 'bg-zinc-500' },
  { id: 'review',        label: 'Review',         color: 'text-blue-400',    dot: 'bg-blue-500' },
  { id: 'approved',      label: 'Approved',       color: 'text-emerald-400', dot: 'bg-emerald-500' },
  { id: 'in-production', label: 'In Production',  color: 'text-amber-400',   dot: 'bg-amber-500' },
  { id: 'published',     label: 'Published',      color: 'text-violet-400',  dot: 'bg-violet-500' },
];

const TONE_OPTIONS = [
  'Authoritative', 'Empathetic', 'Urgent', 'Investigative',
  'Inspirational', 'Conversational', 'Formal', 'Bold',
];

const EMPTY_FORM: Omit<Topic, 'id' | 'createdAt'> = {
  station: 'Lebanon',
  title: '',
  description: '',
  targetAudience: '',
  keyMessages: '',
  tone: 'Authoritative',
  hashtags: [],
  status: 'draft',
  adAssignments: [],
  references: [],
  outlines: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadTopics(): Topic[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTopics(topics: Topic[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TopicDesk() {
  const [topics, setTopics] = useState<Topic[]>(loadTopics);
  const [activeView, setActiveView] = useState<'kanban' | 'matrix'>('kanban');
  const [stationFilter, setStationFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [hashtagInput, setHashtagInput] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [contextMenu, setContextMenu] = useState<{ topicId: string; x: number; y: number } | null>(null);
  const [aiProvider, setAIProvider] = useState<AIProvider>('gemini');
  const [aiLoading, setAiLoading] = useState<string | null>(null); // topic id or 'suggest'
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ title: string; description: string; audience: string }[]>([]);
  const [refModal, setRefModal] = useState<string | null>(null); // topic id
  const [refForm, setRefForm] = useState({ url: '', type: 'url' as TopicReference['type'], note: '' });
  const [outlineModal, setOutlineModal] = useState<string | null>(null); // topic id
  const [outlineText, setOutlineText] = useState('');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  // ---- AI: Expand topic brief ----
  const handleAIExpand = useCallback(async (topicId: string) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    setAiLoading(topicId);
    try {
      const result = await expandTopicBrief(topic, aiProvider);
      setTopics(prev => prev.map(t => t.id === topicId ? {
        ...t,
        description: result.description || t.description,
        targetAudience: result.targetAudience || t.targetAudience,
        keyMessages: result.keyMessages || t.keyMessages,
        hashtags: result.hashtags?.length ? result.hashtags : t.hashtags,
        tone: result.tone || t.tone,
      } : t));
    } catch (err) {
      console.error('AI expand failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [topics, aiProvider]);

  // ---- AI: Suggest topics ----
  const handleAISuggest = useCallback(async () => {
    setAiLoading('suggest');
    try {
      const result = await suggestTopics(stationFilter === 'All' ? 'Lebanon' : stationFilter, '', aiProvider);
      setSuggestions(result);
      setShowSuggestions(true);
    } catch (err) {
      console.error('AI suggest failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [stationFilter, aiProvider]);

  // ---- AI: Generate outline ----
  const handleAIOutline = useCallback(async (topicId: string) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    setAiLoading(topicId + '-outline');
    try {
      const content = await generateTopicOutline(topic.title, topic.description, topic.station, aiProvider);
      const newOutline: TopicOutline = { id: crypto.randomUUID(), submittedBy: 'AI', content, createdAt: new Date().toISOString() };
      setTopics(prev => prev.map(t => t.id === topicId ? { ...t, outlines: [...(t.outlines || []), newOutline] } : t));
    } catch (err) {
      console.error('AI outline failed:', err);
    } finally {
      setAiLoading(null);
    }
  }, [topics, aiProvider]);

  // ---- Add reference ----
  const addReference = useCallback((topicId: string) => {
    if (!refForm.url) return;
    const ref: TopicReference = { id: crypto.randomUUID(), ...refForm };
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, references: [...(t.references || []), ref] } : t));
    setRefForm({ url: '', type: 'url', note: '' });
    setRefModal(null);
  }, [refForm]);

  // ---- Add outline ----
  const addOutline = useCallback((topicId: string) => {
    if (!outlineText.trim()) return;
    const outline: TopicOutline = { id: crypto.randomUUID(), submittedBy: 'User', content: outlineText, createdAt: new Date().toISOString() };
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, outlines: [...(t.outlines || []), outline] } : t));
    setOutlineText('');
    setOutlineModal(null);
  }, [outlineText]);

  // ---- Create from suggestion ----
  const createFromSuggestion = useCallback((s: { title: string; description: string; audience: string }) => {
    const newTopic: Topic = {
      id: crypto.randomUUID(),
      station: stationFilter === 'All' ? 'Lebanon' : stationFilter,
      title: s.title,
      description: s.description,
      targetAudience: s.audience,
      keyMessages: '',
      tone: 'Authoritative',
      hashtags: [],
      status: 'draft',
      adAssignments: [],
      references: [],
      outlines: [],
      createdAt: new Date().toISOString(),
    };
    setTopics(prev => [newTopic, ...prev]);
  }, [stationFilter]);

  // Persist to localStorage on every change
  useEffect(() => { saveTopics(topics); }, [topics]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // ---- Filtered topics ----
  const filtered = topics.filter(t => {
    const matchStation = stationFilter === 'All' || t.station === stationFilter;
    const matchSearch = !searchQuery ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStation && matchSearch;
  });

  // ---- CRUD ----
  const createTopic = useCallback(() => {
    const newTopic: Topic = {
      ...form,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setTopics(prev => [newTopic, ...prev]);
    setForm(EMPTY_FORM);
    setHashtagInput('');
    setIsCreateOpen(false);
  }, [form]);

  const updateTopic = useCallback(() => {
    if (!editingTopic) return;
    setTopics(prev =>
      prev.map(t => (t.id === editingTopic.id ? { ...editingTopic, ...form } : t))
    );
    setEditingTopic(null);
    setForm(EMPTY_FORM);
    setHashtagInput('');
  }, [editingTopic, form]);

  const deleteTopic = useCallback((id: string) => {
    setTopics(prev => prev.filter(t => t.id !== id));
    setContextMenu(null);
  }, []);

  const moveTopic = useCallback((id: string, newStatus: TopicStatus) => {
    setTopics(prev =>
      prev.map(t => (t.id === id ? { ...t, status: newStatus } : t))
    );
  }, []);

  const openEdit = useCallback((topic: Topic) => {
    setEditingTopic(topic);
    setForm({
      station: topic.station,
      title: topic.title,
      description: topic.description,
      targetAudience: topic.targetAudience,
      keyMessages: topic.keyMessages,
      tone: topic.tone,
      hashtags: [...topic.hashtags],
      status: topic.status,
      adAssignments: [...topic.adAssignments],
      references: [...topic.references],
      outlines: [...topic.outlines],
    });
    setHashtagInput('');
  }, []);

  // ---- Hashtag handler ----
  const addHashtag = useCallback(() => {
    const tag = hashtagInput.trim().replace(/^#/, '');
    if (tag && !form.hashtags.includes(tag)) {
      setForm(prev => ({ ...prev, hashtags: [...prev.hashtags, tag] }));
    }
    setHashtagInput('');
  }, [hashtagInput, form.hashtags]);

  const removeHashtag = useCallback((tag: string) => {
    setForm(prev => ({ ...prev, hashtags: prev.hashtags.filter(h => h !== tag) }));
  }, []);

  // ---- Ad Assignment helpers ----
  const setAdAssignment = useCallback((index: number, topicId: string) => {
    setTopics(prev => {
      // Remove this ad slot from any other topic first
      const updated = prev.map(t => ({
        ...t,
        adAssignments: t.adAssignments.filter(a => a !== `Ad ${index + 1}`),
      }));
      // Assign to the target topic
      return updated.map(t =>
        t.id === topicId
          ? { ...t, adAssignments: [...t.adAssignments.filter(a => a !== `Ad ${index + 1}`), `Ad ${index + 1}`] }
          : t
      );
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Render: Station Filter Bar
  // ---------------------------------------------------------------------------
  const renderFilterBar = () => (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
        <Filter className="w-4 h-4" />
        Station
      </div>
      {['All', ...STATIONS].map(station => {
        const isActive = stationFilter === station;
        const sc = station !== 'All' ? (STATION_COLORS[station] || DEFAULT_STATION_COLOR) : null;
        return (
          <button
            key={station}
            onClick={() => setStationFilter(station)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all border ${
              isActive
                ? sc
                  ? `${sc.bg} ${sc.text} ${sc.border}`
                  : 'bg-violet-500/15 text-violet-400 border-violet-500/20'
                : 'bg-white/5 text-zinc-500 border-white/5 hover:bg-white/10 hover:text-zinc-300'
            }`}
          >
            {station !== 'All' && (STATION_ICONS[station] || DEFAULT_STATION_ICON)}
            {station !== 'All' && <span className="ml-1.5">{station}</span>}
            {station === 'All' && 'All Stations'}
          </button>
        );
      })}

      {/* Search */}
      <div className="relative ml-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search topics..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9 pr-3 py-2 w-56 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
        />
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Kanban Board
  // ---------------------------------------------------------------------------
  const renderKanban = () => (
    <div className="flex gap-5 overflow-x-auto pb-4 custom-scrollbar snap-x">
      {KANBAN_COLUMNS.map(col => {
        const items = filtered.filter(t => t.status === col.id);
        return (
          <div
            key={col.id}
            className="bg-white/[0.03] rounded-2xl p-4 border border-white/[0.06] flex flex-col min-w-[280px] w-[280px] max-h-[680px] shrink-0 snap-center"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                <h3 className={`text-xs font-bold uppercase tracking-wider ${col.color}`}>
                  {col.label}
                </h3>
              </div>
              <span className="bg-white/10 text-zinc-500 text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center">
                {items.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
              {items.length === 0 && (
                <div className="text-center py-10 text-zinc-600 text-xs">
                  No topics
                </div>
              )}
              {items.map(topic => {
                const sc = STATION_COLORS[topic.station] || DEFAULT_STATION_COLOR;
                return (
                  <motion.div
                    key={topic.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-black/40 rounded-xl border border-white/5 hover:border-white/15 transition-all group relative"
                  >
                    {/* Card Body */}
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${sc.bg} ${sc.text} ${sc.border}`}>
                          {STATION_ICONS[topic.station] || DEFAULT_STATION_ICON}
                          {topic.station}
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setContextMenu({ topicId: topic.id, x: e.clientX, y: e.clientY });
                          }}
                          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 transition-all p-0.5"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>

                      <h4 className="text-sm font-semibold text-zinc-200 mb-1.5 line-clamp-2 leading-snug">
                        {topic.title}
                      </h4>
                      {topic.description && (
                        <p className="text-xs text-zinc-500 line-clamp-2 mb-3 leading-relaxed">
                          {topic.description}
                        </p>
                      )}

                      {/* Hashtags */}
                      {topic.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {topic.hashtags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[10px] text-violet-400/80 bg-violet-500/10 px-1.5 py-0.5 rounded">
                              #{tag}
                            </span>
                          ))}
                          {topic.hashtags.length > 3 && (
                            <span className="text-[10px] text-zinc-500">+{topic.hashtags.length - 3}</span>
                          )}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between text-[10px] text-zinc-600">
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {topic.targetAudience || 'General'}
                        </div>
                        <span>{relativeDate(topic.createdAt)}</span>
                      </div>

                      {/* Ad Badges */}
                      {topic.adAssignments.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {topic.adAssignments.map(ad => (
                            <span key={ad} className="text-[9px] font-bold uppercase bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded">
                              {ad}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* References + Outlines badges */}
                      <div className="flex items-center gap-2 mt-2">
                        {(topic.references?.length || 0) > 0 && (
                          <span className="text-[9px] flex items-center gap-0.5 text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                            <Paperclip className="w-2.5 h-2.5" /> {topic.references.length} ref{topic.references.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {(topic.outlines?.length || 0) > 0 && (
                          <span className="text-[9px] flex items-center gap-0.5 text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            <AlignLeft className="w-2.5 h-2.5" /> {topic.outlines.length} outline{topic.outlines.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* AI + Ref + Outline action buttons */}
                      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); handleAIExpand(topic.id); }}
                          disabled={aiLoading === topic.id}
                          className="text-[9px] flex items-center gap-0.5 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 px-1.5 py-1 rounded-md transition-colors disabled:opacity-50"
                          title="AI Expand. Fill missing fields"
                        >
                          {aiLoading === topic.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />} AI Expand
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setRefModal(topic.id); }}
                          className="text-[9px] flex items-center gap-0.5 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 px-1.5 py-1 rounded-md transition-colors"
                        >
                          <Paperclip className="w-2.5 h-2.5" /> Ref
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setOutlineModal(topic.id); }}
                          className="text-[9px] flex items-center gap-0.5 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-1 rounded-md transition-colors"
                        >
                          <AlignLeft className="w-2.5 h-2.5" /> Outline
                        </button>
                      </div>

                      {/* Expanded detail: references + outlines */}
                      {expandedCard === topic.id && (
                        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                          {topic.references?.map(ref => (
                            <a key={ref.id} href={ref.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-[10px] text-cyan-400 hover:text-cyan-300">
                              <ExternalLink className="w-3 h-3" /> {ref.note || ref.url}
                            </a>
                          ))}
                          {topic.outlines?.map(ol => (
                            <div key={ol.id} className="text-[10px] text-zinc-500 bg-white/5 rounded-md p-2">
                              <span className="text-zinc-400 font-medium">{ol.submittedBy}:</span> {ol.content.substring(0, 120)}...
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Expand toggle */}
                    {((topic.references?.length || 0) > 0 || (topic.outlines?.length || 0) > 0) && (
                      <button
                        onClick={e => { e.stopPropagation(); setExpandedCard(expandedCard === topic.id ? null : topic.id); }}
                        className="w-full text-center text-[9px] text-zinc-600 hover:text-zinc-400 py-1 border-t border-white/5 transition-colors"
                      >
                        {expandedCard === topic.id ? 'Collapse' : 'Show details'}
                      </button>
                    )}

                    {/* Move Buttons */}
                    <div className="border-t border-white/5 px-3 py-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {KANBAN_COLUMNS.filter(c => c.id !== topic.status).map(target => (
                        <button
                          key={target.id}
                          onClick={() => moveTopic(topic.id, target.id)}
                          className={`flex-1 text-[9px] font-semibold uppercase tracking-wider py-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors ${target.color}`}
                        >
                          {target.label}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Ad Assignment Matrix
  // ---------------------------------------------------------------------------
  const renderAdMatrix = () => {
    const adSlots = [0, 1, 2, 3, 4]; // Ad 1 through Ad 5
    const approvedTopics = filtered.filter(t => t.status === 'approved' || t.status === 'in-production' || t.status === 'published');

    return (
      <div className="bg-white/[0.03] rounded-2xl border border-white/[0.06] overflow-hidden">
        <div className="p-6 border-b border-white/[0.06]">
          <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
            <Grid className="w-5 h-5 text-violet-400" />
            Ad Assignment Matrix
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            Map ad slots to approved topics. Only approved, in-production, and published topics appear.
          </p>
        </div>

        {approvedTopics.length === 0 ? (
          <div className="p-12 text-center">
            <Grid className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No approved topics to assign. Move topics to Approved first.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-zinc-500 p-4 w-[180px]">Ad Slot</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-zinc-500 p-4">Assigned Topic</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-zinc-500 p-4 w-[120px]">Station</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-zinc-500 p-4 w-[120px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {adSlots.map(idx => {
                  const adLabel = `Ad ${idx + 1}`;
                  const assigned = topics.find(t => t.adAssignments.includes(adLabel));
                  return (
                    <tr key={idx} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="p-4">
                        <span className="inline-flex items-center gap-2 text-violet-400 font-bold">
                          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-400 text-xs font-black">
                            {idx + 1}
                          </div>
                          {adLabel}
                        </span>
                      </td>
                      <td className="p-4">
                        <select
                          value={assigned?.id || ''}
                          onChange={e => {
                            if (e.target.value) {
                              setAdAssignment(idx, e.target.value);
                            } else {
                              // Unassign
                              setTopics(prev =>
                                prev.map(t => ({
                                  ...t,
                                  adAssignments: t.adAssignments.filter(a => a !== adLabel),
                                }))
                              );
                            }
                          }}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:ring-1 focus:ring-violet-500 outline-none [&>option]:bg-zinc-900"
                        >
                          <option value="">-- Unassigned --</option>
                          {approvedTopics.map(t => (
                            <option key={t.id} value={t.id}>{t.title} ({t.station})</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-4">
                        {assigned ? (
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${(STATION_COLORS[assigned.station]||DEFAULT_STATION_COLOR).bg} ${(STATION_COLORS[assigned.station]||DEFAULT_STATION_COLOR).text} ${(STATION_COLORS[assigned.station]||DEFAULT_STATION_COLOR).border}`}>
                            {assigned.station}
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">--</span>
                        )}
                      </td>
                      <td className="p-4">
                        {assigned ? (
                          <span className={`text-xs font-semibold uppercase ${KANBAN_COLUMNS.find(c => c.id === assigned.status)?.color}`}>
                            {KANBAN_COLUMNS.find(c => c.id === assigned.status)?.label}
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Create / Edit Modal
  // ---------------------------------------------------------------------------
  const renderFormModal = () => {
    const isEditing = !!editingTopic;
    const isOpen = isCreateOpen || isEditing;
    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (isEditing) {
        updateTopic();
      } else {
        createTopic();
      }
    };

    const closeModal = () => {
      setIsCreateOpen(false);
      setEditingTopic(null);
      setForm(EMPTY_FORM);
      setHashtagInput('');
    };

    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="bg-[#0f0f0f] rounded-3xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl shadow-violet-500/5 flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/[0.06] flex justify-between items-center bg-white/[0.02]">
              <div>
                <h2 className="text-xl font-display font-bold text-white">
                  {isEditing ? 'Edit Topic' : 'Create New Topic'}
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  {isEditing ? 'Update topic details below' : 'Fill out the template to create a new topic'}
                </p>
              </div>
              <button onClick={closeModal} className="text-zinc-500 hover:text-white transition-colors p-1 bg-white/5 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Title *</label>
                <input
                  required
                  type="text"
                  value={form.title}
                  onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 outline-none transition-colors"
                  placeholder="e.g., Breaking: Beirut Port Investigation Update"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Description *</label>
                <textarea
                  required
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 outline-none resize-none transition-colors"
                  placeholder="Brief overview of the topic and its angle..."
                />
              </div>

              {/* Station + Tone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Station *</label>
                  <select
                    value={form.station}
                    onChange={e => setForm(prev => ({ ...prev, station: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-1 focus:ring-violet-500 outline-none [&>option]:bg-zinc-900 transition-colors"
                  >
                    {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Tone of Voice</label>
                  <select
                    value={form.tone}
                    onChange={e => setForm(prev => ({ ...prev, tone: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-1 focus:ring-violet-500 outline-none [&>option]:bg-zinc-900 transition-colors"
                  >
                    {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Target Audience */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-zinc-400" /> Target Audience</span>
                </label>
                <input
                  type="text"
                  value={form.targetAudience}
                  onChange={e => setForm(prev => ({ ...prev, targetAudience: e.target.value }))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 outline-none transition-colors"
                  placeholder="e.g., 25-45, Arabic-speaking, news enthusiasts"
                />
              </div>

              {/* Key Messages */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-zinc-400" /> Key Messages</span>
                </label>
                <textarea
                  value={form.keyMessages}
                  onChange={e => setForm(prev => ({ ...prev, keyMessages: e.target.value }))}
                  rows={2}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 outline-none resize-none transition-colors"
                  placeholder="Core points to communicate (one per line)"
                />
              </div>

              {/* Hashtags */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-zinc-400" /> Hashtags</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={hashtagInput}
                    onChange={e => setHashtagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHashtag(); } }}
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-zinc-600 focus:ring-1 focus:ring-violet-500 outline-none transition-colors"
                    placeholder="Type a hashtag and press Enter..."
                  />
                  <button
                    type="button"
                    onClick={addHashtag}
                    className="px-4 bg-violet-500/15 text-violet-400 rounded-xl border border-violet-500/20 hover:bg-violet-500/25 transition-colors text-sm font-medium"
                  >
                    Add
                  </button>
                </div>
                {form.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.hashtags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/15 px-2.5 py-1 rounded-lg"
                      >
                        #{tag}
                        <button type="button" onClick={() => removeHashtag(tag)} className="hover:text-white transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-4 flex justify-end gap-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-5 py-2.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-violet-500/20 text-sm"
                >
                  {isEditing ? 'Save Changes' : 'Create Topic'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </AnimatePresence>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Context Menu
  // ---------------------------------------------------------------------------
  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const topic = topics.find(t => t.id === contextMenu.topicId);
    if (!topic) return null;

    return (
      <div
        className="fixed z-popover bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[160px] animate-fade-in"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => { openEdit(topic); setContextMenu(null); }}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" /> Edit Topic
        </button>
        <button
          onClick={() => deleteTopic(topic.id)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Empty State
  // ---------------------------------------------------------------------------
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <MaskedGridIcon icon={FileText} className="mb-6" />
      <h3 className="text-xl font-display font-bold mb-2" style={{ color: 'var(--color-fg)' }}>No topics yet</h3>
      <p className="text-sm max-w-sm mb-6 leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
        Create your first topic to get started with the content production pipeline. Topics flow through Draft, Review, Approved, In Production, and Published.
      </p>
      <button
        onClick={() => setIsCreateOpen(true)}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-colors hover:brightness-110"
        style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
      >
        <Plus className="w-4 h-4" /> Create First Topic
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Stats bar
  // ---------------------------------------------------------------------------
  const stats = KANBAN_COLUMNS.map(col => ({
    ...col,
    count: topics.filter(t => t.status === col.id).length,
  }));

  // ---------------------------------------------------------------------------
  // Main Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12">
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-black/20 p-8 shadow-2xl border border-white/10"
      >
        <div aria-hidden className="absolute inset-0 z-0" style={{ background: 'linear-gradient(135deg, var(--color-accent-subtle), transparent 70%)' }} />
        <div aria-hidden className="absolute -top-24 -end-24 w-96 h-96 rounded-full blur-3xl z-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }} />

        <div className="relative z-10 flex items-center gap-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20">
            <FileText className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--color-fg-subtle)' }}>
              Make · Topics
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-1" style={{ color: 'var(--color-fg)' }}>
              Topic Desk
            </h1>
            <p className="text-zinc-400 text-base">
              Create, organize, and assign content topics across stations. Manage the full production pipeline from draft to publish.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(topics, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `radix_topics_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-sm font-medium transition-colors border border-white/10"
              title="Export topics as JSON"
            >
              <Download className="w-4 h-4" /> Export
            </button>

            {/* AI Provider Toggle */}
            <div className="flex items-center bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              {(['gemini', 'claude'] as AIProvider[]).map(p => (
                <button key={p} onClick={() => setAIProvider(p)}
                  className={`px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${aiProvider === p ? 'bg-violet-500/20 text-violet-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
                  {p === 'gemini' ? '✦ Gemini' : '◆ Claude'}
                </button>
              ))}
            </div>

            {/* AI Suggest */}
            <button
              onClick={handleAISuggest}
              disabled={aiLoading === 'suggest'}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600/80 to-fuchsia-600/80 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50 border border-violet-500/20"
            >
              {aiLoading === 'suggest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />} AI Suggest
            </button>

            <button
              onClick={() => { setForm(EMPTY_FORM); setHashtagInput(''); setIsCreateOpen(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-violet-500/20"
            >
              <Plus className="w-4 h-4" /> New Topic
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stats Strip */}
      <div className="grid grid-cols-5 gap-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionUI, delay: i * 0.05 }}
            className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex items-center gap-3"
          >
            <div className={`w-3 h-3 rounded-full ${s.dot}`} />
            <div>
              <div className="text-lg font-display font-bold text-white">{s.count}</div>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${s.color}`}>{s.label}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06]">
        {renderFilterBar()}
      </div>

      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex space-x-1 bg-white/5 p-1 rounded-xl border border-white/10 w-fit">
          <button
            onClick={() => setActiveView('kanban')}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeView === 'kanban'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            <Columns className="w-4 h-4" /> Kanban Board
          </button>
          <button
            onClick={() => setActiveView('matrix')}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeView === 'matrix'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            <Grid className="w-4 h-4" /> Ad Matrix
          </button>
        </div>
        <div className="text-xs text-zinc-600">
          {filtered.length} topic{filtered.length !== 1 ? 's' : ''} shown
        </div>
      </div>

      {/* Content Area */}
      {topics.length === 0 ? (
        renderEmptyState()
      ) : (
        <>
          {activeView === 'kanban' && renderKanban()}
          {activeView === 'matrix' && renderAdMatrix()}
        </>
      )}

      {/* Modals */}
      {renderFormModal()}
      {renderContextMenu()}

      {/* AI Suggestions Modal */}
      {showSuggestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSuggestions(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-400" /> AI Topic Suggestions</h2>
              <button onClick={() => setShowSuggestions(false)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-violet-500/30 transition-colors">
                  <h3 className="text-white font-semibold text-sm mb-1">{s.title}</h3>
                  <p className="text-zinc-500 text-xs mb-2">{s.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-600"><Users className="inline w-3 h-3 mr-1" />{s.audience}</span>
                    <button onClick={() => { createFromSuggestion(s); }}
                      className="text-[10px] flex items-center gap-1 bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 px-2 py-1 rounded-md transition-colors">
                      <Plus className="w-3 h-3" /> Create Topic
                    </button>
                  </div>
                </div>
              ))}
              {suggestions.length === 0 && <p className="text-zinc-500 text-center py-8">No suggestions yet</p>}
            </div>
          </motion.div>
        </div>
      )}

      {/* Reference Modal — with AI Visual Search */}
      {refModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8" onClick={() => setRefModal(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Paperclip className="h-5 w-5 text-cyan-400" /> Visual References</h2>
              <button onClick={() => setRefModal(null)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            {/* AI Visual Reference Search */}
            <div className="mb-6">
              <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-violet-400" />
                Search real reference images from Wikimedia Commons. Click Pinterest to browse more. Click "Use This" to attach
              </div>
              <VisualRefSearch
                visualIdea={topics.find(t => t.id === refModal)?.description || ''}
                provider={aiProvider}
                onSelect={(ref) => {
                  const topicRef: TopicReference = {
                    id: crypto.randomUUID(),
                    url: ref.sourceUrl,
                    type: 'moodboard',
                    note: `[${ref.sourceName}] ${ref.description}. Image: ${ref.imageUrl}`,
                  };
                  setTopics(prev => prev.map(t => t.id === refModal ? { ...t, references: [...(t.references || []), topicRef] } : t));
                }}
              />
            </div>

            {/* Manual URL add */}
            <div className="border-t border-white/10 pt-4 mb-4">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Or add manually</h3>
              <div className="flex gap-2">
                <input value={refForm.url} onChange={e => setRefForm({ ...refForm, url: e.target.value })} placeholder="Paste URL..."
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-cyan-500 focus:border-transparent" />
                <div className="flex gap-1">
                  {(['url', 'pdf', 'moodboard'] as const).map(t => {
                    const Icon = t === 'url' ? Link2 : t === 'pdf' ? FileText : Palette;
                    const label = t === 'url' ? 'URL reference' : t === 'pdf' ? 'PDF reference' : 'Moodboard reference';
                    return (
                      <button key={t} onClick={() => setRefForm({ ...refForm, type: t })}
                        aria-label={label}
                        title={label}
                        className={`px-2 py-2 rounded-lg text-[10px] font-medium transition-all ${refForm.type === t ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-zinc-600'}`}>
                        <Icon className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
                <input value={refForm.note} onChange={e => setRefForm({ ...refForm, note: e.target.value })} placeholder="Note..."
                  className="w-32 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-cyan-500 focus:border-transparent" />
                <button onClick={() => addReference(refModal)} disabled={!refForm.url}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50 transition-colors shrink-0">
                  Add
                </button>
              </div>
            </div>

            {/* Existing references with image previews */}
            {(() => {
              const t = topics.find(t => t.id === refModal);
              if (!t?.references?.length) return null;
              return (
                <div className="border-t border-white/10 pt-4 space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Attached References ({t.references.length})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {t.references.map(ref => {
                      const imgMatch = ref.note?.match(/Image:\s*(https?:\/\/[^\s]+)/);
                      const imgUrl = imgMatch?.[1];
                      return (
                        <div key={ref.id} className="bg-white/5 rounded-xl overflow-hidden border border-white/10 group">
                          {imgUrl && (
                            <div className="aspect-[4/3] bg-zinc-900">
                              <img src={imgUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          )}
                          <div className="p-2">
                            <a href={ref.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 truncate">
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {ref.url.replace(/https?:\/\/(www\.)?/, '').slice(0, 40)}
                            </a>
                            {ref.note && !imgMatch && (
                              <p className="text-[9px] text-zinc-600 mt-0.5 truncate">{ref.note}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </motion.div>
        </div>
      )}

      {/* Outline Modal */}
      {outlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setOutlineModal(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2"><AlignLeft className="h-5 w-5 text-emerald-400" /> Topic Outline</h2>
              <button onClick={() => setOutlineModal(null)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <textarea value={outlineText} onChange={e => setOutlineText(e.target.value)} rows={6}
                placeholder="Write the topic outline here... or click AI Generate below"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-zinc-600 focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none" />
              <div className="flex gap-2">
                <button onClick={() => handleAIOutline(outlineModal)}
                  disabled={aiLoading === outlineModal + '-outline'}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600/80 to-fuchsia-600/80 text-white py-2.5 rounded-lg text-sm font-medium hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50 transition-all">
                  {aiLoading === outlineModal + '-outline' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} AI Generate
                </button>
                <button onClick={() => addOutline(outlineModal)} disabled={!outlineText.trim()}
                  className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 transition-colors">
                  Save Outline
                </button>
              </div>
            </div>

            {/* Existing outlines */}
            {(() => {
              const t = topics.find(t => t.id === outlineModal);
              if (!t?.outlines?.length) return null;
              return (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-2 max-h-48 overflow-y-auto">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Existing Outlines</h3>
                  {t.outlines.map(ol => (
                    <div key={ol.id} className="bg-white/5 rounded-lg p-3 text-xs text-zinc-400">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-emerald-400 font-medium">{ol.submittedBy}</span>
                        <span className="text-zinc-600">{new Date(ol.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{ol.content}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </motion.div>
        </div>
      )}
    </div>
  );
}
