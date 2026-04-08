// Shared TypeScript types — mirrors Prisma schema
// These are the API contract types used by desktop, preview-web, and server

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor?: string;
  industry?: string;
  website?: string;
  instagramHandle?: string;
  status: 'active' | 'inactive';
}

export interface ClientBrief {
  id: string;
  clientId: string;
  objective: string;
  audience: string;
  tone: string;
  brandDo: string;
  brandDont: string;
  products: any[];
  pillars: any[];
  campaignMoments: any[];
  mandatoryInclusions?: string;
  complianceNotes?: string;
  channels: any[];
  cadence?: string;
  approvers: any[];
}

export interface CalendarMonth {
  id: string;
  clientId: string;
  month: string;
  status: 'draft' | 'internal-review' | 'client-review' | 'approved' | 'archived';
  strategy?: any;
}

export interface CalendarPost {
  id: string;
  calendarMonthId: string;
  date: string;
  title: string;
  pillar: string;
  platform: string;
  format: string;
  hook?: string;
  keyMessage?: string;
  caption: string;
  cta?: string;
  hashtags?: string[];
  visualDirection?: string;
  referenceQuery?: string;
  rationale?: string;
  status: 'draft' | 'internal-review' | 'client-review' | 'changes-requested' | 'approved' | 'archived';
  version: number;
}

export interface PostComment {
  id: string;
  postId: string;
  authorName: string;
  source: 'internal' | 'client';
  comment: string;
  status?: 'note' | 'requested-change' | 'approved';
}

export interface ReviewLink {
  id: string;
  clientId: string;
  calendarMonthId: string;
  token: string;
  expiresAt?: string;
  isActive: boolean;
}

export interface Asset {
  id: string;
  clientId: string;
  name: string;
  fileUrl: string;
  thumbUrl?: string;
  mimeType: string;
  analysis?: any;
  tags?: string[];
}

export interface ExportJob {
  id: string;
  clientId: string;
  calendarMonthId: string;
  type: 'pptx' | 'pdf';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  fileUrl?: string;
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
}
