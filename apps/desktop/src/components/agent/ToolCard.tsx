// ToolCard — renders a single agent tool call with collapsible args/result.
// Dark palette, framer-motion expand/collapse, react-markdown for string results.
import { useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight, Wrench, Check, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ToolCall } from '../../state/agent-store';

interface ToolCardProps {
  call: ToolCall;
}

function formatDuration(startedAt: string, finishedAt?: string): string | null {
  if (!finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ call }: { call: ToolCall }) {
  const running = call.finishedAt == null;
  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-blue-400">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        running
      </span>
    );
  }
  if (call.ok === false || call.error) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <X className="h-3.5 w-3.5" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <Check className="h-3.5 w-3.5" />
      ok
    </span>
  );
}

function renderResult(result: unknown, error?: string) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-mono text-red-300 whitespace-pre-wrap break-words">
        {error}
      </div>
    );
  }
  if (result == null) {
    return <div className="text-xs text-zinc-500 italic">(no output)</div>;
  }
  if (typeof result === 'string') {
    return (
      <div className="prose prose-invert prose-sm max-w-none text-zinc-200">
        <ReactMarkdown>{result}</ReactMarkdown>
      </div>
    );
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(result, null, 2);
  } catch {
    pretty = String(result);
  }
  return (
    <pre className="text-xs font-mono bg-black/30 p-3 rounded-lg overflow-x-auto text-zinc-300 whitespace-pre-wrap break-words">
      {pretty}
    </pre>
  );
}

export default function ToolCard({ call }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const duration = useMemo(
    () => formatDuration(call.startedAt, call.finishedAt),
    [call.startedAt, call.finishedAt],
  );

  const argsPretty = useMemo(() => {
    try {
      return JSON.stringify(call.args ?? {}, null, 2);
    } catch {
      return String(call.args);
    }
  }, [call.args]);

  const hasResult = call.finishedAt != null;

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Wrench className="h-4 w-4 text-blue-400 shrink-0" />
        <span className="font-mono text-sm text-blue-400 truncate">{call.tool}</span>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <StatusBadge call={call} />
          {duration && <span className="text-xs text-zinc-500">{duration}</span>}
          {open ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-3 border-t border-white/10">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                  Input
                </div>
                <pre className="text-xs font-mono bg-black/30 p-3 rounded-lg overflow-x-auto text-zinc-300 whitespace-pre-wrap break-words">
                  {argsPretty}
                </pre>
              </div>
              {hasResult && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Output
                  </div>
                  {renderResult(call.result, call.error)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
