// ComputerPanel — right-side tabbed panel showing live agent work.
// Tabs: Tools | Artifacts | Thoughts. Subscribes to narrow store slices.

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Wrench, Image as ImageIcon, FileText } from 'lucide-react';
import {
  useAgentStore,
  selectToolCalls,
  selectArtifacts,
  selectThoughts,
} from '../../state/agent-store';
import ToolCard from './ToolCard';
import ArtifactRenderer from './ArtifactRenderer';

interface ComputerPanelProps {
  sessionUid: string;
}

type TabKey = 'tools' | 'artifacts' | 'thoughts';

const TAB_ORDER: Array<{ key: TabKey; label: string; icon: typeof Wrench }> = [
  { key: 'tools', label: 'Tools', icon: Wrench },
  { key: 'artifacts', label: 'Artifacts', icon: ImageIcon },
  { key: 'thoughts', label: 'Thoughts', icon: FileText },
];

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export default function ComputerPanel({ sessionUid }: ComputerPanelProps) {
  const [active, setActive] = useState<TabKey>('tools');
  const prefersReducedMotion = useReducedMotion();

  const toolCalls = useAgentStore(selectToolCalls(sessionUid));
  const artifacts = useAgentStore(selectArtifacts(sessionUid));
  const thoughts = useAgentStore(selectThoughts(sessionUid));

  const orderedTools = useMemo(
    () => [...toolCalls].sort((a, b) => (a.startedAt > b.startedAt ? 1 : -1)),
    [toolCalls],
  );

  const counts: Record<TabKey, number> = {
    tools: toolCalls.length,
    artifacts: artifacts.length,
    thoughts: thoughts.length,
  };

  const fadeUp = prefersReducedMotion
    ? { initial: false, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: 'easeOut' as const },
      };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex items-stretch border-b border-white/10">
        {TAB_ORDER.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={[
                'flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-white/[0.06] text-white border-b-2 border-blue-500'
                  : 'text-zinc-400 hover:text-white border-b-2 border-transparent',
              ].join(' ')}
            >
              <Icon size={14} />
              <span>{label}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-300">
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {active === 'tools' && (
          orderedTools.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No tool calls yet
            </div>
          ) : (
            orderedTools.map((call) => (
              <motion.div key={call.id} {...fadeUp}>
                <ToolCard call={call} />
              </motion.div>
            ))
          )
        )}

        {active === 'artifacts' && (
          artifacts.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No artifacts yet
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {artifacts.map((a) => (
                <motion.div key={a.id} {...fadeUp}>
                  <ArtifactRenderer artifact={a} />
                </motion.div>
              ))}
            </div>
          )
        )}

        {active === 'thoughts' && (
          thoughts.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No thoughts yet
            </div>
          ) : (
            thoughts.map((t) => (
              <motion.div key={t.id} {...fadeUp} className="space-y-1">
                <div className="text-sm italic text-zinc-400 border-l-2 border-white/20 pl-3">
                  {t.text}
                </div>
                <div className="pl-3 text-[10px] uppercase tracking-wide text-zinc-600">
                  {formatTime(t.at)}
                </div>
              </motion.div>
            ))
          )
        )}
      </div>
    </div>
  );
}
