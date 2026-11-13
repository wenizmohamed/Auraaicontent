// "What's new on AURA" — product changelog surfaced on every user's
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
    date: '2026-11-14',
    tag: 'new',
    title: 'ByteDance Seedance 2.5 & 2.0 Cinema Video + Dola Seedream 5.5 RGBA & 5.0 4K Join Creative Studio',
    body: 'BytePlus ModelArk is now integrated end to end across Creative Studio and AURA Agent Mode. Direct up-to-30s cinema video with synchronized native audio, multi-shot cuts, first and last frame bookends, and omni multimodal references on Dreamina Seedance 2.5, Seedance 2.0 (up to 4K), Seedance 2.0 Fast, Seedance 2.0 Mini, and Seedance 1.0 Pro Fast, with automatic browser-ready H.264 MP4 delivery. Generate studio stills, multi-reference edits (up to 10 images), native RGBA transparent PNG cutouts, and true 4K visuals with Dola Seedream 5.5, Seedream 5.0 Pro, Seedream 5.0 4K, and Seedream 5.0 Flash, all prompt-directed by Gemini 4 Carbon.',
  },
  {
    date: '2026-11-13',
    tag: 'new',
    title: 'Gemini 4 Argon Powers AURA Agent Mode & AURA Chat + 3 New Creative Tools',
    body: 'AURA Chat and AURA Agent Mode now run on Google Gemini 4 Argon (backed by Vertex AI high-availability failover) for frontier multi-step reasoning and tool execution. Agent Mode gains three new creative tools: Image Edit & Retouching (edit saved Gallery assets with product and mascot consistency), Brand Memory Save (capture permanent character specs, hex palettes, and visual reference links into Client Memory), and Prompt Director (craft or explore 3 studio prompt directions on demand), plus slide-by-slide 4:5 Instagram and LinkedIn carousel generation.',
  },
  {
    date: '2026-11-13',
    tag: 'improved',
    title: 'Gemini 4 Carbon Creative Director: Adaptive Master Prompts & Single-Slide Carousel Guard',
    body: 'Creative Studio prompt rewriting and Suggest 3 Directions now run directly on Google Gemini 4 Carbon. Pasted chat wrappers are stripped automatically, explicit hex color palettes, 80px layout margins, and exact quoted copy are preserved without truncation, and pasting a multi-slide carousel brief into single-image generation cleanly renders Slide 1 as a full-bleed hero frame instead of drawing broken multi-slide grids.',
  },
  {
    date: '2026-11-12',
    tag: 'new',
    title: 'MiniMax H3 (2K + Stereo Audio), H3-Image (4K) & 1-Click Studio Chaining',
    body: 'MiniMax M Plan is now live across every Creative Studio mode. Generate native 4K stills and multi-reference edits with MiniMax H3-Image, H3-Image Highspeed, and Image-01, or render 2K cinema video with synchronized stereo sound, human micro-expressions, first/last frame bookends, and product reference consistency using MiniMax H3 and H3-Max. Every generated image now includes 1-click Edit Image and Animate buttons to chain stills straight into Image Edit or Image-to-Video, with permanent local gallery storage even when working outside a client workspace.',
  },
  {
    date: '2026-11-12',
    tag: 'new',
    title: 'AURA Creative Director: Smart Engine Routing & Effortless Prompt Understanding',
    body: 'AURA now controls every image, edit, and video workflow as your intelligent Creative Director. Powered by Anthropic Claude Sonnet 5.5 and Google Gemini 4 Carbon, AURA decodes shorthand, typos, bilingual Arabic and English ideas, and pop-culture concepts into cinema-grade prompts, then automatically routes Auto picks to the strongest engine for your exact scene.',
  },
  {
    date: '2026-11-12',
    tag: 'new',
    title: 'Claude Sonnet 5.5, Gemini 4 Carbon & Gemini Omni 1.2 Video join AURAAI',
    body: 'AURAAI now runs a five-provider flagship stack: Anthropic Claude Sonnet 5.5 and Opus 5.5 for reasoning, prompt understanding, and agent orchestration; Google Gemini 4 Carbon, Gemini 3 Pro Image (Generate and Edit), and Gemini Omni 1.2 and 1.1 Flash Video; Alibaba Qwen Image 3.0 Pro, Wan 2.7 Image Pro, and Wan 3.0 Prime; xAI Grok Imagine 2.0 (native 2K) and Grok Video 1.5 (1080p); and Moonshot Kimi K3.1 Pro.',
  },
  {
    date: '2026-11-12',
    tag: 'improved',
    title: 'Native 2K Stills, Default 1080p HD Video & Opt-in Brand Kit Control',
    body: 'Every studio image now renders in crisp 2K resolution by default (including Grok Imagine 2.0 and Gemini 3 Pro Image), and Video Studio now defaults to 1080p HD. A new Brand Kit toggle in Creative Studio keeps general creative prompts 100% pure by default, weaving in your active client palette and identity only when you switch it on.',
  },
  {
    date: '2026-11-12',
    tag: 'fixed',
    title: 'Zero Brand-Prompt Bleed & Reliable Multi-Engine Edit Gallery Saves',
    body: 'Fixed an issue where active client brand copy could leak into unrelated image or video prompts, fixed gallery saving for URL-returned image edits, and upgraded Vertex AI and Gemini 4 Carbon fallbacks for uninterrupted studio production.',
  },
  {
    date: '2026-11-11',
    tag: 'new',
    title: 'Wan 2.7 Image Pro, Grok Imagine 2.0 & Grok Video 1.5 join the Creative Studio',
    body: 'You now have six flagship image engines and five video engines in one picker. Alibaba Wan 2.7 Image Pro and Wan 2.7 Image join Qwen Image 3.0 Pro for photorealistic product, skin and material detail, alongside Google Gemini Nano Banana 2.1, Gemini 3 Pro Image and xAI Grok Imagine 2.0 across Generate, Edit and Upscale. For video, xAI Grok Imagine Video 1.5 and 1.5 Lite join Wan 3.0 Prime, Wan 3.0 Fast and HappyHorse 1.1.',
  },
  {
    date: '2026-11-11',
    tag: 'improved',
    title: 'Model-aware Prompt Enhancer for Image, Edit & Video',
    body: 'The Enhance Prompt button now writes in the exact visual dialect of the engine you select. Choosing Wan 2.7 Image Pro, Qwen Image 3.0, Gemini Nano Banana 2.1, Grok Imagine 2.0, Wan 3.0 or Grok Video 1.5 tailors camera optics, focal length, lighting ratios, surface micro-textures, temporal motion physics and bilingual Arabic/English typography to that specific model, with a live dialect badge showing which engine grammar is active.',
  },
  {
    date: '2026-11-11',
    tag: 'new',
    title: 'Four-provider AI backbone: Alibaba, Google Gemini 4, xAI Grok & Kimi K3.1',
    body: 'Every strategy, calendar, chat and creative workflow is now powered by four active flagship providers at once: Alibaba Qwen 3.8 Max & Qwen 4, Google Gemini 4 Argon & Carbon, xAI Grok 4.7, and Moonshot Kimi K3.1 Pro Highspeed for deep reasoning and long-form copywriting. Multi-model fallback ladders keep image, edit, video and text generations flowing smoothly even if a single model is busy.',
  },
  {
    date: '2026-11-11',
    tag: 'fixed',
    title: 'Seamless small-logo Image Editing & full-quality Masterpiece Video',
    body: 'Uploading small logos, icons or compact product cutouts into Image Edit no longer triggers a minimum-resolution error: small source images are automatically upscaled behind the scenes before editing. In Video Studio, choosing the Masterpiece tier now dispatches full flagship 1080p rendering instead of falling back to draft mode.',
  },
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
    title: 'AURA learns from the edits you make',
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
    title: 'Welcome to AURA',
    body: 'The product has a new name and logo: AURA. Nothing else changes. Same workspace, same login, same team. Everything you have built stays exactly where it was, your clients, calendars, briefs, galleries and history are all untouched. You may need to refresh once for the new name to show.',
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
    body: 'Share a month with a client and their link now opens the review page as intended. Previously it sent them to a sign-in screen, so they could not see the work. Your client browses the month, approves posts, requests changes and leaves comments per post, with no account needed. Feedback lands straight back in AURA.',
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
    body: 'Long generations (big calendars, detailed briefs) no longer come back truncated mid-sentence. Output limits were raised across engines. AURA also moved to the latest models across providers (Grok 4.5, Gemini 3.5 Flash, the newest image models), and when an engine wrongly blocks safe content, AURA now automatically retries on another engine instead of failing.',
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
    body: 'On the Review page, hit Compliance on a post and AURA audits the caption against that client\'s brief rules, flagging risky claims, missing disclaimers and sensitive wording by severity, each with a suggested fix. Built for financial, fraud-awareness and other regulated content.',
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
    body: 'Leave a quick note on any post for your team, and thumbs-up / thumbs-down any generated image or video so AURA learns each client\'s taste and leans that way next time.',
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
    body: 'New Strategy tool: drop in any competitor (brand, handle or website) and AURA reads their content strategy. Themes, tone, posting cadence, what they do well. Pick a client and it turns their playbook into concrete gaps that client can exploit. Grounds the read on the competitor\'s real site when you paste a URL.',
  },
  {
    date: '2026-07-06',
    tag: 'new',
    title: 'Share client galleries with a public link',
    body: 'From the Gallery, hit "Share with client" to get a clean, branded review page. No login needed. Your client browses the work, downloads finals, and leaves per-asset approve / request-changes feedback that lands straight back in AURA. Links are private-by-token and scoped to your org.',
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
    body: 'Thumbs-up a variant and AURA remembers your preference per client. Future copy leans toward what you approved. Variants are also more diverse, with a new length control.',
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
