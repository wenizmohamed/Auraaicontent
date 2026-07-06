// "What's new on Radix AI" — product changelog surfaced on every user's
// Dashboard. Entries are maintained here in git (newest first) and shipped
// with each deploy; no DB table needed. Keep entries user-facing: what THEY
// can now do, never internal refactor talk. Add an entry with every big ship.

import type { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';

export interface ChangelogEntry {
  /** ISO date of the ship. */
  date: string;
  tag: 'new' | 'improved' | 'fixed';
  title: string;
  body: string;
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Social Listening — read a competitor, find your opening',
    body: 'New Strategy tool: drop in any competitor (brand, handle or website) and Radix reads their content strategy — themes, tone, posting cadence, what they do well. Pick a client and it turns their playbook into concrete gaps that client can exploit. Grounds the read on the competitor\'s real site when you paste a URL.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Share client galleries with a public link',
    body: 'From the Gallery, hit "Share with client" to get a clean, branded review page — no login needed. Your client browses the work, downloads finals, and leaves per-asset approve / request-changes feedback that lands straight back in Radix. Links are private-by-token and scoped to your org.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Search everything with ⌘K',
    body: 'The command bar now searches across every client, calendar and content piece in your org at once — start typing to jump straight to anything. It also lists quick actions (Generate calendar, New brief, switch theme…) so the whole app is one keystroke away.',
  },
  {
    date: '2026-07-06',
    tag: 'fixed',
    title: 'Studio now shows every client — and never overwrites work',
    body: 'The production pipeline (Studio) pulls live posts across ALL your clients into one board, each card labelled with its client, and status changes save straight back to the calendar. Reorganised navigation into Plan · Create · Library so features are easier to find, with full keyboard, screen-reader and right-to-left support throughout.',
  },
  {
    date: '2026-07-04',
    tag: 'new',
    title: 'Style Packs — 14 premium looks for images & video',
    body: 'Pick a curated art direction (Luxury Noir, Liquid Glass, Ramadan Gold, Desert Modern…) in Creative Tools and every generation comes back designer-grade: exact palettes, materials and lighting are applied automatically. Works on Text→Image and both video modes.',
  },
  {
    date: '2026-07-03',
    tag: 'improved',
    title: 'Pro prompts now automatic on every generation',
    body: 'Your prompt is rewritten into a production-grade brief (composition, lighting, cinematography, audio) before it hits the AI — in every image and video generation, by default. Arabic briefs are translated for video engines automatically. Toggle off with "Auto-enhance" if you want your exact words.',
  },
  {
    date: '2026-07-03',
    tag: 'fixed',
    title: 'Video progress & reliability fixes',
    body: 'The "stuck at 90%" progress bar is gone — progress now tracks each engine\'s real speed, and running jobs survive server restarts. Draft-tier (Grok) clips now play correctly in the app and are stored permanently.',
  },
  {
    date: '2026-07-02',
    tag: 'new',
    title: 'Two new video engines + 4K images',
    body: 'Omni Flash (fast, character-consistent) and Wan 2.7 (Alibaba) join Veo and Grok in the video Engine picker. Images now go up to 4K with more aspect ratios (4:5, 3:4, 21:9), a 1080p video toggle, product reference images (max 3) so your exact product stays in the shot, and an "Avoid" field.',
  },
  {
    date: '2026-06-30',
    tag: 'improved',
    title: 'Copywriting learns from your feedback',
    body: 'Thumbs-up a variant and Radix remembers your preference per client — future copy leans toward what you approved. Variants are also more diverse, with a new length control.',
  },
];

export async function changelogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/changelog?limit=5 — newest first.
  app.get('/changelog', async (request) => {
    const limit = Math.min(20, Math.max(1, parseInt((request.query as any)?.limit ?? '5', 10) || 5));
    return { entries: CHANGELOG.slice(0, limit) };
  });
}
