# RADIX AI CONTENT OS — Native Desktop App Plan

**Version:** 2.0 (Tauri Migration)
**Prepared by:** Mohamed — Head of AI & Digital Transformation
**Date:** April 2026
**Status:** Planning Phase

---

## 1. EXECUTIVE SUMMARY

Migrate the Radix AI Content Planner from Electron (213MB, Chrome wrapper) to Tauri 2.0 (native, ~15MB). Add SQLite persistence, offline-first architecture, native file system access, and multi-workspace support. Goal: production-grade desktop app for the 7-person content team serving 13 clients.

**Current state:** Working Electron app with localStorage, 17 React pages, dual AI (Claude + Gemini), ComfyUI integration.

**Target state:** Native Tauri app with SQLite database, offline queue, native file drag-drop, auto-updater, system tray, and client workspace isolation.

---

## 2. WHY TAURI OVER ELECTRON

| Factor | Electron (Current) | Tauri 2.0 (Target) |
|--------|-------------------|---------------------|
| Bundle size | 213MB | ~15-20MB |
| RAM usage | 300-500MB | 50-80MB |
| Startup time | 3-5 seconds | <1 second |
| Backend | None (browser only) | Rust (native performance) |
| Database | localStorage (5MB limit) | SQLite (unlimited) |
| File access | Limited | Full native FS |
| Auto-update | Manual rebuild | Built-in updater |
| Security | API keys in JS bundle | Keys in Rust backend (secure) |
| Offline | No | Full offline queue |

---

## 3. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────┐
│                   TAURI SHELL                     │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Rust Core   │  │    React Frontend         │  │
│  │             │  │                            │  │
│  │ • SQLite DB  │←→│ • Dashboard               │  │
│  │ • API Proxy  │  │ • Brief Input             │  │
│  │ • File I/O   │  │ • Content Review          │  │
│  │ • Offline Q   │  │ • Calendar                │  │
│  │ • Auto-update│  │ • Creative Tools          │  │
│  │ • Key vault  │  │                            │  │
│  └─────────────┘  └──────────────────────────┘  │
│           ↕                      ↕                │
│    Native OS APIs         WebView (Wry)          │
└─────────────────────────────────────────────────┘
         ↕                         ↕
   Local Files              Cloud APIs
   (exports, assets)     (Claude, Gemini, Veo)
```

**Key principle:** Rust handles all sensitive operations (API keys, database, file I/O). React handles UI only. Communication via Tauri `invoke()` commands.

---

## 4. DATABASE SCHEMA (SQLite)

### 4.1 Core Tables

```sql
-- Organizations / Agencies
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT DEFAULT 'pro',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Client Workspaces (one per client)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  client_name TEXT NOT NULL,
  industry TEXT,
  brand_colors TEXT, -- JSON array
  brand_fonts TEXT,  -- JSON object
  tone TEXT,
  guidelines TEXT,
  logo_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Content Briefs
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  month TEXT NOT NULL,
  campaigns TEXT NOT NULL, -- JSON array
  occasions TEXT,          -- JSON array
  platforms TEXT,           -- JSON array
  piece_count INTEGER DEFAULT 18,
  tone_notes TEXT,
  status TEXT CHECK(status IN ('draft','generating','review','approved','exported')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generated Content Pieces
CREATE TABLE content_pieces (
  id TEXT PRIMARY KEY,
  brief_id TEXT REFERENCES briefs(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id),
  platform TEXT NOT NULL,
  format TEXT, -- Static, Reel, Carousel, Story, Video, Article
  key_message TEXT,    -- Copy overlay on visual
  caption TEXT,        -- Social media caption
  cta TEXT,            -- Call to action
  creative_copy TEXT,  -- Art direction for designer
  hashtags TEXT,       -- JSON array
  visual_reference TEXT, -- Description for image search
  visual_ref_images TEXT, -- JSON array of {imageUrl, sourceUrl, description}
  target_audience TEXT,
  campaign_theme TEXT,
  suggested_date TEXT,
  char_count INTEGER,
  char_limit INTEGER,
  char_status TEXT CHECK(char_status IN ('good','warning','over')),
  status TEXT CHECK(status IN ('generated','approved','edited','rejected')) DEFAULT 'generated',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generated Assets (images, videos)
CREATE TABLE generated_assets (
  id TEXT PRIMARY KEY,
  content_piece_id TEXT REFERENCES content_pieces(id),
  type TEXT CHECK(type IN ('image','video','reference')),
  file_path TEXT,     -- Local file path
  cloud_url TEXT,     -- Remote URL if uploaded
  model_used TEXT,    -- gemini-3.1-flash-image-preview, veo-3.1, comfyui, etc.
  prompt TEXT,
  metadata TEXT,      -- JSON (dimensions, duration, etc.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Approval Workflow
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  content_piece_id TEXT REFERENCES content_pieces(id),
  reviewer TEXT,
  status TEXT CHECK(status IN ('pending','approved','rejected','revision')),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Offline Queue (for when no internet)
CREATE TABLE offline_queue (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL, -- 'generate_brief', 'generate_image', 'generate_video'
  payload TEXT NOT NULL, -- JSON
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API Usage Tracking
CREATE TABLE api_usage (
  id TEXT PRIMARY KEY,
  provider TEXT, -- 'claude', 'gemini', 'veo', 'comfyui'
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  images_generated INTEGER DEFAULT 0,
  videos_generated INTEGER DEFAULT 0,
  cost_estimate REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 4.2 Indexes

```sql
CREATE INDEX idx_pieces_brief ON content_pieces(brief_id);
CREATE INDEX idx_pieces_workspace ON content_pieces(workspace_id);
CREATE INDEX idx_pieces_status ON content_pieces(status);
CREATE INDEX idx_assets_piece ON generated_assets(content_piece_id);
CREATE INDEX idx_briefs_workspace ON briefs(workspace_id);
CREATE INDEX idx_usage_provider ON api_usage(provider, created_at);
```

---

## 5. RUST BACKEND COMMANDS

All sensitive operations happen in Rust. React calls them via `invoke()`.

### 5.1 API Proxy Commands (keys never touch JS)

```
invoke('ai_generate_content', { prompt, provider, model })
invoke('ai_generate_image', { prompt, model, aspectRatio, size })
invoke('ai_generate_video', { prompt, model })
invoke('ai_search_visual_refs', { query })
invoke('comfyui_generate', { prompt, model, width, height })
invoke('comfyui_check_status') → returns { running: bool, port: number, models: string[] }
```

### 5.2 Database Commands

```
invoke('db_create_workspace', { name, industry, ... })
invoke('db_create_brief', { workspaceId, month, campaigns, ... })
invoke('db_save_pieces', { briefId, pieces })
invoke('db_update_piece_status', { id, status })
invoke('db_get_briefs', { workspaceId })
invoke('db_get_pieces', { briefId })
invoke('db_get_usage_stats', { startDate, endDate })
```

### 5.3 File System Commands

```
invoke('fs_save_asset', { data, filename, type }) → returns filePath
invoke('fs_export_pdf', { briefId })
invoke('fs_export_pptx', { briefId })
invoke('fs_export_csv', { briefId })
invoke('fs_open_in_explorer', { path })
invoke('fs_get_asset', { path }) → returns base64
```

### 5.4 Offline Queue Commands

```
invoke('queue_add', { action, payload })
invoke('queue_process') → processes pending items when online
invoke('queue_status') → returns { pending: number, failed: number }
```

---

## 6. FRONTEND PAGES (React)

### 6.1 Page Structure (5 main + sub-routes)

| # | Page | Route | Purpose |
|---|------|-------|---------|
| 1 | Dashboard | `/` | Stats, quick actions, recent briefs, API usage chart |
| 2 | New Brief | `/brief` | Client brief input → AI generation |
| 3 | Content Review | `/review` | Approve/edit/reject generated pieces |
| 4 | Calendar | `/calendar` | Calendar view of scheduled content |
| 5 | Creative Tools | `/tools` | Image gen, video gen, prompt improver, ComfyUI |

### 6.2 Component Hierarchy

```
App.tsx
├── Sidebar (nav + workspace selector)
├── TitleBar (custom, draggable)
├── StatusBar (online/offline, sync status, API usage)
└── Router
    ├── Dashboard
    │   ├── StatsGrid (bento layout)
    │   ├── RecentBriefs
    │   ├── PipelineChart
    │   └── QuickActions
    ├── BriefInput
    │   ├── ClientSelector (from workspaces DB)
    │   ├── CampaignCards
    │   ├── OccasionPills
    │   ├── PlatformSelector
    │   ├── PieceCountSlider
    │   ├── GenerateButton (with stop/cancel)
    │   └── LoadingOverlay
    ├── ContentReview
    │   ├── FilterBar
    │   ├── ContentPieceCard
    │   │   ├── PlatformBadge
    │   │   ├── CopySection (key message + caption + CTA + hashtags)
    │   │   ├── VisualRefGrid
    │   │   ├── CharCounter
    │   │   └── ActionButtons (approve/edit/reject)
    │   └── BulkActionBar
    ├── Calendar
    │   ├── MonthNav
    │   ├── CalendarGrid
    │   ├── DayDetailPanel
    │   └── PlatformFilter
    └── CreativeTools
        ├── ModeSelector (5 modes)
        ├── PromptInput
        ├── ConfigRow (aspect ratio, resolution, model)
        ├── ResultDisplay (image/video/text)
        ├── StopButton
        └── History
```

---

## 7. OFFLINE-FIRST ARCHITECTURE

### 7.1 How It Works

1. All data lives in SQLite (local-first)
2. AI generation requests go to offline queue when no internet
3. When connection restores, queue processes automatically
4. Generated assets saved to local filesystem first
5. Optional cloud sync for team collaboration (Phase 2)

### 7.2 Offline Queue Flow

```
User clicks "Generate" → Check online?
  ├── YES → Call API directly → Save result to SQLite + filesystem
  └── NO  → Add to offline_queue table → Show "Queued" badge
            → When online detected → Process queue in order
            → Notify user when complete
```

### 7.3 What Works Offline

| Feature | Offline | Online |
|---------|---------|--------|
| View dashboard & stats | ✅ | ✅ |
| Browse existing briefs | ✅ | ✅ |
| Review/approve content | ✅ | ✅ |
| Edit captions/copy | ✅ | ✅ |
| Export PDF/PPTX | ✅ | ✅ |
| Generate new content | ❌ (queued) | ✅ |
| Generate images | ❌ (queued) | ✅ |
| ComfyUI (local GPU) | ✅ | ✅ |
| Visual ref search | ❌ (queued) | ✅ |

---

## 8. SECURITY MODEL

### 8.1 API Key Storage

**Current (Electron):** Keys baked into JS bundle via Vite define. Extractable by anyone.

**Target (Tauri):** Keys stored in OS keychain via `tauri-plugin-stronghold` or environment variables read only by Rust backend. Never exposed to WebView.

```
Frontend: invoke('ai_generate_content', { prompt })
         ↓ (no key)
Rust:    let key = std::env::var("ANTHROPIC_API_KEY")?;
         let response = reqwest::post(url).header("x-api-key", key)...
         ↓ (key never leaves Rust)
Frontend: receives only the result
```

### 8.2 Content Security Policy

```json
{
  "security": {
    "csp": "default-src 'self'; img-src 'self' https://upload.wikimedia.org https://images.unsplash.com https://i.pinimg.com; connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com http://127.0.0.1:8000; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com"
  }
}
```

---

## 9. AUTO-UPDATER

Tauri 2.0 has a built-in updater. Configuration:

```json
{
  "updater": {
    "active": true,
    "dialog": true,
    "endpoints": ["https://releases.radixmedia.ae/radix-desktop/updates/{{target}}/{{arch}}/{{current_version}}"],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ..."
  }
}
```

**Update flow:**
1. App checks endpoint on startup
2. If new version available, shows native dialog
3. User clicks "Update" → downloads diff patch (~5MB)
4. Applies update → restarts app
5. No manual download/reinstall needed

---

## 10. NATIVE FEATURES

### 10.1 System Tray

- Radix logo in system tray
- Right-click menu: Open, New Brief, Recent Briefs, Quit
- Badge shows queued/pending items count
- Minimize to tray on close

### 10.2 Native File Drag-Drop

- Drag images from desktop into Creative Tools
- Drag generated assets from app to desktop/Finder
- Drag content pieces to reorder in calendar
- Drop PDF/DOCX briefs onto app to import

### 10.3 Native Notifications

- "18 content pieces generated for Al Fardan Exchange"
- "Offline queue: 3 items processed"
- "Content approved by Ahmed"
- Uses OS notification center (Windows Action Center / macOS Notification Center)

### 10.4 Deep Links

- `radix://brief/new` → Opens app at brief creation
- `radix://review/{briefId}` → Opens specific review
- `radix://calendar` → Opens calendar view
- Useful for email/Slack notifications linking directly to content

---

## 11. EXPORT CAPABILITIES

### 11.1 PDF Export (per brief)

- Cover page with client name, month, agency branding
- One page per content piece: platform, copy section, visual ref thumbnails
- Summary page with budget, KPIs, timeline
- Generated natively via Rust PDF library (not browser print)

### 11.2 PPTX Export

- Each piece becomes a slide
- Platform-branded colors
- Copy + visual refs + hashtags per slide
- Client logo on every slide

### 11.3 CSV/Excel Export

- All pieces in spreadsheet format
- Columns: Date, Platform, Format, Key Message, Caption, CTA, Hashtags, Status
- Filterable by platform, status, campaign

---

## 12. API USAGE TRACKING & BUDGET

### 12.1 Dashboard Widget

Real-time API usage chart showing:
- Daily/weekly/monthly token consumption
- Cost per provider (Claude, Gemini, Veo)
- Cost per client workspace
- Projected monthly spend
- Budget alerts (80%, 90%, 100% thresholds)

### 12.2 Usage Limits

```rust
// Per-workspace monthly limits (configurable)
struct UsageLimits {
    max_briefs_per_month: u32,      // default: 10
    max_images_per_month: u32,      // default: 200
    max_videos_per_month: u32,      // default: 50
    max_token_spend_usd: f64,       // default: 100.0
}
```

### 12.3 Tracked Metrics

| Metric | Stored Per |
|--------|-----------|
| Input tokens | Request |
| Output tokens | Request |
| Images generated | Request |
| Videos generated | Request |
| Estimated cost (USD) | Request |
| Provider + model | Request |
| Workspace (client) | Request |

---

## 13. MULTI-WORKSPACE (CLIENT ISOLATION)

### 13.1 Workspace Switcher

- Dropdown in sidebar header
- Each client = separate workspace
- Workspace stores: brand colors, fonts, tone, guidelines, logo
- All briefs, pieces, assets scoped to workspace
- Switch workspace → entire app context changes

### 13.2 Pre-loaded Workspaces

| Client | Industry | Status |
|--------|----------|--------|
| Al Fardan Exchange | Financial Services | Full KB loaded |
| Client 2-13 | Various | Template ready |

---

## 14. COMFYUI INTEGRATION (ENHANCED)

### 14.1 Local GPU Mode

- Auto-detect ComfyUI Desktop on startup
- Probe ports 8000, 8188 for API
- List available checkpoint models
- Submit workflows via REST API
- Poll for results
- Save generated images to local filesystem

### 14.2 Workflow Templates

Pre-built ComfyUI workflow JSONs for:
- Text-to-image (SDXL, Flux, EpicRealism)
- Image-to-image (style transfer, upscale)
- Inpainting (edit regions)
- ControlNet (pose, depth, canny)

### 14.3 Model Recommendations

| Use Case | Model | Quality |
|----------|-------|---------|
| Photorealistic people | EpicRealism XL | Best |
| Product photography | RealVis XL V5 | Excellent |
| Editorial/lifestyle | Juggernaut XL v9 | Excellent |
| Creative/artistic | CyberRealistic XL | Good |
| Fast drafts | SD 1.5 | Fastest |

---

## 15. PLATFORM CHARACTER LIMITS (BUILT-IN)

Already implemented. Verified April 2026:

| Platform | Max | Optimal | Hashtags | Truncate At |
|----------|-----|---------|----------|-------------|
| Instagram Post | 2,200 | 180 | 5 | 125 |
| Instagram Reel | 2,200 | 100 | 5 | 55 |
| TikTok | 4,000 | 100 | 5 | 100 |
| LinkedIn Post | 3,000 | 1,900 | 5 | 210 |
| X/Twitter Free | 280 | 85 | 2 | 280 |
| Facebook Post | 63,206 | 60 | 3 | 125 |

---

## 16. AI MODELS & PRICING

### 16.1 Models Used

| Purpose | Model ID | Provider |
|---------|----------|----------|
| Content generation | claude-opus-4-20250514 | Anthropic |
| Text analysis | gemini-2.5-flash | Google |
| Image generation | gemini-3.1-flash-image-preview | Google (Nano Banana 2) |
| Image editing | gemini-2.5-flash-image | Google (Nano Banana) |
| Video generation | veo-3.1-generate-preview | Google (Veo 3.1) |
| Local image gen | SDXL/Flux/EpicRealism | ComfyUI (free) |
| Research | gemini-3.1-pro-preview | Google |
| Visual refs | Wikimedia Commons API | Free |

### 16.2 Monthly Cost (6-7 users)

| Service | Monthly (6 users) | Annual |
|---------|-------------------|--------|
| Claude Opus | $8.76 | $105.12 |
| Gemini text | $0.06 | $0.72 |
| Gemini images | $8.04 | $96.48 |
| Veo videos | $45.00 | $540.00 |
| Wikimedia | FREE | FREE |
| ComfyUI local | FREE | FREE |
| **TOTAL** | **$61.86** | **$742.32** |

---

## 17. BUILD & DISTRIBUTION

### 17.1 Build Targets

| Platform | Format | Size | Notes |
|----------|--------|------|-------|
| Windows | .msi installer | ~15MB | NSIS installer, auto-update |
| Windows | .exe portable | ~18MB | Single file, no install |
| macOS | .dmg | ~12MB | Universal binary (Intel + Apple Silicon) |
| macOS | .app | ~12MB | Drag to Applications |

### 17.2 Build Command

```bash
# Development
npm run tauri dev

# Production build (current platform)
npm run tauri build

# Cross-platform (CI/CD)
npm run tauri build -- --target x86_64-pc-windows-msvc
npm run tauri build -- --target aarch64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

### 17.3 CI/CD Pipeline

```
GitHub Push → GitHub Actions → Build (Win + Mac) → Sign → Upload to releases → Auto-updater serves
```

---

## 18. MIGRATION PLAN (FROM CURRENT ELECTRON APP)

### Phase 1: Foundation (Week 1)
- [ ] Set up Tauri 2.0 project with Rust backend
- [ ] Migrate React frontend (copy existing src/)
- [ ] Replace localStorage with SQLite via invoke commands
- [ ] Move API keys to Rust backend
- [ ] Basic window + tray icon

### Phase 2: Database (Week 2)
- [ ] Implement full SQLite schema
- [ ] Create all Rust invoke commands
- [ ] Migrate data from localStorage on first launch
- [ ] Workspace switcher UI

### Phase 3: AI Integration (Week 3)
- [ ] Move Claude API calls to Rust
- [ ] Move Gemini API calls to Rust
- [ ] Move Veo video calls to Rust (with proper URI download)
- [ ] ComfyUI integration via Rust HTTP client
- [ ] Offline queue for failed/no-internet requests

### Phase 4: Native Features (Week 4)
- [ ] System tray with menu
- [ ] Native notifications
- [ ] File drag-drop
- [ ] Auto-updater
- [ ] Deep links
- [ ] Native PDF/PPTX export

### Phase 5: Polish & Testing (Week 5)
- [ ] Cross-platform testing (Windows + Mac)
- [ ] Performance benchmarks
- [ ] Security audit (no keys in JS)
- [ ] Installer signing
- [ ] CI/CD pipeline

---

## 19. TEAM & ROLES

| Person | Role | Responsibility |
|--------|------|---------------|
| Mohamed | Head of AI & Digital Transformation | Architecture, AI integration, Rust backend |
| Ahmed | Head of Content | UX requirements, content workflow validation |
| Drishti | Designer | Visual refs validation, UI feedback |
| Content Team (4) | Users | Daily usage, feedback, QA |

---

## 20. SUCCESS METRICS

| Metric | Current (Manual) | Target (With App) | Improvement |
|--------|-----------------|-------------------|-------------|
| Time per brief | 8-12 hours | 5-10 minutes | 96% reduction |
| Content pieces/month | 100-150 | 400+ | 3-4x increase |
| Manual hours/month | 600+ | <20 | 97% reduction |
| API cost/month | N/A | ~$62 | New cost |
| App size | 213MB (Electron) | ~15MB (Tauri) | 93% smaller |
| RAM usage | 300-500MB | 50-80MB | 85% less |
| Startup time | 3-5 seconds | <1 second | 80% faster |

### ROI

- **Manual labor saved:** 580 hrs/month × $25/hr = **$14,500/month saved**
- **API cost:** $62/month
- **Net savings:** $14,438/month = **$173,256/year**
- **ROI:** 23,287%

---

*End of Plan — Radix AI Content OS v2.0*
*Prepared April 2026 by Mohamed & CLAUDI*
