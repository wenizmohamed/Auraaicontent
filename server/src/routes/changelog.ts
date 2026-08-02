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
    date: '2026-08-02',
    tag: 'fixed',
    title: 'Client review links now open properly',
    body: 'Share a month with a client and their link now opens the review page as intended. Previously it sent them to a sign-in screen, so they could not see the work. Your client browses the month, approves posts, requests changes and leaves comments per post, with no account needed. Feedback lands straight back in Radix.',
  },
  {
    date: '2026-08-02',
    tag: 'improved',
    title: 'Prices are now visible to owners, admins and accounting only',
    body: 'Per-second engine rates, cost estimates and the monthly spend meter are restricted to owners, admins and anyone on the accounting list. Everyone else works exactly as before, they just do not see cost figures. If you need a teammate added to the accounting list, ask your owner.',
  },
  {
    date: '2026-08-02',
    tag: 'fixed',
    title: 'Usage reports show the dates you actually pick',
    body: 'The finance report treated the end date as the moment the day began, so the last day of your range was left out and picking today showed nothing at all. Ranges are now inclusive, and there are one-click shortcuts for This month, Last month, Last 30 days, Last 90 days, This year and All time. Empty results now tell you which window was searched instead of just showing zero.',
  },
  {
    date: '2026-08-02',
    tag: 'fixed',
    title: 'Stay signed in',
    body: 'Accounts created through a sign-up link were being logged out about an hour later with no warning. Those sessions now refresh quietly in the background like everyone else\'s.',
  },
  {
    date: '2026-08-02',
    tag: 'improved',
    title: 'Generated content reads less like AI',
    body: 'Captions, copy and the app itself no longer use the long dash that gives AI writing away, and the generators are steered off the usual AI vocabulary. Applies to new generations from today.',
  },
  {
    date: '2026-08-02',
    tag: 'new',
    title: 'Improve with AI: pick from 3 creative directions',
    body: 'Hit Improve with AI in Creative Tools and you now get three genuinely different takes on your idea instead of one rewrite. Each is a full production-grade prompt with its own angle. Read them in full, apply the one you like, or dismiss them and keep your own wording. On image-to-video the directions only vary camera and motion, so the image you uploaded stays exactly as it is.',
  },
  {
    date: '2026-07-25',
    tag: 'improved',
    title: 'Pick your exact video engine, image-to-video included',
    body: 'The video Engine picker now lists Veo, Grok, Omni Flash and Wan 2.7 individually, each with its own price per second, and image-to-video is no longer limited to one engine family. Attach product reference images and a Reference to Video option appears that keeps your exact product consistent through the whole clip. Removing an uploaded start frame is now one obvious click.',
  },
  {
    date: '2026-07-21',
    tag: 'fixed',
    title: 'No more cut-off captions + the newest AI models',
    body: 'Long generations (big calendars, detailed briefs) no longer come back truncated mid-sentence. Output limits were raised across engines. Radix also moved to the latest models across providers (Grok 4.5, Gemini 3.5 Flash, the newest image models), and when an engine wrongly blocks safe content, Radix now automatically retries on another engine instead of failing.',
  },
  {
    date: '2026-07-15',
    tag: 'improved',
    title: 'Faster, more reliable content generation',
    body: 'Generating a month of content is now more dependable. It holds up when your whole team is generating at the same time, keeps running even while the app updates in the background, and picks up right where it left off instead of leaving you on a stuck progress bar. Large calendars that used to occasionally stall now finish.',
  },
  {
    date: '2026-07-15',
    tag: 'fixed',
    title: 'Monthly briefs now shape that exact month',
    body: 'When you set a brief for a specific month, that brief is now reliably used to generate that month\'s calendar, so planning August the way you want it no longer falls back to an earlier month\'s brief.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Upscale images up to 16K',
    body: 'New Upscale tab in Creative Tools: drop in any image (or upscale one you just generated) and enlarge it up to 16K. "Fast" is instant; "AI detail" re-renders it with real added sharpness and texture using our own models, then scales. Great for print, billboards and hero banners.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'A clearer Workspace',
    body: 'The all-in-one Workspace now has a labelled navigator (Plan · Make · Track · Manage), a description on every surface, and one-click actions on empty states, so it\'s obvious where everything lives.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'A separate brief for every month',
    body: 'Each month now keeps its own brief. Plan August without it changing September, and older briefs are never overwritten. New months start on a clean slate, with a one-click option to copy last month\'s brief as a starting point.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Check compliance on any post',
    body: 'On the Review page, hit Compliance on a post and Radix audits the caption against that client\'s brief rules, flagging risky claims, missing disclaimers and sensitive wording by severity, each with a suggested fix. Built for financial, fraud-awareness and other regulated content.',
  },
  {
    date: '2026-07-14',
    tag: 'new',
    title: 'Score your content, and know how to improve it',
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
    body: 'Choose how much AI reshapes your prompt: Off sends your exact words, Raw only translates for the engine, Pro rewrites it production-grade, Max pushes art direction furthest, so the enhancer never hijacks a prompt you meant literally.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'Richer visual references + more image models',
    body: 'Reference search now pulls from Behance, Dribbble and your own approved assets, finds motion references for Reels/Videos, and the Creative Tools engine picker adds more image models. Research sources are now verified. Dead or irrelevant links are dropped.',
  },
  {
    date: '2026-07-14',
    tag: 'improved',
    title: 'Excel uploads + more markets on Topic Desk',
    body: 'Upload Excel/CSV files to a client\'s Knowledge base to feed brand context, and Topic Desk now covers Oman, Saudi Arabia, UAE, Qatar, Kuwait, Bahrain, Egypt, Lebanon and Jordan, not just one market.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Competitor Intel. Read a competitor, find your opening',
    body: 'New Strategy tool: drop in any competitor (brand, handle or website) and Radix reads their content strategy. Themes, tone, posting cadence, what they do well. Pick a client and it turns their playbook into concrete gaps that client can exploit. Grounds the read on the competitor\'s real site when you paste a URL.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Share client galleries with a public link',
    body: 'From the Gallery, hit "Share with client" to get a clean, branded review page. No login needed. Your client browses the work, downloads finals, and leaves per-asset approve / request-changes feedback that lands straight back in Radix. Links are private-by-token and scoped to your org.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Search everything with ⌘K',
    body: 'The command bar now searches across every client, calendar and content piece in your org at once. Start typing to jump straight to anything. It also lists quick actions (Generate calendar, New brief, switch theme…) so the whole app is one keystroke away.',
  },
  {
    date: '2026-07-06',
    tag: 'fixed',
    title: 'Studio now shows every client, and never overwrites work',
    body: 'The production pipeline (Studio) pulls live posts across ALL your clients into one board, each card labelled with its client, and status changes save straight back to the calendar. Reorganised navigation into Plan · Create · Library so features are easier to find, with full keyboard, screen-reader and right-to-left support throughout.',
  },
  {
    date: '2026-07-04',
    tag: 'new',
    title: 'Style Packs. 14 premium looks for images & video',
    body: 'Pick a curated art direction (Luxury Noir, Liquid Glass, Ramadan Gold, Desert Modern…) in Creative Tools and every generation comes back designer-grade: exact palettes, materials and lighting are applied automatically. Works on Text→Image and both video modes.',
  },
  {
    date: '2026-07-03',
    tag: 'improved',
    title: 'Pro prompts now automatic on every generation',
    body: 'Your prompt is rewritten into a production-grade brief (composition, lighting, cinematography, audio) before it hits the AI. In every image and video generation, by default. Arabic briefs are translated for video engines automatically. Toggle off with "Auto-enhance" if you want your exact words.',
  },
  {
    date: '2026-07-03',
    tag: 'fixed',
    title: 'Video progress & reliability fixes',
    body: 'The "stuck at 90%" progress bar is gone. Progress now tracks each engine\'s real speed, and running jobs survive server restarts. Draft-tier (Grok) clips now play correctly in the app and are stored permanently.',
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
    body: 'Thumbs-up a variant and Radix remembers your preference per client. Future copy leans toward what you approved. Variants are also more diverse, with a new length control.',
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
