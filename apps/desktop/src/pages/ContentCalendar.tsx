import { useState, useMemo } from 'react';
import { Calendar as CalendarIcon, X, ExternalLink, ChevronLeft, ChevronRight, Instagram, Linkedin, Twitter, Facebook, Video, Sparkles, FileText, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { validateCaption } from '../lib/platform-limits';
import { Link } from 'react-router-dom';

const getPlatformIcon = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('instagram')) return <Instagram className="w-3.5 h-3.5" />;
  if (p.includes('linkedin')) return <Linkedin className="w-3.5 h-3.5" />;
  if (p.includes('tiktok')) return <Video className="w-3.5 h-3.5" />;
  if (p.includes('twitter') || p.includes('x')) return <Twitter className="w-3.5 h-3.5" />;
  if (p.includes('facebook')) return <Facebook className="w-3.5 h-3.5" />;
  return <Sparkles className="w-3.5 h-3.5" />;
};

const getPlatformColor = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('instagram')) return { dot: 'bg-pink-500', badge: 'bg-pink-500/20 text-pink-400 border-pink-500/20' };
  if (p.includes('linkedin')) return { dot: 'bg-blue-500', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/20' };
  if (p.includes('tiktok')) return { dot: 'bg-zinc-400', badge: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/20' };
  if (p.includes('twitter') || p.includes('x')) return { dot: 'bg-sky-500', badge: 'bg-sky-500/20 text-sky-400 border-sky-500/20' };
  if (p.includes('facebook')) return { dot: 'bg-indigo-500', badge: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/20' };
  return { dot: 'bg-emerald-500', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' };
};

// Extract day number from AI date formats
// Handles: "2026-08-12", "August 12", "Aug 12, 2026", "12th August", "Day 12"
function extractDay(dateStr: string): number | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  const iso = s.match(/^\d{4}-\d{2}-(\d{2})$/);
  if (iso) return parseInt(iso[1]);
  const monthDay = s.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})/i);
  if (monthDay) return parseInt(monthDay[1]);
  const dayMonth = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (dayMonth) return parseInt(dayMonth[1]);
  const dayN = s.match(/day\s+(\d+)/i);
  if (dayN) return parseInt(dayN[1]);
  const nums = s.match(/(\d{1,2})/g);
  if (nums) { const last = parseInt(nums[nums.length - 1]); if (last >= 1 && last <= 31) return last; }
  return null;
}

export default function ContentCalendar() {
  const { contentBriefs } = useStore();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [platformFilter, setPlatformFilter] = useState('All');
  const [monthOffset, setMonthOffset] = useState(0);

  // Current month display
  const now = new Date();
  const displayDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthName = displayDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0).getDate();
  const firstDayOffset = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1).getDay();

  // Collect ALL pieces from ALL briefs
  const allPieces = useMemo(() => {
    const pieces: any[] = [];
    for (const brief of contentBriefs || []) {
      for (const piece of brief.pieces || []) {
        pieces.push({ ...piece, briefMonth: brief.month, clientId: brief.clientId });
      }
    }
    return pieces;
  }, [contentBriefs]);

  // Map pieces to days
  const dayPieces = useMemo(() => {
    const map: Record<number, any[]> = {};
    for (const piece of allPieces) {
      const day = extractDay(piece.suggestedDate);
      if (day && day >= 1 && day <= 31) {
        if (!map[day]) map[day] = [];
        map[day].push(piece);
      }
    }
    return map;
  }, [allPieces]);

  // Filter by platform
  const filteredDayPieces = useMemo(() => {
    if (platformFilter === 'All') return dayPieces;
    const filtered: Record<number, any[]> = {};
    for (const [day, pieces] of Object.entries(dayPieces)) {
      const f = pieces.filter(p => p.platform?.toLowerCase().includes(platformFilter.toLowerCase()));
      if (f.length) filtered[parseInt(day)] = f;
    }
    return filtered;
  }, [dayPieces, platformFilter]);

  const selectedPieces = selectedDay ? (filteredDayPieces[selectedDay] || []) : [];
  const totalPieces = allPieces.length;
  const platforms = [...new Set(allPieces.map(p => p.platform))];

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-black text-white tracking-tight">Content Calendar</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {totalPieces > 0
            ? `${totalPieces} content pieces from ${contentBriefs?.length || 0} brief${(contentBriefs?.length || 0) > 1 ? 's' : ''}`
            : 'No content yet — create a brief first'}
        </p>
      </motion.div>

      {/* Empty state */}
      {totalPieces === 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-12 text-center">
          <CalendarIcon className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-zinc-400 mb-2">No content scheduled</h2>
          <p className="text-zinc-600 text-sm mb-6">Create a content brief to populate your calendar</p>
          <Link to="/brief"
            className="inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-colors">
            <FileText className="w-4 h-4" /> Create Brief
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      )}

      {totalPieces > 0 && (
        <>
          {/* Controls */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="flex items-center justify-between">

            {/* Month nav */}
            <div className="flex items-center gap-3">
              <button onClick={() => setMonthOffset(o => o - 1)}
                className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-white hover:border-white/[0.1] transition-all cursor-pointer">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-bold text-white min-w-[180px] text-center">{monthName}</h2>
              <button onClick={() => setMonthOffset(o => o + 1)}
                className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-white hover:border-white/[0.1] transition-all cursor-pointer">
                <ChevronRight className="w-4 h-4" />
              </button>
              {monthOffset !== 0 && (
                <button onClick={() => setMonthOffset(0)}
                  className="text-[10px] text-zinc-600 hover:text-white transition-colors cursor-pointer">Today</button>
              )}
            </div>

            {/* Platform filter */}
            <div className="flex items-center gap-1.5">
              {['All', ...platforms].map(p => (
                <button key={p} onClick={() => setPlatformFilter(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    platformFilter === p
                      ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                      : 'text-zinc-600 hover:text-zinc-300 border border-transparent'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Calendar Grid */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-5">

            {/* Day names */}
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-zinc-700 uppercase tracking-wider py-2">{d}</div>
              ))}
            </div>

            {/* Calendar cells */}
            <div className="grid grid-cols-7 gap-2">
              {/* Empty offset cells */}
              {Array.from({ length: firstDayOffset }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-xl bg-white/[0.01]" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const pieces = filteredDayPieces[day] || [];
                const isSelected = selectedDay === day;
                const isToday = monthOffset === 0 && day === now.getDate();
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className={`aspect-square rounded-xl border p-2 flex flex-col transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-white/[0.08] border-white/[0.2]'
                        : pieces.length > 0
                          ? 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                          : 'bg-white/[0.01] border-white/[0.03] hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className={`text-xs font-bold ${
                      isToday ? 'text-white bg-white/20 w-6 h-6 rounded-full flex items-center justify-center' :
                      pieces.length > 0 ? 'text-zinc-300' : 'text-zinc-700'
                    }`}>{day}</span>

                    {/* Platform dots */}
                    {pieces.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-auto">
                        {pieces.slice(0, 5).map((p: any, j: number) => (
                          <div key={j} className={`w-2 h-2 rounded-full ${getPlatformColor(p.platform).dot}`}
                            title={p.platform} />
                        ))}
                        {pieces.length > 5 && (
                          <span className="text-[8px] text-zinc-600">+{pieces.length - 5}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Selected Day Detail Panel */}
          <AnimatePresence>
            {selectedDay && selectedPieces.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6"
              >
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold text-white">
                    {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay} — {selectedPieces.length} piece{selectedPieces.length > 1 ? 's' : ''}
                  </h3>
                  <button onClick={() => setSelectedDay(null)}
                    className="p-1.5 text-zinc-600 hover:text-white transition-colors cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  {selectedPieces.map((piece: any, i: number) => {
                    const v = validateCaption(piece.caption || '', piece.platform || 'Instagram');
                    const pc = getPlatformColor(piece.platform);
                    return (
                      <motion.div key={piece.id || i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-5 space-y-3"
                      >
                        {/* Platform + Format + Campaign */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${pc.badge}`}>
                            {getPlatformIcon(piece.platform)} {piece.platform}
                          </span>
                          {piece.format && (
                            <span className="text-[10px] font-medium text-zinc-600 bg-white/[0.03] px-2 py-1 rounded-lg">{piece.format}</span>
                          )}
                          {piece.campaignTheme && (
                            <span className="text-[10px] font-medium text-violet-400/60 bg-violet-500/10 px-2 py-1 rounded-lg">{piece.campaignTheme}</span>
                          )}
                          <div className="ml-auto">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              v.status === 'good' ? 'bg-emerald-500/10 text-emerald-400' :
                              v.status === 'warning' ? 'bg-amber-500/10 text-amber-400' :
                              'bg-red-500/10 text-red-400'
                            }`}>{v.length}/{v.max}</span>
                          </div>
                        </div>

                        {/* Art Direction */}
                        {piece.creativeCopy && (
                          <div>
                            <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1">Art Direction</h4>
                            <p className="text-xs text-zinc-400 leading-relaxed">{piece.creativeCopy}</p>
                          </div>
                        )}

                        {/* Copy Section */}
                        <div className="space-y-2 bg-white/[0.01] rounded-lg p-3 border border-white/[0.03]">
                          <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Copy</h4>

                          {piece.keyMessage && (
                            <div>
                              <span className="text-[9px] text-amber-400/60 uppercase tracking-wider font-semibold">Key Message (on visual)</span>
                              <p className="text-sm text-amber-200/90 font-medium bg-amber-500/[0.06] rounded-lg px-2 py-1.5 border border-amber-500/10 mt-0.5">{piece.keyMessage}</p>
                            </div>
                          )}

                          <div>
                            <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">Caption</span>
                            <p className="text-sm text-zinc-200 bg-white/[0.02] p-2 rounded-lg border border-white/[0.04] whitespace-pre-wrap leading-relaxed mt-0.5">{piece.caption}</p>
                          </div>

                          {piece.cta && (
                            <div>
                              <span className="text-[9px] text-emerald-400/60 uppercase tracking-wider font-semibold">CTA</span>
                              <p className="text-sm text-emerald-300/90 font-medium bg-emerald-500/[0.06] rounded-lg px-2 py-1.5 border border-emerald-500/10 mt-0.5">{piece.cta}</p>
                            </div>
                          )}

                          {piece.hashtags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {piece.hashtags.map((h: string, j: number) => (
                                <span key={j} className="text-[10px] text-violet-400/70 bg-violet-500/10 px-1.5 py-0.5 rounded">#{h.replace(/^#/, '')}</span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Visual References */}
                        {piece.visualRefImages?.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-2">Visual References</h4>
                            <div className="grid grid-cols-4 gap-2">
                              {piece.visualRefImages.slice(0, 4).map((ref: any, j: number) => (
                                <a key={j} href={ref.sourceUrl || ref.pinterestUrl} target="_blank" rel="noopener noreferrer"
                                  className="group rounded-lg overflow-hidden border border-white/[0.05] hover:border-white/[0.15] transition-all">
                                  <div className="aspect-[4/3] bg-zinc-900 relative">
                                    <img src={ref.imageUrl} alt={ref.description || ''} className="w-full h-full object-cover" loading="lazy"
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <ExternalLink className="w-4 h-4 text-white" />
                                    </div>
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Target Audience */}
                        {piece.targetAudience && (
                          <p className="text-[10px] text-zinc-600">Audience: {piece.targetAudience}</p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected day but no pieces */}
          {selectedDay && selectedPieces.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-8 text-center">
              <p className="text-zinc-600 text-sm">No content scheduled for {displayDate.toLocaleString('en-US', { month: 'long' })} {selectedDay}</p>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
