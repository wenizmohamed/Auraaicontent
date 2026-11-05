# AuraAI Content Planner — Debug Log
**Date:** April 6, 2026
**Version:** v2 (commit e483a39)

## QA Results

| Page | Route | Console Errors | Status |
|------|-------|---------------|--------|
| Dashboard | `/` | 0 | PASS |
| New Brief | `/brief` | 0 | PASS |
| Review | `/content-review` | 0 | PASS |
| Calendar | `/calendar` | 0 | PASS |
| Creative Tools | `/image-gen` | 0 | PASS |

## Issues Found & Fixed

### CRITICAL: No stop button during content generation
- **File:** `src/pages/BriefInput.tsx`
- **Problem:** User locked in loading overlay with no escape during 18-piece generation (30s-2min)
- **Fix:** Added `cancelledRef` + "Stop Generation" button in overlay. Cancellation breaks visual ref batch loop and navigates to review with whatever was generated.

### CRITICAL: No stop button during video generation
- **File:** `src/pages/ImageGeneration.tsx`
- **Problem:** Video polling loop (up to 10 min) with no way to cancel
- **Fix:** Added `cancelRef` + "Stop" button both inline (next to Generate) and in polling overlay.

### HIGH: ComfyUI wrong port
- **File:** `.env`, `vite.config.ts`, `src/lib/comfyui.ts`
- **Problem:** Hardcoded port 8188, but ComfyUI Desktop runs on port 8000
- **Fix:** Changed to 8000 + added Vite proxy `/comfyui-api` to bypass CORS

### HIGH: Claude model ID wrong
- **File:** `src/lib/ai.ts`
- **Problem:** `claude-opus-4-0-20250514` doesn't exist
- **Fix:** Changed to `claude-opus-4-20250514`

### HIGH: Gemini API key quota exhausted
- **Problem:** Original key `AIzaSyDM4...` hit rate limit
- **Fix:** Swapped to new key `AIzaSyAw...`, default provider to Claude

### MEDIUM: Missing IPC handlers in Electron
- **File:** `electron/main.cjs`
- **Problem:** `ipcMain` not imported, no handlers for window controls
- **Fix:** Added `ipcMain` import + minimize/maximize/close handlers

### MEDIUM: Icon JPG instead of PNG
- **Files:** `electron/main.cjs`, `package.json`
- **Problem:** Electron/NSIS need PNG, not JPG
- **Fix:** All icon refs → `radix-icon.png`

### LOW: Calendar had duplicate content generation
- **File:** `src/pages/ContentCalendar.tsx`
- **Problem:** Calendar had its own AI generation form, duplicating Brief page
- **Fix:** Rewrote Calendar to only read from `contentBriefs` store

## API Status

| Service | Model | Status |
|---------|-------|--------|
| Claude Opus 4 | `claude-opus-4-20250514` | WORKING |
| Gemini 2.5 Flash | `gemini-2.5-flash` | WORKING (new key) |
| Gemini Nano Banana 2 | `gemini-3.1-flash-image-preview` | WORKING |
| Veo 3.1 | `veo-3.1-generate-preview` | WORKING |
| ComfyUI Local | `localhost:8000` | WORKING (14 models) |
| Wikimedia Commons | Free API | WORKING |

## Models Available (ComfyUI Local)
- CyberRealisticPony V14.1
- CyberRealisticXL Play V8.0
- Juggernaut XL v9
- RealVis XL V5
- Realistic Vision V6.0
- EpicRealism XL (NSFW)
- EpicRealism Natural Sin RC1
- HuslyoRealism XL v10
- Pony Realism v22
- BigLust v16
- SD 1.5 Pruned
+ 3 more

## Build Verification
- Vite build: PASS (8.2s)
- Electron builder: PASS (portable exe 104MB)
- GitHub push: PASS (wenizmohamed/radix-ai-content-planner)
