import { useState, useMemo, useEffect, useCallback } from 'react';
import { Loader2, Calendar as CalendarIcon, Sparkles, CheckCircle2, Copy, Linkedin, Instagram, Twitter, Facebook, Video, X, Image, ExternalLink, Search, Bot, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, Post } from '../lib/store';
import { generateContent, searchVisualReferences, type VisualReference, type AIProvider } from '../lib/ai';
import { PLATFORM_LIMITS, validateCaption } from '../lib/platform-limits';
import { getPlatformLimitsContext } from '../lib/prompts';
import { getClients, getClientById, type ClientKB } from '../lib/clients';

export default function ContentCalendar() {
  const clients = useMemo(() => getClients(), []);
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || '');
  const [brief, setBrief] = useState('Generate a content calendar for next month. Include a mix of brand awareness, product promotion, and engagement posts across Instagram, LinkedIn, TikTok, and X. Include relevant cultural occasions and holidays.');
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const { posts, setPosts } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [activePlatformFilter, setActivePlatformFilter] = useState('All');
  const [selectedDayPosts, setSelectedDayPosts] = useState<{day: number, posts: Post[]} | null>(null);
  const [visualRefs, setVisualRefs] = useState<Record<string, VisualReference[]>>(() => {
    try { return JSON.parse(localStorage.getItem('radix_calendar_visrefs') || '{}'); } catch { return {}; }
  });
  const [loadingRefs, setLoadingRefs] = useState<string | null>(null);

  // Persist visual refs whenever they change
  useEffect(() => {
    if (Object.keys(visualRefs).length > 0) {
      localStorage.setItem('radix_calendar_visrefs', JSON.stringify(visualRefs));
    }
  }, [visualRefs]);

  // Derive current month for calendar display
  const now = new Date();
  const calendarMonth = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const currentMonthName = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const currentMonthShort = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayOffset = new Date(now.getFullYear(), now.getMonth(), 1).getDay(); // 0=Sun

  // Extract day number from various AI date formats
  const extractDay = (dateStr: string): number | null => {
    if (!dateStr) return null;
    const s = dateStr.trim();
    // "2026-04-15" or "2024-08-02" → extract day part
    const isoMatch = s.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (isoMatch) return parseInt(isoMatch[2]);
    // "Day 5" or "Day 15"
    const dayMatch = s.match(/^day\s+(\d+)$/i);
    if (dayMatch) return parseInt(dayMatch[1]);
    // "April 15" or "Apr 15" or "15 April" or "15th April"
    const monthDayMatch = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s*$/);
    if (monthDayMatch) return parseInt(monthDayMatch[1]);
    const dayFirstMatch = s.match(/^(\d{1,2})(?:st|nd|rd|th)?/);
    if (dayFirstMatch) return parseInt(dayFirstMatch[1]);
    // Last resort: last number in string
    const nums = s.match(/\d+/g);
    if (nums) return parseInt(nums[nums.length - 1]);
    return null;
  };

  const fetchVisualRefs = async (postId: string, visualIdea: string) => {
    if (visualRefs[postId]?.length) return;
    setLoadingRefs(postId);
    try {
      const refs = await searchVisualReferences(visualIdea, aiProvider);
      setVisualRefs(prev => ({ ...prev, [postId]: refs }));
    } catch (err) {
      console.error('Failed to fetch visual refs:', err);
    } finally {
      setLoadingRefs(null);
    }
  };

  const generateCalendar = async () => {
    setLoading(true);
    setError('');
    setPosts([]);
    setVisualRefs({});
    localStorage.removeItem('radix_calendar_visrefs');

    const client = getClientById(selectedClientId);
    const platforms = ['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'];
    const platformLimits = getPlatformLimitsContext(platforms);

    const prompt = `You are an expert social media manager${client ? ` for ${client.name}, a ${client.industry} company in the UAE` : ' at Radix Media, a UAE digital marketing agency'}.
${client ? `
CLIENT KNOWLEDGE BASE:
- Brand Tone: ${client.tone}
- Key Messages: ${client.keyMessages.join(' | ')}
- Products: ${client.products.map(p => `${p.name}: ${p.description}`).join('\n')}
- Compliance: ${client.complianceNotes}
- Social Handles: ${Object.entries(client.socialHandles).map(([k,v]) => `${k}: ${v}`).join(', ')}
` : ''}
Generate a comprehensive social media content calendar based on this brief:

Brief: ${brief}

Requirements:
- Generate 6 distinct posts distributed across the month.
- For each post, provide: Date, Platform (LinkedIn, Instagram, TikTok, X, Facebook), Target Audience, Visual Reference Idea, and the exact Copy/Caption.
- Ensure strict adherence to CBUAE Consumer Protection Regulations (transparency, no misleading claims).
- Format as a valid JSON array with keys: "date", "platform", "targetAudience", "visualIdea", "copy".
- The "date" field MUST be in format "Day X" where X is the day number (e.g. "Day 5", "Day 12", "Day 28"). Spread posts across the month.
- CRITICAL: Return ONLY valid JSON. No markdown, no code fences, no comments. Use \\n for newlines inside strings.
- The visualIdea must describe a specific scene for stock photography search (e.g. "A young professional in Dubai using a mobile banking app with city skyline in background, warm golden lighting").

PLATFORM CHARACTER LIMITS (MUST FOLLOW):
${platformLimits}

- Each caption MUST be within the platform's max limit. Aim for the optimal length.
- Include the hashtags AS PART of the copy field, not separate.`;

    try {
      const text = await generateContent(prompt, aiProvider);

      // Parse JSON from response
      let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in AI response');
      cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');

      let parsedPosts: any[];
      try {
        parsedPosts = JSON.parse(cleaned);
      } catch {
        cleaned = cleaned.replace(/"([^"]*?)"/g, (match) => {
          return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t');
        });
        try {
          parsedPosts = JSON.parse(cleaned);
        } catch {
          cleaned = jsonMatch[0].replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/,\s*([}\]])/g, '$1');
          parsedPosts = JSON.parse(cleaned);
        }
      }

      const formattedPosts = parsedPosts.map((p: any, i: number) => ({
        ...p,
        id: `post-${Date.now()}-${i}`,
        status: 'draft' as const,
      }));
      setPosts(formattedPosts);

      // Batch visual ref fetching (4 at a time, like BriefInput)
      const batchSize = 4;
      for (let i = 0; i < formattedPosts.length; i += batchSize) {
        const batch = formattedPosts.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((post: any) =>
            post.visualIdea
              ? searchVisualReferences(post.visualIdea, aiProvider)
              : Promise.resolve([])
          )
        );
        results.forEach((result, j) => {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            const postId = formattedPosts[i + j].id;
            setVisualRefs(prev => ({ ...prev, [postId]: result.value }));
          }
        });
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while generating the calendar.');
    } finally {
      setLoading(false);
    }
  };

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('linkedin')) return <Linkedin className="w-4 h-4" />;
    if (p.includes('instagram')) return <Instagram className="w-4 h-4" />;
    if (p.includes('tiktok') || p.includes('video')) return <Video className="w-4 h-4" />;
    if (p.includes('twitter') || p.includes('x')) return <Twitter className="w-4 h-4" />;
    if (p.includes('facebook')) return <Facebook className="w-4 h-4" />;
    return <Sparkles className="w-4 h-4" />;
  };

  const getPlatformColor = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('linkedin')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
    if (p.includes('instagram')) return 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400 dark:border-pink-800';
    if (p.includes('tiktok')) return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    if (p.includes('twitter') || p.includes('x')) return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800';
    if (p.includes('facebook')) return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800';
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 shadow-2xl border border-slate-800"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent z-0" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl z-0" />

        <div className="relative z-10 flex items-center gap-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/20">
            <CalendarIcon className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
              Content Calendar Generator
            </h1>
            <p className="text-slate-300 text-lg">
              Generate a social media calendar with AI-powered content and CBUAE compliance.
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />

        {/* Client + AI Provider row */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Client</label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="w-full rounded-xl border-0 py-3 px-4 text-white ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-blue-500 bg-slate-800 text-sm"
            >
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="">No client (generic)</option>
            </select>
          </div>
          <div className="w-56">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">AI Provider</label>
            <div className="flex gap-2">
              <button
                onClick={() => setAiProvider('gemini')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold transition-all ${
                  aiProvider === 'gemini'
                    ? 'bg-blue-600 text-white ring-2 ring-blue-400/50'
                    : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700 hover:ring-slate-600'
                }`}
              >
                <Zap className="w-3.5 h-3.5" /> Gemini
              </button>
              <button
                onClick={() => setAiProvider('claude')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-bold transition-all ${
                  aiProvider === 'claude'
                    ? 'bg-violet-600 text-white ring-2 ring-violet-400/50'
                    : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700 hover:ring-slate-600'
                }`}
              >
                <Bot className="w-3.5 h-3.5" /> Claude
              </button>
            </div>
          </div>
        </div>

        <div className="relative">
          <textarea
            id="brief"
            rows={6}
            className="peer block w-full rounded-xl border-0 py-6 px-4 text-white shadow-sm ring-1 ring-inset ring-slate-700 placeholder:text-transparent focus:ring-2 focus:ring-inset focus:ring-blue-500 sm:text-base sm:leading-relaxed transition-shadow duration-200 bg-slate-800"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Campaign Brief"
          />
          <label
            htmlFor="brief"
            className="absolute left-4 top-2 text-xs font-bold text-blue-400 uppercase tracking-wider transition-all peer-placeholder-shown:text-sm peer-placeholder-shown:text-slate-500 peer-placeholder-shown:top-6 peer-focus:top-2 peer-focus:text-xs peer-focus:text-blue-400"
          >
            Campaign Brief
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={generateCalendar}
            disabled={loading || !brief.trim()}
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-5 w-5" />
            )}
            {loading ? `Generating with ${aiProvider === 'claude' ? 'Claude Opus' : 'Gemini Flash'}...` : 'Generate Calendar'}
          </button>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-red-500/10 p-6 border border-red-500/20"
        >
          <div className="text-sm text-red-400 font-medium">{error}</div>
        </motion.div>
      )}

      {posts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              Generated Calendar
            </h2>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
              CBUAE Compliant
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {posts.filter(p => activePlatformFilter === 'All' || p.platform.toLowerCase().includes(activePlatformFilter.toLowerCase())).map((post, idx) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                key={post.id}
                className="group relative bg-slate-800/50 rounded-2xl p-6 border border-slate-700 hover:shadow-md transition-all duration-300 hover:border-blue-500/50"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-800 px-3 py-1 rounded-lg text-sm font-bold text-slate-300 border border-slate-700 shadow-sm">
                      {post.date}
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${getPlatformColor(post.platform)}`}>
                      {getPlatformIcon(post.platform)}
                      {post.platform}
                    </div>
                  </div>
                  <button className="text-slate-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100" title="Copy to clipboard">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Target Audience</h4>
                    <p className="text-sm text-slate-300 font-medium">{post.targetAudience}</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Visual Reference</h4>
                      {!visualRefs[post.id]?.length && (
                        <button
                          onClick={() => fetchVisualRefs(post.id, post.visualIdea || post.copy || '')}
                          disabled={loadingRefs === post.id}
                          className="flex items-center gap-1 text-[10px] font-bold text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                        >
                          {loadingRefs === post.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                          Find References
                        </button>
                      )}
                    </div>

                    <p className="text-sm text-slate-400 bg-slate-800/80 p-3 rounded-xl border border-slate-700 italic mb-2">
                      {post.visualIdea}
                    </p>

                    {visualRefs[post.id]?.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        {visualRefs[post.id].slice(0, 6).map((ref, ri) => (
                          <a
                            key={ri}
                            href={ref.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative rounded-lg overflow-hidden border border-slate-700 hover:border-violet-500/50 transition-all"
                          >
                            <div className="aspect-[4/3] bg-slate-900">
                              <img
                                src={ref.imageUrl}
                                alt={ref.description}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={e => { (e.target as HTMLImageElement).src = `https://placehold.co/400x300/1e293b/94a3b8?text=${encodeURIComponent(ref.tags[0] || 'ref')}`; }}
                              />
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5">
                              <div className="flex items-center gap-1 text-[8px] text-white font-medium">
                                <ExternalLink className="w-2.5 h-2.5" />
                                View on {ref.sourceName}
                              </div>
                            </div>
                            <div className="absolute top-1 right-1">
                              <span className={`text-[7px] font-bold uppercase px-1 py-0.5 rounded ${
                                ref.sourceName === 'Wikimedia' ? 'bg-emerald-500/80 text-white' : ref.sourceName === 'Pinterest' ? 'bg-red-500/80 text-white' :
                                ref.sourceName === 'Behance' ? 'bg-blue-500/80 text-white' :
                                'bg-white/20 text-white backdrop-blur-sm'
                              }`}>
                                {ref.sourceName}
                              </span>
                            </div>
                          </a>
                        ))}
                      </div>
                    )}

                    {loadingRefs === post.id && (
                      <div className="flex items-center gap-2 text-xs text-violet-400 mt-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Fetching references from Wikimedia Commons...
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Copy / Caption</h4>
                      {(() => {
                        const v = validateCaption(post.copy || '', post.platform);
                        return (
                          <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            v.status === 'over' ? 'bg-red-500/20 text-red-400' :
                            v.status === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            <span>{v.length}</span>
                            <span className="text-slate-600">/</span>
                            <span>{v.max}</span>
                            {v.status === 'over' && <span className="ml-1">({v.overBy} over!)</span>}
                            {v.status === 'good' && <span className="ml-1">optimal: {v.optimal}</span>}
                          </div>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-slate-200 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm whitespace-pre-wrap">
                      {post.copy}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Calendar Grid — shows all content inline */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">{calendarMonth}</h3>
          <div className="flex flex-wrap gap-2">
            {['All', 'Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'].map(platform => (
              <button
                key={platform}
                onClick={() => setActivePlatformFilter(platform)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                  activePlatformFilter === platform
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
              >
                {platform}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-4 relative">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-1">{day}</div>
            ))}
          </div>

          {/* Calendar cells with rich content */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty offset days */}
            {Array.from({ length: firstDayOffset }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-[120px] rounded-lg bg-slate-800/20 border border-slate-700/30"></div>
            ))}

            {/* Days with content */}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const dayPosts = posts.filter(p => {
                const d = extractDay(p.date);
                return d !== null && d === day;
              }).filter(p => activePlatformFilter === 'All' || p.platform.toLowerCase().includes(activePlatformFilter.toLowerCase()));

              return (
                <div
                  key={day}
                  className={`min-h-[120px] rounded-lg border p-1.5 transition-all ${
                    dayPosts.length > 0
                      ? 'bg-slate-800/80 border-slate-600 hover:border-emerald-500/50'
                      : 'bg-slate-800/30 border-slate-700/50'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 mb-1">{day}</div>

                  {/* Posts for this day */}
                  {dayPosts.map((post, pi) => {
                    const firstRef = visualRefs[post.id]?.[0];
                    return (
                      <div
                        key={pi}
                        onClick={() => setSelectedDayPosts({ day, posts: dayPosts })}
                        className="mb-1 rounded-md overflow-hidden bg-slate-900/80 border border-slate-700/50 cursor-pointer hover:border-violet-500/50 transition-all"
                      >
                        {/* Thumbnail */}
                        {firstRef && (
                          <div className="h-14 w-full overflow-hidden">
                            <img
                              src={firstRef.imageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                        )}

                        <div className="p-1.5">
                          {/* Platform badge */}
                          <div className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider border mb-0.5 ${getPlatformColor(post.platform)}`}>
                            {getPlatformIcon(post.platform)}
                            <span className="hidden lg:inline">{post.platform}</span>
                          </div>

                          {/* Caption preview */}
                          <p className="text-[8px] leading-tight text-slate-400 line-clamp-2 mt-0.5">
                            {post.copy}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Expanded day popup */}
        <AnimatePresence>
          {selectedDayPosts && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelectedDayPosts(null)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-[90%] max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-white">{calendarMonth.split(' ')[0]} {selectedDayPosts.day}</h3>
                  <button onClick={() => setSelectedDayPosts(null)} className="text-slate-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  {selectedDayPosts.posts.map((post, idx) => (
                    <div key={idx} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${getPlatformColor(post.platform)}`}>
                          {getPlatformIcon(post.platform)}
                          {post.platform}
                        </div>
                        {(() => {
                          const v = validateCaption(post.copy || '', post.platform);
                          return (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              v.status === 'over' ? 'bg-red-500/20 text-red-400' :
                              v.status === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-emerald-500/20 text-emerald-400'
                            }`}>{v.length}/{v.max}</span>
                          );
                        })()}
                      </div>

                      {/* Visual refs in popup */}
                      {visualRefs[post.id]?.length > 0 && (
                        <div className="flex gap-2 mb-3 overflow-x-auto">
                          {visualRefs[post.id].slice(0, 4).map((ref, ri) => (
                            <a key={ri} href={ref.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <img src={ref.imageUrl} alt="" className="h-16 w-24 object-cover rounded-lg border border-slate-700 hover:border-violet-500 transition-colors" />
                            </a>
                          ))}
                        </div>
                      )}

                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{post.copy}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
