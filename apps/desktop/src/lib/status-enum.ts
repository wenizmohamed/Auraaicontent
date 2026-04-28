// Canonical content-status vocabulary, shared across Calendar, Review,
// Dashboard, and any other page that renders or filters by post status.
//
// Purpose: before this, ContentCalendar used ['draft', 'approved',
// 'changes_requested'] while ContentReview used ['generated', 'approved',
// 'edited', 'rejected']. The same underlying post would appear with different
// state labels depending on which page you opened. That broke "can the user
// track state?" expectations.
//
// This file defines ONE union and a normalization function that absorbs legacy
// tokens at the boundary (incoming API payloads, local-store shapes) so the UI
// only ever works with canonical values.

export type ContentStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'published'
  | 'rejected';

export const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  published: 'Published',
  rejected: 'Rejected',
};

export const STATUS_COLOR: Record<ContentStatus, { dot: string; badge: string }> = {
  draft: { dot: 'bg-zinc-400', badge: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
  in_review: { dot: 'bg-amber-400', badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  approved: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  changes_requested: { dot: 'bg-blue-400', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  published: { dot: 'bg-white', badge: 'bg-white/10 text-white border-white/20' },
  rejected: { dot: 'bg-red-400', badge: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

// Legacy status tokens -> canonical. Historical server responses and the
// local zustand store may still emit these; map them at the boundary so
// nothing in the UI layer has to care.
export const STATUS_LEGACY_MAP: Record<string, ContentStatus> = {
  generated: 'draft',
  'in-review': 'in_review',
  edited: 'changes_requested',
};

export function normalizeStatus(raw: string | undefined | null): ContentStatus {
  if (!raw) return 'draft';
  if (raw in STATUS_LABEL) return raw as ContentStatus;
  return STATUS_LEGACY_MAP[raw] ?? 'draft';
}
