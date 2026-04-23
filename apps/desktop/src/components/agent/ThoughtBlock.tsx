import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain } from 'lucide-react';

interface ThoughtBlockProps {
  text: string;
  at: string; // ISO timestamp
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ThoughtBlock({ text, at }: ThoughtBlockProps) {
  const reduceMotion = useReducedMotion();
  // Memoize to avoid re-computing on every parent re-render; the value is coarse-grained anyway.
  const relative = useMemo(() => formatRelative(at), [at]);

  const fadeUp = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const } };

  return (
    <motion.div
      {...fadeUp}
      className="flex items-start gap-2 border-l-2 border-white/20 pl-3 py-1"
    >
      <Brain className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
      <p className="flex-1 italic text-sm text-zinc-400 leading-relaxed">{text}</p>
      {relative && (
        <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums mt-0.5">{relative}</span>
      )}
    </motion.div>
  );
}
