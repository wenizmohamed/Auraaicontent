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
    date: '2026-07-14',
    tag: 'new',
    title: 'A separate brief for every month',
    body: 'Each month now keeps its own brief — plan August without it changing September, and older briefs are never overwritten. New months start on a clean slate, with a one-click option to copy last month\'s brief as a starting point.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Check compliance on any post',
    body: 'On the Review page, hit Compliance on a post and Radix audits the caption against that client\'s brief rules — flagging risky claims, missing disclaimers and sensitive wording by severity, each with a suggested fix. Built for financial, fraud-awareness and other regulated content.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Score your content — and know how to improve it',
    body: 'Score any post to rate it on clarity, relevance, tone-of-voice, platform fit and engagement potential, plus the single highest-impact edit to make. Recommendations, not just generation.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Quick notes & teach-the-AI thumbs',
    body: 'Leave a quick note on any post for your team, and thumbs-up / thumbs-down any generated image or video so Radix learns each client\'s taste and leans that way next time.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'Prompt Boost dial in Creative Tools',
    body: 'Choose how much AI reshapes your prompt: Off sends your exact words, Raw only translates for the engine, Pro rewrites it production-grade, Max pushes art direction furthest — so the enhancer never hijacks a prompt you meant literally.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'Richer visual references + more image models',
    body: 'Reference search now pulls from Behance, Dribbble and your own approved assets, finds motion references for Reels/Videos, and the Creative Tools engine picker adds more image models. Research sources are now verified — dead or irrelevant links are dropped.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'Excel uploads + more markets on Topic Desk',
    body: 'Upload Excel/CSV files to a client\'s Knowledge base to feed brand context, and Topic Desk now covers Oman, Saudi Arabia, UAE, Qatar, Kuwait, Bahrain, Egypt, Lebanon and Jordan — not just one market.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Competitor Intel — read a competitor, find your opening',
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
