import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useClients } from '../lib/client-context';
import {
  STEPS,
  REPLAY_EVENT,
  shouldAutoFire,
  markCompleted,
  type WalkthroughStep,
} from '../lib/walkthrough-config';

interface WalkthroughTourProps {
  forceOpen?: boolean;
}

export default function WalkthroughTour({ forceOpen }: WalkthroughTourProps = {}) {
  const { authenticated } = useClients();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const userCreatedAt = (() => {
    try {
      const raw = localStorage.getItem('radix_user_created_at');
      return raw || null;
    } catch {
      return null;
    }
  })();

  // Auto-fire on first authenticated load if user is fresh + flag absent.
  useEffect(() => {
    if (!authenticated) return;
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (shouldAutoFire(userCreatedAt)) {
      // Tiny delay so the dashboard has a chance to paint behind the modal
      const t = setTimeout(() => { setOpen(true); setStep(0); }, 800);
      return () => clearTimeout(t);
    }
  }, [authenticated, forceOpen, userCreatedAt]);

  // Listen for the replay event from Profile / wherever
  useEffect(() => {
    const onReplay = () => { setOpen(true); setStep(0); };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  // ESC to skip + body scroll-lock while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const handleSkip = useCallback(() => {
    markCompleted();
    setOpen(false);
  }, []);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleSkip();
    }
  }, [step, handleSkip]);

  const handlePrev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  if (!open) return null;
  const current: WalkthroughStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="walkthrough-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="z-modal-backdrop fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
          onClick={handleSkip}
          role="presentation"
        >
          <motion.div
            key={`step-${step}`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="z-modal glass-card relative w-full max-w-2xl overflow-hidden rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="walkthrough-title"
            aria-describedby="walkthrough-body"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close (skip) button */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleSkip}
              aria-label="Skip walkthrough"
              className="cursor-pointer absolute top-3 right-3 z-10 p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Infographic */}
            <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-zinc-900 to-zinc-950">
              <AnimatePresence mode="wait">
                <motion.img
                  key={current.infographicSrc}
                  src={current.infographicSrc}
                  alt={current.infographicAlt}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback: hide broken image, show step number
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </AnimatePresence>
              {/* Step badge — overlay top-left so it's visible regardless of image */}
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 backdrop-blur border border-amber-500/30 text-amber-300 text-[10px] font-semibold tracking-wider uppercase">
                <Sparkles className="w-3 h-3" />
                Step {step + 1} of {STEPS.length}
              </div>
            </div>

            {/* Body */}
            <div className="p-6 sm:p-7 space-y-3">
              <h2
                id="walkthrough-title"
                className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight"
              >
                {current.title}
              </h2>
              <p
                id="walkthrough-body"
                className="text-sm sm:text-base text-zinc-300 leading-relaxed"
              >
                {current.body}
              </p>

              {current.cta && (
                <Link
                  to={current.cta.href}
                  onClick={handleSkip}
                  className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors"
                >
                  {current.cta.label}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>

            {/* Footer controls */}
            <div className="px-6 sm:px-7 pb-6 pt-2 flex items-center justify-between gap-3 border-t border-white/[0.06]">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Walkthrough progress">
                {STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === step}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    onClick={() => setStep(i)}
                    className={`cursor-pointer transition-all duration-200 rounded-full ${
                      i === step
                        ? 'w-6 h-1.5 bg-amber-500'
                        : i < step
                          ? 'w-1.5 h-1.5 bg-amber-500/50 hover:bg-amber-500/80'
                          : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={step === 0}
                  aria-label="Previous step"
                  className="cursor-pointer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04]"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 transition-colors"
                >
                  {isLast ? 'Done' : 'Next'}
                  {!isLast && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
