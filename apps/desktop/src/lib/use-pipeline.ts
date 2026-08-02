// use-pipeline.ts — real-data backing for the Studio page.
//
// Studio's Pipeline/Approvals/Analytics tabs were previously driven by the mock
// `useStore()` pipeline, which persisted only to localStorage['radix_mock_db'] —
// so anything created or moved there was silently lost across devices/logout and
// never reached the real content calendar (frontend-review CRIT-1, 2026-07-05).
//
// This hook exposes the SAME shape the Studio JSX already consumes
// ({ pipelineItems, updateItemStatus, getStats, loading, ... }) but backed by the
// real CalendarPost data for the currently-selected client, via calendarApi.
// Status moves persist through calendarApi.updatePost — the actual fix.
//
// Deliberately NOT faked: free-form item creation (CalendarPost needs a
// month/date/pillar/format — content originates from the brief→calendar flow, so
// the "New content" CTA routes to the Calendar) and per-item comments (the only
// PostComment route is the token-gated client review-link flow; an authed in-app
// comment route is a follow-up). Those return no-ops rather than writing to
// nowhere.

import { useCallback, useEffect, useState } from 'react';
import { calendarApi } from './backend-api';
import { useClients } from './client-context';
import { normalizeStatus, type ContentStatus } from './status-enum';

// The column vocabulary the Studio JSX renders (kept stable to avoid a JSX churn).
export type PipelineStatus = 'draft' | 'in-review' | 'needs-revision' | 'approved' | 'published';

export interface PipelineComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface PipelineItem {
  id: string;
  title: string;
  description: string;
  platform: string;
  status: PipelineStatus;
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  dueDate: string;
  comments: PipelineComment[];
  clientId: string;
  clientName: string;
}

// canonical ContentStatus (backend) -> Studio column id
const TO_COLUMN: Record<ContentStatus, PipelineStatus> = {
  draft: 'draft',
  in_review: 'in-review',
  changes_requested: 'needs-revision',
  approved: 'approved',
  published: 'published',
  rejected: 'needs-revision',
};

// Studio column id -> canonical ContentStatus (what we PATCH back to the API)
const TO_CANONICAL: Record<PipelineStatus, ContentStatus> = {
  draft: 'draft',
  'in-review': 'in_review',
  'needs-revision': 'changes_requested',
  approved: 'approved',
  published: 'published',
};

function postToItem(p: any, clientId: string, clientName: string): PipelineItem {
  const meta = (p && typeof p.metadata === 'object' && p.metadata) || {};
  return {
    id: p.id,
    title: p.title || p.caption?.slice(0, 60) || 'Untitled post',
    description: p.caption || p.keyMessage || '',
    platform: p.platform || 'Other',
    status: TO_COLUMN[normalizeStatus(p.status)],
    priority: (meta.priority as PipelineItem['priority']) || 'medium',
    assignee: meta.assignee || '',
    dueDate: p.date || p.createdAt || '',
    comments: [],
    clientId,
    clientName,
  };
}

export interface PipelineStats {
  approvalRate: number;
  postsThisMonth: number;
}

export function usePipeline() {
  // Agency-wide by default: the board aggregates in-flight content across EVERY
  // client in the org (matches the "dashboard is always cross-client" rule),
  // not just the one in the switcher. Each card carries its client's name.
  const { clients } = useClients();
  const [pipelineItems, setPipelineItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load each client's latest calendar month, in parallel, and flatten.
  const load = useCallback(async () => {
    if (!clients || clients.length === 0) { setPipelineItems([]); return; }
    setLoading(true); setError(null);
    try {
      const perClient = await Promise.all(clients.map(async (c) => {
        try {
          const months = await calendarApi.listMonths(c.id);
          if (!months || months.length === 0) return [];
          const latest = [...months].sort((a, b) => (a.month < b.month ? 1 : -1))[0].month;
          const data = await calendarApi.getMonth(c.id, latest);
          const posts = Array.isArray(data?.posts) ? data.posts : [];
          return posts.map((p: any) => postToItem(p, c.id, c.name || 'Client'));
        } catch {
          return []; // one client failing must not blank the whole board
        }
      }));
      setPipelineItems(perClient.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline');
      setPipelineItems([]);
    } finally {
      setLoading(false);
    }
  }, [clients]);

  useEffect(() => { load(); }, [load]);

  // The real fix: persist the status move to the backend, optimistic + revert.
  const updateItemStatus = useCallback(async (id: string, status: PipelineStatus) => {
    const prev = pipelineItems;
    setPipelineItems(items => items.map(i => (i.id === id ? { ...i, status } : i)));
    try {
      await calendarApi.updatePost(id, { status: TO_CANONICAL[status] });
    } catch {
      setPipelineItems(prev); // revert on failure. No silent loss
    }
  }, [pipelineItems]);

  const getStats = useCallback((): PipelineStats => {
    const total = pipelineItems.length;
    const approved = pipelineItems.filter(i => i.status === 'approved' || i.status === 'published').length;
    return {
      approvalRate: total ? Math.round((approved / total) * 100) : 0,
      postsThisMonth: total,
    };
  }, [pipelineItems]);

  return { pipelineItems, loading, error, hasClient: (clients?.length ?? 0) > 0, reload: load, updateItemStatus, getStats };
}
