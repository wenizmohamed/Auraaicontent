import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  Instagram,
  Linkedin,
  Facebook,
  Hash,
  SlidersHorizontal,
  FileText,
  Megaphone,
  CalendarHeart,
  MonitorPlay,
  Loader2,
  CheckCircle2,
  X,
  Zap,
  Bot,
} from 'lucide-react';
import { useStore, type ContentBrief } from '../lib/store';
import {
  getClients,
  getClientById,
  DEFAULT_CAMPAIGNS,
  DEFAULT_OCCASIONS,
  type ClientKB,
} from '../lib/clients';
import {
  generateContentFromBrief,
  searchVisualReferences,
  type GeneratedPiece,
  type AIProvider,
} from '../lib/ai';
import { PLATFORM_LIMITS } from '../lib/platform-limits';

// ─── Platform config ───────────────────────────────────────────────
interface PlatformOption {
  id: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  maxCaption: number;
}

const PLATFORMS: PlatformOption[] = [
  { id: 'Instagram', label: 'Instagram', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/30', maxCaption: 2200 },
  { id: 'TikTok', label: 'TikTok', color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/30', maxCaption: 4000 },
  { id: 'LinkedIn', label: 'LinkedIn', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', maxCaption: 3000 },
  { id: 'X', label: 'X (Twitter)', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30', maxCaption: 280 },
  { id: 'Facebook', label: 'Facebook', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', maxCaption: 63206 },
];

// ─── Icon map for platforms ────────────────────────────────────────
function PlatformIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'Instagram': return <Instagram className={className} />;
    case 'LinkedIn': return <Linkedin className={className} />;
    case 'Facebook': return <Facebook className={className} />;
    case 'TikTok': return <MonitorPlay className={className} />;
    case 'X': return <Hash className={className} />;
    default: return <Hash className={className} />;
  }
}

// ─── Month options ─────────────────────────────────────────────────
function buildMonthOptions(): { label: string; value: string }[] {
  const months: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ label, value });
  }
  return months;
}

// ─── Campaign type ─────────────────────────────────────────────────
interface CampaignEntry {
  name: string;
  targetAudience: string;
  productFocus: string;
  objective: string;
  keyMessage: string;
}

// ─── Occasion type ─────────────────────────────────────────────────
interface OccasionEntry {
  name: string;
  date: string;
  enabled: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function BriefInput() {
  const navigate = useNavigate();
  const { addContentBrief, updateContentBrief } = useStore();
  const clients = useMemo(() => getClients(), []);
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  // ─── Form state ──────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || '');
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value || '');
  const [campaigns, setCampaigns] = useState<CampaignEntry[]>(
    DEFAULT_CAMPAIGNS.map(c => ({
      name: c.name,
      targetAudience: c.targetAudience,
      productFocus: c.productFocus,
      objective: c.objective,
      keyMessage: c.keyMessage,
    }))
  );
  const [occasions, setOccasions] = useState<OccasionEntry[]>(
    DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: true }))
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Instagram', 'TikTok', 'LinkedIn']);
  const [pieceCount, setPieceCount] = useState(18);
  const [toneNotes, setToneNotes] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProvider>('claude');
  const [isGenerating, setIsGenerating] = useState(false);
  const cancelledRef = useRef(false);
  const [generationProgress, setGenerationProgress] = useState('');
  const [customOccasionName, setCustomOccasionName] = useState('');
  const [customOccasionDate, setCustomOccasionDate] = useState('');

  // ─── Handlers ────────────────────────────────────────────────────

  const handleClientChange = useCallback((id: string) => {
    setSelectedClientId(id);
    if (id === 'al-fardan-exchange') {
      setCampaigns(
        DEFAULT_CAMPAIGNS.map(c => ({
          name: c.name,
          targetAudience: c.targetAudience,
          productFocus: c.productFocus,
          objective: c.objective,
          keyMessage: c.keyMessage,
        }))
      );
      setOccasions(DEFAULT_OCCASIONS.map(o => ({ ...o, enabled: true })));
    }
  }, []);

  const updateCampaign = useCallback((index: number, field: keyof CampaignEntry, value: string) => {
    setCampaigns(prev => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }, []);

  const removeCampaign = useCallback((index: number) => {
    setCampaigns(prev => prev.filter((_, i) => i !== index));
  }, []);

  const addCampaign = useCallback(() => {
    setCampaigns(prev => [
      ...prev,
      { name: '', targetAudience: '', productFocus: '', objective: '', keyMessage: '' },
    ]);
  }, []);

  const toggleOccasion = useCallback((index: number) => {
    setOccasions(prev => prev.map((o, i) => (i === index ? { ...o, enabled: !o.enabled } : o)));
  }, []);

  const addCustomOccasion = useCallback(() => {
    if (!customOccasionName.trim()) return;
    setOccasions(prev => [...prev, { name: customOccasionName.trim(), date: customOccasionDate.trim() || 'TBD', enabled: true }]);
    setCustomOccasionName('');
    setCustomOccasionDate('');
  }, [customOccasionName, customOccasionDate]);

  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  // ─── Cancel Generation ───────────────────────────────────────────

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setIsGenerating(false);
    setGenerationProgress('Cancelled.');
  }, []);

  // ─── Generate ────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    cancelledRef.current = false;
    const client = getClientById(selectedClientId);
    if (!client) return;
    if (selectedPlatforms.length === 0) return;
    if (campaigns.filter(c => c.name.trim()).length === 0) return;

    setIsGenerating(true);
    setGenerationProgress('Creating brief...');

    const briefId = crypto.randomUUID();
    const enabledOccasions = occasions.filter(o => o.enabled).map(({ name, date }) => ({ name, date }));
    const validCampaigns = campaigns.filter(c => c.name.trim()).map(c => ({
      ...c,
      duration: 'Monthly',
    }));

    const brief: ContentBrief = {
      id: briefId,
      clientId: selectedClientId,
      month: selectedMonth,
      campaigns: validCampaigns,
      occasions: enabledOccasions,
      platforms: selectedPlatforms,
      pieceCount,
      toneNotes,
      status: 'generating',
      pieces: [],
      createdAt: new Date().toISOString(),
    };

    addContentBrief(brief);

    try {
      setGenerationProgress(`Generating ${pieceCount} content pieces with ${aiProvider === 'claude' ? 'Claude Opus' : 'Gemini Flash'}...`);

      const pieces = await generateContentFromBrief({
        client,
        month: monthOptions.find(m => m.value === selectedMonth)?.label || selectedMonth,
        campaigns: validCampaigns,
        occasions: enabledOccasions,
        platforms: selectedPlatforms,
        pieceCount,
        toneNotes,
        briefId,
        provider: aiProvider,
      });

      if (cancelledRef.current) { updateContentBrief(briefId, { pieces, status: 'review' }); setIsGenerating(false); navigate(`/content-review?briefId=${briefId}`); return; }

      updateContentBrief(briefId, { pieces, status: 'review' });
      setGenerationProgress('Fetching visual references...');

      // Fetch visual references for each piece in parallel (batched)
      const batchSize = 4;
      const updatedPieces = [...pieces];

      for (let i = 0; i < pieces.length; i += batchSize) {
        if (cancelledRef.current) break;
        const batch = pieces.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(piece =>
            piece.visualReference
              ? searchVisualReferences(piece.visualReference, aiProvider)
              : Promise.resolve([])
          )
        );

        results.forEach((result, j) => {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            updatedPieces[i + j] = {
              ...updatedPieces[i + j],
              visualRefImages: result.value.map(ref => ({
                imageUrl: ref.imageUrl,
                sourceUrl: ref.sourceUrl,
                description: ref.description,
              })),
            };
          }
        });

        setGenerationProgress(`Visual references: ${Math.min(i + batchSize, pieces.length)}/${pieces.length}`);
      }

      updateContentBrief(briefId, { pieces: updatedPieces, status: 'review' });

      navigate(`/content-review?briefId=${briefId}`);
    } catch (err: any) {
      console.error('Generation failed:', err);
      updateContentBrief(briefId, { status: 'draft' });
      setGenerationProgress('');
      setIsGenerating(false);
      alert(`Generation failed: ${err.message}`);
    }
  }, [
    selectedClientId, selectedMonth, campaigns, occasions, selectedPlatforms,
    pieceCount, toneNotes, aiProvider, addContentBrief, updateContentBrief,
    navigate, monthOptions,
  ]);

  // ─── Render helpers ──────────────────────────────────────────────

  const selectedMonthLabel = monthOptions.find(m => m.value === selectedMonth)?.label || '';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // JSX
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Loading overlay */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-[#111] p-10 shadow-2xl"
            >
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-violet-500" />
                <div className="absolute inset-0 h-12 w-12 animate-ping rounded-full bg-violet-500/20" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-white">
                  Generating {pieceCount} content pieces...
                </p>
                <p className="mt-2 text-sm text-zinc-400">{generationProgress}</p>
              </div>
              <div className="h-1.5 w-64 overflow-hidden rounded-full bg-zinc-800">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  initial={{ width: '5%' }}
                  animate={{ width: '85%' }}
                  transition={{ duration: 30, ease: 'linear' }}
                />
              </div>
              <button
                onClick={handleCancel}
                className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-6 py-2.5 text-sm font-medium text-red-400 transition-all hover:bg-red-500/20 hover:text-red-300 cursor-pointer"
              >
                Stop Generation
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <h1 className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
              Create Content Brief
            </h1>
          </div>
          <p className="mt-2 pl-[52px] text-sm text-zinc-500">
            Define the brief and let AI generate all content pieces for the month.
          </p>
        </motion.div>

        <div className="space-y-8">
          {/* ─── Row: Client + Month ──────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="grid gap-6 sm:grid-cols-2"
          >
            {/* Client selector */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Client
              </label>
              <div className="relative">
                <select
                  value={selectedClientId}
                  onChange={e => handleClientChange(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-[#111] px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                >
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>

            {/* Month selector */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Month
              </label>
              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-[#111] px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                >
                  {monthOptions.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>
          </motion.div>

          {/* ─── Campaigns ────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Campaigns ({campaigns.length})
                </h2>
              </div>
              <button
                onClick={addCampaign}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-violet-500/30 hover:bg-violet-500/10 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Campaign
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {campaigns.map((campaign, idx) => (
                  <motion.div
                    key={idx}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative rounded-xl border border-violet-500/20 bg-[#111] p-4"
                  >
                    <div className="absolute left-0 top-0 h-full w-0.5 rounded-full bg-gradient-to-b from-violet-500 to-fuchsia-500" />

                    {campaigns.length > 1 && (
                      <button
                        onClick={() => removeCampaign(idx)}
                        className="absolute right-3 top-3 rounded-md p-1 text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <div className="space-y-3">
                      <input
                        value={campaign.name}
                        onChange={e => updateCampaign(idx, 'name', e.target.value)}
                        placeholder="Campaign name"
                        className="w-full border-b border-white/10 bg-transparent pb-2 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                            Audience
                          </label>
                          <input
                            value={campaign.targetAudience}
                            onChange={e => updateCampaign(idx, 'targetAudience', e.target.value)}
                            placeholder="Target audience"
                            className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                            Product Focus
                          </label>
                          <input
                            value={campaign.productFocus}
                            onChange={e => updateCampaign(idx, 'productFocus', e.target.value)}
                            placeholder="Product / Service"
                            className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                          Objective
                        </label>
                        <input
                          value={campaign.objective}
                          onChange={e => updateCampaign(idx, 'objective', e.target.value)}
                          placeholder="Campaign objective"
                          className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                          Key Message
                        </label>
                        <textarea
                          value={campaign.keyMessage}
                          onChange={e => updateCampaign(idx, 'keyMessage', e.target.value)}
                          placeholder="Core message for this campaign"
                          rows={2}
                          className="w-full resize-none rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-violet-500/30"
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.section>

          {/* ─── Special Occasions ────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="mb-4 flex items-center gap-2">
              <CalendarHeart className="h-4 w-4 text-fuchsia-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Special Occasions
              </h2>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="flex flex-wrap gap-2">
                {occasions.map((occ, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleOccasion(idx)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      occ.enabled
                        ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
                        : 'border-white/5 bg-white/5 text-zinc-600 hover:border-white/10 hover:text-zinc-400'
                    }`}
                  >
                    {occ.enabled ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <div className="h-3 w-3 rounded-full border border-zinc-600" />
                    )}
                    <span>{occ.name}</span>
                    <span className="text-[10px] opacity-60">{occ.date}</span>
                  </button>
                ))}
              </div>

              {/* Add custom occasion */}
              <div className="mt-4 flex items-end gap-2 border-t border-white/5 pt-4">
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Custom Occasion
                  </label>
                  <input
                    value={customOccasionName}
                    onChange={e => setCustomOccasionName(e.target.value)}
                    placeholder="Occasion name"
                    className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
                    onKeyDown={e => e.key === 'Enter' && addCustomOccasion()}
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Date
                  </label>
                  <input
                    value={customOccasionDate}
                    onChange={e => setCustomOccasionDate(e.target.value)}
                    placeholder="e.g. 15th Aug"
                    className="w-full rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
                    onKeyDown={e => e.key === 'Enter' && addCustomOccasion()}
                  />
                </div>
                <button
                  onClick={addCustomOccasion}
                  disabled={!customOccasionName.trim()}
                  className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-zinc-400 transition hover:border-fuchsia-500/30 hover:text-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.section>

          {/* ─── Platforms ─────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="mb-4 flex items-center gap-2">
              <MonitorPlay className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Platforms
              </h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.map(platform => {
                const isSelected = selectedPlatforms.includes(platform.id);
                const limits = PLATFORM_LIMITS[platform.id.toLowerCase().replace(/[\s()]/g, '')];
                const defaultFormat = limits?.formats[0];

                return (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? `${platform.border} ${platform.bg} ${platform.color}`
                        : 'border-white/5 bg-white/[0.02] text-zinc-600 hover:border-white/10 hover:text-zinc-400'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isSelected ? `${platform.bg}` : 'bg-white/5'
                      }`}
                    >
                      <PlatformIcon id={platform.id} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{platform.label}</p>
                      {isSelected && defaultFormat && (
                        <p className="mt-0.5 truncate text-[10px] opacity-60">
                          {defaultFormat.caption.max.toLocaleString()} chars max
                          {' / '}
                          {defaultFormat.caption.optimal} optimal
                        </p>
                      )}
                    </div>
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        isSelected
                          ? 'border-current bg-current/20'
                          : 'border-zinc-700'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.section>

          {/* ─── Piece Count + Tone + AI Provider ─────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="grid gap-6 lg:grid-cols-3"
          >
            {/* Piece count slider */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-violet-400" />
                  <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Content Pieces
                  </label>
                </div>
                <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-sm font-bold text-violet-400">
                  {pieceCount}
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={18}
                value={pieceCount}
                onChange={e => setPieceCount(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
                <span>5 pieces</span>
                <span>18 pieces</span>
              </div>
              <p className="mt-3 text-center text-xs text-zinc-500">
                {pieceCount} content pieces for {selectedMonthLabel}
              </p>
            </div>

            {/* Tone notes */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-fuchsia-400" />
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Tone Notes
                </label>
              </div>
              <textarea
                value={toneNotes}
                onChange={e => setToneNotes(e.target.value)}
                placeholder="Optional: Additional tone or direction notes for AI generation (e.g. 'more casual this month', 'focus on Ramadan messaging')..."
                rows={4}
                className="w-full resize-none rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-fuchsia-500/30"
              />
            </div>

            {/* AI Provider */}
            <div className="rounded-xl border border-white/10 bg-[#111] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Bot className="h-4 w-4 text-violet-400" />
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  AI Provider
                </label>
              </div>
              <div className="space-y-2">
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    aiProvider === 'claude'
                      ? 'border-violet-500/40 bg-violet-500/10'
                      : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value="claude"
                    checked={aiProvider === 'claude'}
                    onChange={() => setAiProvider('claude')}
                    className="sr-only"
                  />
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      aiProvider === 'claude'
                        ? 'border-violet-500 bg-violet-500'
                        : 'border-zinc-600'
                    }`}
                  >
                    {aiProvider === 'claude' && (
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Claude Opus</p>
                    <p className="text-[10px] text-zinc-500">Best quality, nuanced copy</p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    aiProvider === 'gemini'
                      ? 'border-blue-500/40 bg-blue-500/10'
                      : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value="gemini"
                    checked={aiProvider === 'gemini'}
                    onChange={() => setAiProvider('gemini')}
                    className="sr-only"
                  />
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      aiProvider === 'gemini'
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-zinc-600'
                    }`}
                  >
                    {aiProvider === 'gemini' && (
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Gemini Flash</p>
                    <p className="text-[10px] text-zinc-500">Fast, cost-effective</p>
                  </div>
                </label>
              </div>
            </div>
          </motion.section>

          {/* ─── Generate Button ───────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="pt-2"
          >
            <button
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                selectedPlatforms.length === 0 ||
                campaigns.filter(c => c.name.trim()).length === 0
              }
              className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 p-[1px] shadow-lg shadow-violet-500/20 transition hover:shadow-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <div className="relative flex items-center justify-center gap-3 rounded-[15px] bg-zinc-950/50 px-8 py-4 transition group-hover:bg-zinc-950/30">
                <Sparkles className="h-5 w-5 text-white" />
                <span className="text-lg font-bold text-white">
                  Generate Content
                </span>
                <Zap className="h-5 w-5 text-yellow-400" />
              </div>
              {/* Shimmer effect */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </button>

            {/* Validation hints */}
            {selectedPlatforms.length === 0 && (
              <p className="mt-2 text-center text-xs text-red-400/70">
                Select at least one platform
              </p>
            )}
            {campaigns.filter(c => c.name.trim()).length === 0 && (
              <p className="mt-2 text-center text-xs text-red-400/70">
                Add at least one campaign with a name
              </p>
            )}
          </motion.div>
        </div>
      </div>

      {/* Shimmer keyframe via inline style */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
