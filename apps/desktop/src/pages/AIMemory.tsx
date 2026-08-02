/**
 * AI Memory — the unified "Client Brain" surface. Merges the old Knowledge
 * (documents / RAG) and AI Learnings (adapted lessons) pages into ONE
 * client-scoped view under a single nav item + route. Both halves are exactly
 * what grounds this client's text/analysis generations: Knowledge is
 * client-strict RAG; Learnings are this client's lessons UNION org-wide ones.
 *
 * Each tab renders the EXISTING page component in embedded mode (its own
 * top-level header hidden) so there's no double header inside the tabs and no
 * functionality is lost.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, FileText, Lightbulb } from 'lucide-react';
import { Tabs } from '../components/ui/Tabs';
import { useClients } from '../lib/client-context';
import { motionUI } from '../lib/motion';
import Knowledge from './Knowledge';
import AILearnings from './AILearnings';

export default function AIMemory() {
  const { currentClient } = useClients();
  const [tab, setTab] = useState<'knowledge' | 'learnings'>('knowledge');

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-6">
      {/* Unified header — the single source of title/eyebrow for both tabs. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionUI}
      >
        <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--color-fg-subtle)' }}>
          AI Memory
        </p>
        <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-3" style={{ color: 'var(--color-fg)' }}>
          <Brain className="w-6 h-6" style={{ color: 'var(--color-accent)' }} />
          Client Brain
          {currentClient && (
            <span className="text-sm font-medium" style={{ color: 'var(--color-fg-subtle)' }}>· {currentClient.name}</span>
          )}
        </h1>
        <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-fg-muted)' }}>
          Everything the AI knows and has learned about this client. Its documents (Knowledge) and
          the lessons it adapts from your feedback (Learnings). Both ground every generation.
        </p>
      </motion.div>

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as 'knowledge' | 'learnings')}>
        <Tabs.List>
          <Tabs.Trigger value="knowledge">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Knowledge
            </span>
          </Tabs.Trigger>
          <Tabs.Trigger value="learnings">
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> Learnings
            </span>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="knowledge" className="mt-6">
          <Knowledge embedded />
        </Tabs.Content>
        <Tabs.Content value="learnings" className="mt-6">
          <AILearnings embedded />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
