# RADIX AI Content Planner

AI-powered content planning dashboard for Radix Media. Takes a client brief and generates 18 platform-optimized content pieces with captions, visual references, and hashtags in one click.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/wenimohamed2/radix-ai-content-planner.git
cd radix-ai-content-planner

# 2. Install
npm install

# 3. Add API keys
cp .env.example .env
# Edit .env with your keys:
#   GEMINI_API_KEY=your_gemini_key
#   ANTHROPIC_API_KEY=your_claude_key

# 4. Run
npm run dev
# Opens at http://localhost:3000
```

## Desktop App (Electron)

```bash
# Dev mode (hot reload)
npm run electron:dev

# Build portable exe (Windows)
npm run electron:build

# Build Mac app (run on Mac)
npm run electron:build
```

## What It Does

**Core Workflow: Brief → 18 Content Pieces**

1. **Dashboard** — Stats, quick actions, recent briefs
2. **New Brief** — Input client brief (campaigns, occasions, platforms, piece count)
3. **AI Generates** — Claude Opus / Gemini creates all content pieces in one shot
4. **Review** — Approve/edit/reject each piece with live character counters
5. **Calendar** — Content calendar view with visual references

Each generated piece includes:
- Platform-optimized caption (within character limits)
- Creative copy (art direction for designers)
- Visual reference images (Pinterest-sourced)
- Hashtags (within platform limits)
- Suggested posting date
- Campaign assignment

## Platform Limits (Built-in, April 2026)

| Platform | Caption Max | Optimal | Hashtags |
|----------|------------|---------|----------|
| Instagram | 2,200 | 180 | 5 |
| TikTok | 4,000 | 100 | 5 |
| LinkedIn | 3,000 | 1,900 | 5 |
| X/Twitter | 280 | 85 | 2 |
| Facebook | 63,206 | 60 | 3 |

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Framer Motion
- **AI:** Gemini 2.5 Flash / 3.1 Flash (Nano Banana 2) + Claude Opus (fallback)
- **Build:** Vite 6
- **Desktop:** Electron 41
- **Data:** localStorage (no backend needed)
- **Video Gen:** Veo 3.1

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | Home, stats, "Start New Brief" CTA |
| New Brief | `/brief` | Client brief input form |
| Review | `/content-review` | Review/approve generated pieces |
| Calendar | `/calendar` | Content calendar with visual refs |
| Creative Tools | `/image-gen` | Text-to-Image, Text-to-Video, Image-to-Video, Prompt Improver |

## Project Structure

```
src/
├── pages/           # 17 React pages
├── components/      # VisualRefSearch, etc.
├── lib/
│   ├── ai.ts        # Gemini + Claude dual AI with fallback
│   ├── clients.ts   # Client knowledge base (Al Fardan pre-loaded)
│   ├── prompts.ts   # Centralized AI prompt templates
│   ├── platform-limits.ts  # 2026 social media character limits
│   ├── store.tsx    # React Context state management
│   └── gemini.ts    # Gemini SDK wrapper
├── services/
│   └── api.ts       # localStorage mock API
electron/
├── main.cjs         # Electron main process
└── preload.cjs      # Context bridge
```

## Pre-loaded Client: Al Fardan Exchange

The app comes with Al Fardan Exchange fully configured:
- 6 products (Money Transfers, Currency Exchange, Travelez Card, AlfaPay, WPS, Value-Added Services)
- 7 default campaigns from real briefing template
- 10 UAE special occasions
- Brand guidelines, tone, compliance notes
- CBUAE regulatory compliance built into prompts

## AI Models Used

| Purpose | Model |
|---------|-------|
| Text-to-Image | `gemini-3.1-flash-image-preview` (Nano Banana 2) |
| Text Generation | `gemini-2.5-flash` |
| Content Generation | `claude-opus-4-0-20250514` (primary) |
| Video Generation | `veo-3.1-generate-preview` |
| Research | `gemini-3.1-pro-preview` + Google Search |
| Image Editing | `gemini-2.5-flash-image` |

## For Mac Pro Setup

```bash
# Install Node.js if not installed
brew install node

# Clone and run
git clone https://github.com/wenimohamed2/radix-ai-content-planner.git
cd radix-ai-content-planner
npm install
cp .env.example .env
# Add your API keys to .env
npm run dev
```

## License

Private — Radix Media internal tool.

---

Built by Mohamed (Weni) + CLAUDI | April 2026
