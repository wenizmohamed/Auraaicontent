/**
 * AgentPlanView — visualizes a multi-step agent plan before execution.
 *
 * Adapted from 21st.dev's "Agent Plan" community component
 * (apps/desktop/src/components/agent/AgentPlanView.raw.tsx is the verbatim source).
 * Rebuilt props-driven for the radixcontent /api/agent/sessions flow + restyled
 * against the project's semantic tokens (bg-bg, text-fg-muted, color-accent…).
 *
 * Use: render the plan returned by the assistant, let the user Approve/Cancel
 * before any tool actually fires.
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { motionUI } from '../../lib/motion';

export type PlanStepStatus = 'pending' | 'in-progress' | 'completed' | 'need-help' | 'failed';

export interface PlanStepTool {
  name: string;
  args?: Record<string, unknown>;
}

export interface PlanSubstep {
  id: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  tools?: PlanStepTool[];
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  dependencies?: string[];
  etaSeconds?: number;
  substeps?: PlanSubstep[];
}

interface AgentPlanViewProps {
  plan: PlanStep[];
  onApprove?: () => void;
  onCancel?: () => void;
  loading?: boolean;
}

const STATUS_ICON_SIZE = 'h-4 w-4';

function StatusIcon({ status, size = STATUS_ICON_SIZE }: { status: PlanStepStatus; size?: string }) {
  if (status === 'completed') return <CheckCircle2 className={size} style={{ color: 'var(--color-success)' }} />;
  if (status === 'in-progress') return <CircleDotDashed className={size} style={{ color: 'var(--color-info)' }} />;
  if (status === 'need-help') return <CircleAlert className={size} style={{ color: 'var(--color-warning)' }} />;
  if (status === 'failed') return <CircleX className={size} style={{ color: 'var(--color-danger)' }} />;
  return <Circle className={size} style={{ color: 'var(--color-fg-subtle)' }} />;
}

function StatusBadge({ status }: { status: PlanStepStatus }) {
  const styles: Record<PlanStepStatus, { bg: string; fg: string }> = {
    'completed':   { bg: 'var(--color-success-subtle)', fg: 'var(--color-success)' },
    'in-progress': { bg: 'var(--color-info-subtle)',    fg: 'var(--color-info)' },
    'need-help':   { bg: 'var(--color-warning-subtle)', fg: 'var(--color-warning)' },
    'failed':      { bg: 'var(--color-danger-subtle)',  fg: 'var(--color-danger)' },
    'pending':     { bg: 'var(--color-surface)',        fg: 'var(--color-fg-subtle)' },
  };
  const { bg, fg } = styles[status];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: bg, color: fg }}
    >
      {status}
    </span>
  );
}

export function AgentPlanView({ plan, onApprove, onCancel, loading }: AgentPlanViewProps) {
  const [expanded, setExpanded] = useState<string[]>(() => plan.filter(s => s.status === 'in-progress').map(s => s.id));
  const summary = useMemo(() => ({
    total: plan.length,
    done: plan.filter(s => s.status === 'completed').length,
    failed: plan.filter(s => s.status === 'failed').length,
    eta: plan.reduce((acc, s) => acc + (s.etaSeconds ?? 0), 0),
  }), [plan]);

  const toggle = (id: string) =>
    setExpanded(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border"
      style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}
    >
      <header
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <div>
          <h2 className="font-display text-[16px] font-bold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            Plan
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
            {summary.done}/{summary.total} done{summary.failed > 0 ? ` · ${summary.failed} failed` : ''}
            {summary.eta > 0 ? ` · ~${Math.ceil(summary.eta / 60)}m total` : ''}
          </p>
        </div>
      </header>

      <LayoutGroup>
        <ul className="flex-1 overflow-auto px-3 py-2">
          {plan.map((step, i) => {
            const isOpen = expanded.includes(step.id);
            const isDone = step.status === 'completed';
            return (
              <motion.li
                key={step.id}
                className={i === 0 ? '' : 'mt-0.5'}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: motionUI }}
              >
                <div
                  className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
                  style={{ background: 'transparent' }}
                  onClick={() => step.substeps?.length && toggle(step.id)}
                >
                  <button
                    type="button"
                    className="flex-shrink-0 cursor-pointer"
                    onClick={e => e.stopPropagation()}
                    aria-label={`Step status: ${step.status}`}
                  >
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={step.status}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1, transition: motionUI }}
                        exit={{ opacity: 0, scale: 0.85 }}
                      >
                        <StatusIcon status={step.status} />
                      </motion.div>
                    </AnimatePresence>
                  </button>

                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {step.substeps?.length ? (
                      <ChevronRight
                        className="h-3.5 w-3.5 transition-transform"
                        style={{ color: 'var(--color-fg-subtle)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      />
                    ) : null}
                    <span
                      className="truncate text-[13px]"
                      style={{
                        color: isDone ? 'var(--color-fg-muted)' : 'var(--color-fg)',
                        textDecoration: isDone ? 'line-through' : 'none',
                      }}
                    >
                      {step.title}
                    </span>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    {step.etaSeconds ? (
                      <span className="text-[10px]" style={{ color: 'var(--color-fg-subtle)' }}>
                        ~{step.etaSeconds < 60 ? `${step.etaSeconds}s` : `${Math.ceil(step.etaSeconds / 60)}m`}
                      </span>
                    ) : null}
                    <StatusBadge status={step.status} />
                  </div>
                </div>

                <AnimatePresence>
                  {isOpen && step.substeps?.length ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1, transition: motionUI }}
                      exit={{ height: 0, opacity: 0, transition: motionUI }}
                      className="relative ml-2 overflow-hidden pl-7"
                    >
                      <div
                        className="absolute bottom-1 left-[14px] top-0 border-l border-dashed"
                        style={{ borderColor: 'var(--color-border-subtle)' }}
                      />
                      <ul className="space-y-1 py-1">
                        {step.substeps.map(sub => (
                          <li key={sub.id} className="flex items-start gap-2 py-1">
                            <StatusIcon status={sub.status} size="h-3.5 w-3.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px]" style={{ color: 'var(--color-fg)' }}>{sub.title}</p>
                              {sub.description ? (
                                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                                  {sub.description}
                                </p>
                              ) : null}
                              {sub.tools?.length ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {sub.tools.map((t, idx) => (
                                    <span
                                      key={idx}
                                      className="rounded px-1.5 py-0.5 text-[10px] font-mono"
                                      style={{ background: 'var(--color-surface)', color: 'var(--color-fg-muted)' }}
                                      title={t.args ? JSON.stringify(t.args) : undefined}
                                    >
                                      {t.name}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ul>
      </LayoutGroup>

      {(onApprove || onCancel) ? (
        <footer
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              Cancel
            </button>
          ) : null}
          {onApprove ? (
            <button
              type="button"
              onClick={onApprove}
              disabled={loading}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'var(--color-fg-on-accent)' }}
            >
              {loading ? 'Running…' : 'Approve & run'}
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

export default AgentPlanView;
