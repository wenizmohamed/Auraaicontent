import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { mockApi } from '../services/api';
import { readJson } from './safe-storage';

const STORE_VERSION = 2;

export type PipelineStatus = 'draft' | 'in-review' | 'needs-revision' | 'approved' | 'published';
export type Priority = 'low' | 'medium' | 'high';

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface PipelineItem {
  id: string;
  title: string;
  platform: string;
  description: string;
  priority: Priority;
  dueDate: string;
  assignee: string;
  status: PipelineStatus;
  comments: Comment[];
}

export interface GeneratedImage {
  id: string;
  url?: string;
  base64?: string;
  prompt: string;
  date?: string;
  timestamp?: string;
}

export interface Post {
  id: string;
  title?: string;
  date: string;
  platform: string;
  status: 'draft' | 'scheduled' | 'published';
  content?: string;
  targetAudience?: string;
  visualIdea?: string;
  copy?: string;
}

export interface SavedResearch {
  id: string;
  query: string;
  content: string;
  timestamp: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  time: string;
  type: string;
}

export interface AppStats {
  totalItems?: number;
  pendingReview?: number;
  approvedItems?: number;
  publishedItems?: number;
  activeCampaigns?: number;
  postsThisMonth?: number;
  approvalRate?: number;
  aiGenerations?: number;
}

export interface Brief {
  clientName: string;
  industry: string;
  objective: string;
  targetAudience: string;
  keyMessages: string;
  toneOfVoice: string;
  platforms: string[];
  duration: string;
  budget: string;
  requirements: string;
}

export interface CampaignContent {
  id: string;
  platform: string;
  visualReference: string;
  copy: string;
  caption: string;
  hashtags: string;
  recommendedFormat: string;
  status: 'draft' | 'approved' | 'rejected';
}

export interface ContentBrief {
  id: string;
  clientId: string;
  month: string;
  campaigns: { name: string; targetAudience: string; productFocus: string; duration: string; objective: string; keyMessage: string }[];
  occasions: { name: string; date: string }[];
  platforms: string[];
  pieceCount: number;
  toneNotes: string;
  status: 'draft' | 'generating' | 'review' | 'approved' | 'exported';
  pieces: any[]; // GeneratedPiece[]
  createdAt: string;
}

interface StoreState {
  pipelineItems: PipelineItem[];
  generatedImages: GeneratedImage[];
  imageHistory: GeneratedImage[];
  posts: Post[];
  activityLogs: ActivityLog[];
  savedResearch: SavedResearch[];
  isLoading: boolean;
  error: string | null;
  currentBrief: Brief | null;
  campaignContent: CampaignContent[];
  contentBriefs: ContentBrief[];
}

interface StoreContextType extends StoreState {
  addPipelineItem: (item: Omit<PipelineItem, 'id' | 'comments'>) => Promise<void>;
  updateItemStatus: (id: string, status: PipelineStatus) => Promise<void>;
  addComment: (itemId: string, text: string, author: string) => Promise<void>;
  addGeneratedImage: (image: Omit<GeneratedImage, 'id' | 'timestamp'>) => Promise<void>;
  addImageToHistory: (image: Omit<GeneratedImage, 'id' | 'timestamp'>) => Promise<void>;
  setPosts: (posts: Post[]) => Promise<void>;
  getStats: () => AppStats;
  logActivity: (action: string, type: string) => Promise<void>;
  setBrief: (brief: Brief) => void;
  setCampaignContent: (content: CampaignContent[]) => void;
  updateCampaignContentStatus: (id: string, status: 'draft' | 'approved' | 'rejected') => void;
  addContentBrief: (brief: ContentBrief) => void;
  updateContentBrief: (id: string, updates: Partial<ContentBrief>) => void;
  getContentBriefs: () => ContentBrief[];
}

const defaultState: StoreState = {
  savedResearch: [],
  pipelineItems: [],
  generatedImages: [],
  imageHistory: [],
  posts: readJson('radix_calendar_posts', []),
  activityLogs: [],
  isLoading: true,
  error: null,
  currentBrief: null,
  campaignContent: [],
  contentBriefs: readJson('radix_content_briefs', []),
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>(defaultState);

  const fetchAllData = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      const data = await mockApi.fetchAll();

      // Merge: keep localStorage posts if mockApi returns empty
      const savedPosts = readJson('radix_calendar_posts', []);
      setState(prev => ({
        ...prev,
        pipelineItems: data.pipelineItems || [],
        generatedImages: data.generatedImages || [],
        imageHistory: data.generatedImages || [],
        posts: (data.posts && data.posts.length > 0) ? data.posts : (prev.posts.length > 0 ? prev.posts : savedPosts),
        activityLogs: data.activityLogs || [],
        savedResearch: data.savedResearch || [],
        isLoading: false
      }));
    } catch (error: any) {
      setState(prev => ({ ...prev, isLoading: false, error: error.message }));
    }
  };

  useEffect(() => {
    fetchAllData();
    // Re-sync contentBriefs from localStorage on window focus (prevents stale data)
    const onFocus = () => {
      try {
        const fresh = readJson('radix_content_briefs', []);
        setState(prev => ({ ...prev, contentBriefs: fresh }));
      } catch {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const addPipelineItem = async (item: Omit<PipelineItem, 'id' | 'comments'>) => {
    const newItem = { ...item, id: crypto.randomUUID(), comments: [] };
    
    // Optimistic update
    setState(prev => ({
      ...prev,
      pipelineItems: [...prev.pipelineItems, newItem]
    }));

    try {
      await mockApi.addPipelineItem(newItem);
      await logActivity(`Created new pipeline item: ${item.title}`, 'studio');
    } catch (error) {
      console.error(error);
      fetchAllData(); // Revert on error
    }
  };

  const updateItemStatus = async (id: string, status: PipelineStatus) => {
    setState(prev => ({
      ...prev,
      pipelineItems: prev.pipelineItems.map(item => 
        item.id === id ? { ...item, status } : item
      )
    }));

    try {
      await mockApi.updatePipelineItemStatus(id, status);
      await logActivity(`Updated status to ${status}`, 'studio');
    } catch (error) {
      console.error(error);
      fetchAllData();
    }
  };

  const addComment = async (itemId: string, text: string, author: string) => {
    const newComment = {
      id: crypto.randomUUID(),
      author,
      text,
      timestamp: new Date().toISOString()
    };

    const item = state.pipelineItems.find(i => i.id === itemId);
    if (!item) return;

    const updatedComments = [...item.comments, newComment];

    setState(prev => ({
      ...prev,
      pipelineItems: prev.pipelineItems.map(i => 
        i.id === itemId ? { ...i, comments: updatedComments } : i
      )
    }));

    try {
      await mockApi.addComment(itemId, newComment);
    } catch (error) {
      console.error(error);
      fetchAllData();
    }
  };

  const addGeneratedImage = async (image: Omit<GeneratedImage, 'id' | 'timestamp'>) => {
    const newImg = { ...image, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    
    setState(prev => ({
      ...prev,
      generatedImages: [newImg, ...prev.generatedImages].slice(0, 50),
      imageHistory: [newImg, ...prev.imageHistory].slice(0, 50)
    }));

    try {
      await mockApi.addGeneratedImage(newImg);
      await logActivity('Generated new image', 'image');
    } catch (error) {
      console.error(error);
      fetchAllData();
    }
  };

  const addImageToHistory = async (image: Omit<GeneratedImage, 'id' | 'timestamp'>) => {
    await addGeneratedImage(image);
  };

  const setPosts = async (posts: Post[]) => {
    setState(prev => ({ ...prev, posts }));
    localStorage.setItem('radix_calendar_posts', JSON.stringify(posts));
    try {
      await mockApi.setPosts(posts);
    } catch (error) {
      console.error(error);
    }
  };

  const logActivity = async (action: string, type: string) => {
    const newLog: ActivityLog = { id: crypto.randomUUID(), action, time: new Date().toISOString(), type };
    setState(prev => ({
      ...prev,
      activityLogs: [newLog, ...prev.activityLogs].slice(0, 20)
    }));
    try {
      await mockApi.logActivity(newLog);
    } catch (error) {
      console.error(error);
    }
  };

  const getStats = (): AppStats => {
    const items = state.pipelineItems;
    const approved = items.filter(i => i.status === 'approved' || i.status === 'published').length;
    const needsRevision = items.filter(i => i.status === 'needs-revision').length;
    const totalReviewed = approved + needsRevision;
    const approvalRate = totalReviewed > 0 ? Math.round((approved / totalReviewed) * 100) : 100;

    return {
      totalItems: items.length,
      pendingReview: items.filter(i => i.status === 'in-review').length,
      approvedItems: approved,
      publishedItems: items.filter(i => i.status === 'published').length,
      activeCampaigns: items.filter(i => i.status !== 'published').length,
      postsThisMonth: items.length,
      approvalRate,
      aiGenerations: 2340 + state.generatedImages.length
    };
  };

  const setBrief = (brief: Brief) => {
    setState(prev => ({ ...prev, currentBrief: brief }));
  };

  const setCampaignContent = (content: CampaignContent[]) => {
    setState(prev => ({ ...prev, campaignContent: content }));
  };

  const updateCampaignContentStatus = (id: string, status: 'draft' | 'approved' | 'rejected') => {
    setState(prev => ({
      ...prev,
      campaignContent: prev.campaignContent.map(item =>
        item.id === id ? { ...item, status } : item
      )
    }));
  };

  const addContentBrief = (brief: ContentBrief) => {
    setState(prev => {
      const updated = [brief, ...prev.contentBriefs];
      localStorage.setItem('radix_content_briefs', JSON.stringify(updated));
      return { ...prev, contentBriefs: updated };
    });
  };

  const updateContentBrief = (id: string, updates: Partial<ContentBrief>) => {
    setState(prev => {
      const updated = prev.contentBriefs.map(b => b.id === id ? { ...b, ...updates } : b);
      localStorage.setItem('radix_content_briefs', JSON.stringify(updated));
      return { ...prev, contentBriefs: updated };
    });
  };

  const getContentBriefs = () => state.contentBriefs;

  return (
    <StoreContext.Provider value={{
      ...state,
      addPipelineItem,
      updateItemStatus,
      addComment,
      addGeneratedImage,
      addImageToHistory,
      setPosts,
      getStats,
      logActivity,
      setBrief,
      setCampaignContent,
      updateCampaignContentStatus,
      addContentBrief,
      updateContentBrief,
      getContentBriefs,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
