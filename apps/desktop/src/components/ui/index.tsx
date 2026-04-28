import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type LucideIcon, X, TrendingUp, TrendingDown } from 'lucide-react';

// ── Card ──────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = '', hoverable, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl bg-[#0c0c0c] border border-white/[0.06] p-6 ${
        hoverable ? 'transition-all duration-200 hover:border-white/[0.12] cursor-pointer' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 shadow-[0_0_24px_rgba(245,158,11,0.08)] flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-amber-500" />
      </div>
      <h3 className="text-white text-lg font-semibold mb-1">{title}</h3>
      <p className="text-zinc-400 text-sm max-w-xs mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-medium transition-all duration-200 hover:bg-amber-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────
interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
}

export function LoadingSkeleton({ lines = 3, className = '' }: LoadingSkeletonProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded-lg bg-white/[0.06] animate-pulse"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────
const STATUS_MAP = {
  draft:             { dot: 'bg-zinc-500',    text: 'text-zinc-400',    bg: 'bg-zinc-500/10',    label: 'Draft' },
  approved:          { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Approved' },
  rejected:          { dot: 'bg-red-400',     text: 'text-red-400',     bg: 'bg-red-400/10',     label: 'Rejected' },
  generated:         { dot: 'bg-amber-400',   text: 'text-amber-400',   bg: 'bg-amber-400/10',   label: 'Generated' },
  changes_requested: { dot: 'bg-amber-400',   text: 'text-amber-400',   bg: 'bg-amber-400/10',   label: 'Changes' },
} as const;

interface StatusBadgeProps {
  status: keyof typeof STATUS_MAP;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const s = STATUS_MAP[status];
  const px = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${s.bg} ${s.text} ${px} font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────
interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ icon: Icon, label, value, trend, className = '' }: StatCardProps) {
  return (
    <div className={`rounded-2xl bg-[#0c0c0c] border border-white/[0.06] p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl bg-[#111] border border-white/[0.06] flex items-center justify-center">
          <Icon className="w-4 h-4 text-zinc-400" />
        </div>
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend.value}
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-zinc-600 text-sm mt-1">{label}</p>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────
const TOAST_STYLES = {
  ok:      'bg-emerald-400/10 border-emerald-400/20 text-emerald-400',
  error:   'bg-red-400/10 border-red-400/20 text-red-400',
  info:    'bg-blue-400/10 border-blue-400/20 text-blue-400',
  warning: 'bg-amber-400/10 border-amber-400/20 text-amber-400',
} as const;

interface ToastProps {
  message: string;
  type: keyof typeof TOAST_STYLES;
  onDismiss?: () => void;
}

export function Toast({ message, type, onDismiss }: ToastProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.2 }}
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm font-medium ${TOAST_STYLES[type]}`}
      >
        <span className="flex-1">{message}</span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-lg hover:bg-white/[0.06] transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
