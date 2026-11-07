// "What's new on AURAAI" — product changelog surfaced on every user's
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
    date: '2026-11-07',
    tag: 'fixed',
    title: 'Generation is back on every surface',
    body: 'Text, images, video and analysis all run again, on new accounts for the AI providers that serve them. Nothing about your workspace changed: same clients, same calendar, same briefs, same history. If a generation had failed for you since early November, it works now.',
  },
  {
    date: '2026-11-07',
    tag: 'improved',
    title: 'A second AI company behind every generation',
    body: 'Every generation now has a second engine ready behind the first one, so a busy or paused provider no longer means an error. Google joins Alibaba as a provider, with the same text, image, image editing and image analysis quality, and it prices each call exactly like the others.',
  },
  {
    date: '2026-11-07',
    tag: 'fixed',
    title: 'Your search and your knowledge base work again',
    body: 'Finding anything in your knowledge base, your saved briefs and your notes had gone quiet, because the search step needed a service that was out of credit. Search now runs on a matching system that needs no paid service, so your documents, your custom notes and your saved memory come back ranked and relevant.',
  },
  {
    date: '2026-11-07',
    tag: 'fixed',
    title: 'The prices you see are the prices you pay',
    body: 'The engine picker now shows the exact rate the billing meter charges, down to the last decimal, at every resolution. Before, the picker and the meter disagreed on several engines, which meant a price on screen was not the price on the invoice. Every rate now comes from the provider price sheet itself, and a test blocks the two from drifting apart again.',
  },
  {
    date: '2026-11-07',
    tag: 'fixed',
    title: 'Only engines that actually work are offered',
    body: 'The picker used to list engines that had been withdrawn by their provider, so choosing one meant waiting for a request that could never succeed. Every remaining engine was tested with a real generation before it was kept, and the ones that failed are gone. The video list is now Wan 3.0, Wan 2.7 and HappyHorse, and the image list is Qwen Image and Gemini.',
  },
  {
    date: '2026-11-07',
    tag: 'improved',
    title: 'Higher resolution images, and the Ultra tier in every section',
    body: 'The Google engines now reach 4K in every section, and the Ultra Google tier is available for Upscale as well as for new images, so print and campaign work gets the sharpest frame. Picking a resolution that an engine does not support no longer leaves the wrong button highlighted, so the size on screen is always the size you get.',
  },
  {
    date: '2026-11-05',
    tag: 'fixed',
    title: 'Outdated AI models removed from the fallback line',
    body: 'Google withdrew several model versions that were still sitting in the fallback line, so every generation paid a guaranteed failed call before reaching a working engine. The line now holds only live models, which removes a wasted round trip from most requests. The stored search index is also protected against a dimension mismatch that could have served unranked results.',
  },
  {
    date: '2026-11-04',
    tag: 'fixed',
    title: 'A new AI account keeps the work flowing',
    body: 'The previous Alibaba plan lost access to every model on its own, which took writing, analysis, images and video offline at once. A new account serves all of them, and image and video prices are now read per resolution so a 2K frame is billed at the 2K rate instead of the 1K one.',
  },
  {
    date: '2026-10-30',
    tag: 'fixed',
    title: 'A used-up plan no longer slows every request',
    body: 'When a monthly AI plan ran out, the app kept retrying it every 30 seconds, so every single generation paid a wasted round trip before moving on. It now recognises an exhausted plan, waits it out for half an hour, and moves straight to the next working provider. Requests that fail because of billing are now treated as a real problem instead of a transient blip.',
  },
  {
    date: '2026-10-30',
    tag: 'fixed',
    title: 'Image edits fail with a real reason, not a fake outage',
    body: 'When Google declined an edit, the app reported it as a provider outage, which took the whole image feature offline for everyone until the circuit reset. Edits now name what actually happened, try the next engine instead, and the image feature stays up.',
  },
  {
    date: '2026-10-30',
    tag: 'fixed',
    title: 'The agent no longer breaks when the first engine is busy',
    body: 'Agent runs failed with a wall of provider errors whenever one provider was throttled, because the next engine was handed an engine id it could never answer. The agent now asks each provider only for what it serves, salvages work that arrives in pieces, and keeps your progress when it stops.',
  },
  {
    date: '2026-10-30',
    tag: 'fixed',
    title: 'Analysis that asks for JSON works again',
    body: 'Any request that needed a structured answer could fail with a confusing error if the word JSON happened to be missing from the prompt. It is now added automatically, so brand analysis, image analysis and structured writing come back correctly every time.',
  },
  {
    date: '2026-10-17',
    tag: 'improved',
    title: 'Images and video come back much faster',
    body: 'A 2K image that used to take about a minute now arrives in roughly 19 seconds, and a 1K image in about 10. A 4 second video clip drops from 66 seconds to 31. The prompt is no longer rewritten twice, the engines are told the exact size you picked, and the app stops waiting on the rewrite before it even accepts your request.',
  },
  {
    date: '2026-10-17',
    tag: 'new',
    title: 'Alibaba engines for text, images and video',
    body: 'Qwen is now the engine behind most writing, analysis, images and clips, with Google, Grok and Kimi standing behind it. In Creative Tools the engine picker now defaults to Auto for every section and lets you override it per section, so you can keep the automatic choice for routine work and pin a specific engine for a campaign.',
  },
  {
    date: '2026-10-17',
    tag: 'improved',
    title: 'The agent remembers where you left off',
    body: 'Agent mode used to start every message from scratch, guess what you meant by a short reply like "do it", and have no idea which client you were working on. It now carries the conversation, knows today\'s date and the open client, can save a brief and can make a video, and it asks one question when something is unclear instead of inventing 18 posts you never asked for.',
  },
  {
    date: '2026-10-17',
    tag: 'fixed',
    title: 'The agent stops crashing on large knowledge bases',
    body: 'Analysing a brief for a client with thousands of stored documents loaded every single one and crashed the server. It now reads a bounded, recent slice with short snippets, so heavy clients finish in seconds instead of failing. Long agent runs also get a hard 8 minute limit, after which the agent gets one last turn to hand back what it found instead of running forever.',
  },
  {
    date: '2026-10-13',
    tag: 'new',
    title: 'Upload a whole folder of documents at once',
    body: 'Add an Upload Folder button or drag a folder onto the page and every document inside it, including nested subfolders, lands in the right client knowledge base. Code folders, system files and empty files are skipped and counted for you. You can also load a folder straight onto the server from the command line.',
  },
  {
    date: '2026-10-13',
    tag: 'new',
    title: 'Your assistant follows you across devices',
    body: 'The assistant conversation now travels with your account instead of living in one browser tab. Open the assistant on your phone and it picks up the thread you left on your laptop, and a reload while an answer is still being written now collects that answer instead of losing it.',
  },
  {
    date: '2026-10-13',
    tag: 'new',
    title: 'AURAAI learns from the edits you make',
    body: 'Every change you make to a generated post is now remembered: rewrites become corrections, approvals become successes, and requests for changes become lessons. Those lessons are fed back into every prompt that follows, so the planner stops repeating the choices you keep fixing.',
  },
  {
    date: '2026-10-13',
    tag: 'fixed',
    title: 'Month generation finishes instead of stalling',
    body: 'Generating a month could reach 100 percent and then either fail with a connection error or leave you on a stuck screen, even though the posts had actually been saved. The app now retries a dropped connection for up to two minutes, wakes up when you return to the tab, and takes you to the finished month instead of losing it.',
  },
  {
    date: '2026-08-14',
    tag: 'new',
    title: 'Radix is now AURAAI',
    body: 'The product has a new name and logo: AURAAI. Nothing else changes. Same workspace, same login, same team. Everything you have built stays exactly where it was, your clients, calendars, briefs, galleries and history are all untouched. You may need to refresh once for the new name to show.',
  },
  {
    date: '2026-08-14',
    tag: 'improved',
    title: 'The newest AI engines across the board',
    body: 'Every engine now runs its latest version. Text, images and video moved to the newest Gemini, Grok and Qwen releases, so results come back sharper and hold your brief more closely. Long documents and big calendars also get a wider fallback engine when the main one is busy, so generations are less likely to stall. Usage is priced per model behind the scenes, so your finance reports stay accurate.',
  },
  {
    date: '2026-08-02',
    tag: 'fixed',
    title: 'Client review links now open properly',
    body: 'Share a month with a client and their link now opens the review page as intended. Previously it sent them to a sign-in screen, so they could not see the work. Your client browses the month, approves posts, requests changes and leaves comments per post, with no account needed. Feedback lands straight back in AURAAI.',
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
    body: 'Long generations (big calendars, detailed briefs) no longer come back truncated mid-sentence. Output limits were raised across engines. AURAAI also moved to the latest models across providers (Grok 4.5, Gemini 3.5 Flash, the newest image models), and when an engine wrongly blocks safe content, AURAAI now automatically retries on another engine instead of failing.',
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
    body: 'On the Review page, hit Compliance on a post and AURAAI audits the caption against that client\'s brief rules, flagging risky claims, missing disclaimers and sensitive wording by severity, each with a suggested fix. Built for financial, fraud-awareness and other regulated content.',
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
    body: 'Leave a quick note on any post for your team, and thumbs-up / thumbs-down any generated image or video so AURAAI learns each client\'s taste and leans that way next time.',
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
    body: 'New Strategy tool: drop in any competitor (brand, handle or website) and AURAAI reads their content strategy. Themes, tone, posting cadence, what they do well. Pick a client and it turns their playbook into concrete gaps that client can exploit. Grounds the read on the competitor\'s real site when you paste a URL.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Share client galleries with a public link',
    body: 'From the Gallery, hit "Share with client" to get a clean, branded review page. No login needed. Your client browses the work, downloads finals, and leaves per-asset approve / request-changes feedback that lands straight back in AURAAI. Links are private-by-token and scoped to your org.',
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
    body: 'Thumbs-up a variant and AURAAI remembers your preference per client. Future copy leans toward what you approved. Variants are also more diverse, with a new length control.',
  },
];

export async function changelogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // GET /api/changelog?limit=5 — newest first.
  app.get('/changelog', async (request) => {
    const limit = Math.min(20, Math.max(1, parseInt((request.query as { limit?: string } | undefined)?.limit ?? '5', 10) || 5));
    return { entries: CHANGELOG.slice(0, limit) };
  });
}
