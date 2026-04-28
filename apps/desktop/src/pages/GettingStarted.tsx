import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Sparkles } from 'lucide-react';
import { STEPS } from '../lib/walkthrough-config';

export default function GettingStarted() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-16 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-2"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.15em] bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Compass className="w-3 h-3" />
          Tour
        </div>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-white tracking-tight">
          Getting started with Radix
        </h1>
        <p className="text-sm text-zinc-400 max-w-2xl">
          A quick tour of the dashboard, brief workflow, calendar, knowledge base, and creative tools — with visual references for each.
        </p>
      </motion.div>

      {/* 7 step cards */}
      {STEPS.map((step, idx) => (
        <motion.section
          key={step.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 + idx * 0.04 }}
          className="glass-card overflow-hidden"
          aria-labelledby={`step-${step.id}-title`}
        >
          <div className="grid grid-cols-1 md:grid-cols-5">
            {/* Infographic */}
            <div className="md:col-span-3 relative aspect-[16/9] md:aspect-auto bg-gradient-to-br from-zinc-900 to-zinc-950">
              <img
                src={step.infographicSrc}
                alt={step.infographicAlt}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 backdrop-blur border border-amber-500/30 text-amber-300 text-[10px] font-semibold tracking-wider uppercase">
                <Sparkles className="w-3 h-3" />
                Step {idx + 1} of {STEPS.length}
              </div>
            </div>

            {/* Body */}
            <div className="md:col-span-2 p-6 sm:p-7 flex flex-col justify-center gap-3">
              <h2
                id={`step-${step.id}-title`}
                className="text-lg sm:text-xl font-display font-semibold text-white tracking-tight"
              >
                {step.title}
              </h2>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {step.body}
              </p>
              {step.cta && (
                <Link
                  to={step.cta.href}
                  className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors mt-1 self-start"
                >
                  {step.cta.label}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        </motion.section>
      ))}

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.05 + STEPS.length * 0.04 }}
        className="pt-2 text-center"
      >
        <Link
          to="/"
          className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 transition-colors"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </Link>
      </motion.div>
    </div>
  );
}
