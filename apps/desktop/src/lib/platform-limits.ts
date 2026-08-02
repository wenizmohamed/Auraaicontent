// Social Media Character Limits — 2026 (Verified April 2026)
// Sources: bundle.social, typecount.com, lettercounter.org, goldentoolhub.com

export interface PlatformLimits {
  name: string;
  icon: string;
  color: string;
  formats: {
    name: string;
    caption: { max: number; optimal: number; truncateAt: number; note: string };
    title?: { max: number; note: string };
    description?: { max: number; note: string };
    hashtags: { max: number; optimal: number; note: string };
  }[];
}

export const PLATFORM_LIMITS: Record<string, PlatformLimits> = {
  instagram: {
    name: 'Instagram',
    icon: '📸',
    color: 'from-pink-500 to-purple-500',
    formats: [
      {
        name: 'Feed Post',
        caption: { max: 2200, optimal: 180, truncateAt: 125, note: 'First 125 chars visible before "more" button' },
        hashtags: { max: 5, optimal: 3, note: 'Max 5 per post (changed Dec 2025, was 30)' },
      },
      {
        name: 'Reel',
        caption: { max: 2200, optimal: 100, truncateAt: 55, note: 'Only ~55 chars visible on Reels. Shorter = better engagement' },
        hashtags: { max: 5, optimal: 3, note: 'Max 5 per Reel' },
      },
      {
        name: 'Story',
        caption: { max: 2200, optimal: 150, truncateAt: 150, note: 'Text overlay. Keep under 150 for readability. Max 100 stories/24hrs' },
        hashtags: { max: 5, optimal: 2, note: 'Max 5 per Story' },
      },
      {
        name: 'Carousel',
        caption: { max: 2200, optimal: 200, truncateAt: 125, note: 'Carousels perform well with medium captions. First 125 visible' },
        hashtags: { max: 5, optimal: 4, note: 'Max 5 per post' },
      },
    ],
  },

  tiktok: {
    name: 'TikTok',
    icon: '🎵',
    color: 'from-slate-800 to-slate-600',
    formats: [
      {
        name: 'Video',
        caption: { max: 4000, optimal: 100, truncateAt: 100, note: '4000 chars for SEO, but 50-150 is optimal for engagement' },
        hashtags: { max: 5, optimal: 3, note: 'Max 5 hashtags (new 2026 limit)' },
      },
      {
        name: 'Photo Carousel',
        caption: { max: 4000, optimal: 80, truncateAt: 100, note: 'Same limit as video' },
        hashtags: { max: 5, optimal: 3, note: 'Max 5 hashtags' },
      },
    ],
  },

  linkedin: {
    name: 'LinkedIn',
    icon: '💼',
    color: 'from-blue-600 to-blue-800',
    formats: [
      {
        name: 'Post',
        caption: { max: 3000, optimal: 1900, truncateAt: 210, note: 'Only ~210 chars before "see more". 1800-2100 chars = highest engagement' },
        hashtags: { max: 30, optimal: 5, note: '3-5 hashtags recommended' },
      },
      {
        name: 'Article',
        title: { max: 100, note: 'Article headline. Keep compelling' },
        caption: { max: 125000, optimal: 2000, truncateAt: 300, note: '~125K chars (25K words). About section shows ~300 before truncate' },
        description: { max: 2000, note: 'Article description/subtitle' },
        hashtags: { max: 30, optimal: 5, note: '3-5 recommended' },
      },
      {
        name: 'Document/Carousel',
        caption: { max: 3000, optimal: 1500, truncateAt: 210, note: 'Same as post. Document carousels perform well with detailed captions' },
        hashtags: { max: 30, optimal: 5, note: '3-5 recommended' },
      },
    ],
  },

  x: {
    name: 'X (Twitter)',
    icon: '🐦',
    color: 'from-sky-500 to-sky-700',
    formats: [
      {
        name: 'Post (Free)',
        caption: { max: 280, optimal: 85, truncateAt: 280, note: '71-100 chars = 17% higher engagement. URLs = 23 chars flat' },
        hashtags: { max: 280, optimal: 2, note: 'Count toward char limit. 1-2 hashtags max' },
      },
      {
        name: 'Post (Premium)',
        caption: { max: 25000, optimal: 280, truncateAt: 280, note: 'Premium gets 25K chars, but shorter still wins engagement' },
        hashtags: { max: 25000, optimal: 2, note: '1-2 hashtags still recommended' },
      },
      {
        name: 'Thread',
        caption: { max: 280, optimal: 200, truncateAt: 280, note: '280 per tweet in thread. Keep each concise' },
        hashtags: { max: 280, optimal: 1, note: 'Hashtag in first tweet only' },
      },
    ],
  },

  facebook: {
    name: 'Facebook',
    icon: '📘',
    color: 'from-blue-500 to-indigo-600',
    formats: [
      {
        name: 'Post',
        caption: { max: 63206, optimal: 60, truncateAt: 125, note: '~477 chars on desktop, ~125 on mobile before truncation. Under 80 chars = 66% more engagement' },
        hashtags: { max: 30, optimal: 3, note: '1-3 hashtags recommended' },
      },
      {
        name: 'Photo/Video',
        caption: { max: 2200, optimal: 80, truncateAt: 125, note: 'Photo/video captions capped at 2200' },
        hashtags: { max: 30, optimal: 3, note: '1-3 hashtags' },
      },
      {
        name: 'Reel',
        caption: { max: 2200, optimal: 80, truncateAt: 125, note: 'Same as photo/video' },
        hashtags: { max: 30, optimal: 3, note: '1-3 hashtags' },
      },
      {
        name: 'Ad (Headline)',
        caption: { max: 40, optimal: 25, truncateAt: 25, note: 'Ad headline. 25-40 chars. Keep punchy' },
        description: { max: 125, note: 'Ad primary text. 90-125 chars recommended' },
        hashtags: { max: 0, optimal: 0, note: 'No hashtags in ads' },
      },
    ],
  },

  threads: {
    name: 'Threads',
    icon: '🧵',
    color: 'from-slate-600 to-slate-800',
    formats: [
      {
        name: 'Post',
        caption: { max: 500, optimal: 200, truncateAt: 500, note: '500 chars per post. Bio shared with Instagram (150 chars)' },
        hashtags: { max: 500, optimal: 3, note: 'Count toward char limit' },
      },
    ],
  },

  snapchat: {
    name: 'Snapchat',
    icon: '👻',
    color: 'from-yellow-400 to-yellow-500',
    formats: [
      {
        name: 'Snap',
        caption: { max: 80, optimal: 50, truncateAt: 80, note: '80 chars for text overlay on snaps' },
        hashtags: { max: 0, optimal: 0, note: 'No hashtag system' },
      },
      {
        name: 'Story',
        caption: { max: 80, optimal: 50, truncateAt: 80, note: 'Same as Snap' },
        hashtags: { max: 0, optimal: 0, note: 'No hashtag system' },
      },
    ],
  },
};

// Helper to get limit for a specific platform + format
export function getLimit(platform: string, formatName: string) {
  const p = PLATFORM_LIMITS[platform.toLowerCase().replace(/[^a-z]/g, '')];
  if (!p) return null;
  return p.formats.find(f => f.name.toLowerCase() === formatName.toLowerCase()) || p.formats[0];
}

// Helper to validate caption length
export function validateCaption(text: string, platform: string, formatName?: string): {
  valid: boolean;
  length: number;
  max: number;
  optimal: number;
  overBy: number;
  status: 'good' | 'warning' | 'over';
} {
  const key = platform.toLowerCase().replace(/[\s()]/g, '');
  const p = PLATFORM_LIMITS[key];
  if (!p) return { valid: true, length: text.length, max: 99999, optimal: 200, overBy: 0, status: 'good' };
  const fmt = formatName
    ? p.formats.find(f => f.name.toLowerCase() === formatName.toLowerCase()) || p.formats[0]
    : p.formats[0];
  const len = text.length;
  const max = fmt.caption.max;
  const optimal = fmt.caption.optimal;
  return {
    valid: len <= max,
    length: len,
    max,
    optimal,
    overBy: Math.max(0, len - max),
    status: len > max ? 'over' : len > optimal * 1.5 ? 'warning' : 'good',
  };
}
