import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowLeft, Building2, FileText, Sparkles, CheckCircle2 } from 'lucide-react';
import { useClients } from '../lib/client-context';
import { briefsApi, calendarApi, jobsApi } from '../lib/backend-api';
import { useNavigate } from 'react-router-dom';

const STEPS = [
  { title: 'Add Your First Client', icon: Building2, description: 'Who are we creating content for?' },
  { title: 'Set Up the Brief', icon: FileText, description: 'Tell the AI about the brand and goals.' },
  { title: 'Generate Content', icon: Sparkles, description: 'AI creates platform-ready content in seconds.' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { createClient, setSelectedClientId } = useClients();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 0: Client
  const [clientName, setClientName] = useState('');
  const [clientIndustry, setClientIndustry] = useState('');
  const [clientId, setClientId] = useState('');

  // Step 1: Brief
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('Professional');
  const [platforms, setPlatforms] = useState<string[]>(['Instagram']);

  const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook'];

  const handleCreateClient = async () => {
    if (!clientName.trim()) { setError('Client name is required'); return; }
    setSubmitting(true); setError('');
    try {
      const client = await createClient({ name: clientName.trim(), industry: clientIndustry.trim() || undefined });
      setClientId(client.id);
      setSelectedClientId(client.id);
      setStep(1);
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  const handleSaveBrief = async () => {
    if (!objective.trim()) { setError('Objective is required'); return; }
    setSubmitting(true); setError('');
    try {
      await briefsApi.save(clientId, {
        objective: objective.trim(),
        audience: audience.trim() || 'General audience',
        tone,
        brandDo: 'Follow brand guidelines',
        brandDont: 'No misleading claims',
        products: [],
        pillars: [objective.trim().split(' ').slice(0, 3).join(' ')],
        channels: platforms,
        campaignMoments: [],
        approvers: [],
      });
      setStep(2);
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  const handleGenerate = async () => {
    setSubmitting(true); setError('');
    try {
      const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const { jobId } = await calendarApi.generate(clientId, month, 18);
      // Poll
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const job = await jobsApi.get(jobId);
        if (job.status === 'completed') {
          navigate(`/calendar?client=${clientId}&month=${encodeURIComponent(month)}`);
          return;
        }
        if (job.status === 'failed') throw new Error(job.error || 'Generation failed');
      }
      throw new Error('Generation timed out');
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i < step ? 'bg-emerald-500 text-black' : i === step ? 'bg-amber-500 text-black' : 'bg-white/[0.06] text-zinc-600'
              }`}>
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`w-12 h-0.5 ${i < step ? 'bg-emerald-500' : 'bg-white/[0.06]'}`} />}
            </div>
          ))}
        </div>

        {/* Step header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4 shadow-[0_0_40px_-10px_rgba(245,158,11,0.35)]">
            {(() => { const Icon = STEPS[step].icon; return <Icon className="w-6 h-6 text-amber-400" />; })()}
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">{STEPS[step].title}</h2>
          <p className="text-sm text-zinc-500 mt-1">{STEPS[step].description}</p>
        </div>

        {/* Step content */}
        <div className="bg-[#111] border border-white/10 rounded-2xl p-6 space-y-4">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Client Name *</label>
                  <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Al Fardan Exchange"
                    className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors" />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Industry</label>
                  <input value={clientIndustry} onChange={e => setClientIndustry(e.target.value)} placeholder="Financial services"
                    className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors" />
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Campaign Objective *</label>
                  <input value={objective} onChange={e => setObjective(e.target.value)} placeholder="Promote GPTW certification"
                    className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors" />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Target Audience</label>
                  <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="UAE professionals, remittance senders"
                    className="w-full px-4 py-2.5 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors" />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-zinc-500 font-medium mb-1.5">Platforms</label>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORM_OPTIONS.map(p => (
                      <button key={p} type="button"
                        onClick={() => setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          platforms.includes(p) ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-white/[0.03] border-white/[0.06] text-zinc-500 hover:text-white'
                        }`}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="text-center py-4">
                {submitting ? (
                  <div className="space-y-4">
                    <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-zinc-400">Generating content for {clientName}...</p>
                    <p className="text-xs text-zinc-600">This takes 10-30 seconds</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-zinc-400">Ready to generate <strong className="text-white">18 content pieces</strong> for <strong className="text-amber-400">{clientName}</strong> across {platforms.join(', ')}.</p>
                    <p className="text-xs text-zinc-600">AI will create captions, visuals, hashtags, and scheduling suggestions.</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            {step > 0 && !submitting && (
              <button onClick={() => { setStep(s => s - 1); setError(''); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] border border-white/10 text-zinc-400 rounded-xl text-sm font-medium hover:text-white transition-colors cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            <button
              onClick={step === 0 ? handleCreateClient : step === 1 ? handleSaveBrief : handleGenerate}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-medium rounded-xl transition-colors cursor-pointer">
              {submitting ? (
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  {step === 2 ? 'Generate Content' : 'Continue'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Skip */}
        <div className="text-center mt-4">
          <button onClick={() => navigate('/')} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer">
            Skip onboarding →
          </button>
        </div>
      </motion.div>
    </div>
  );
}
