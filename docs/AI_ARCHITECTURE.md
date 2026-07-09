# Radix AI Architecture — Agent, Fallback, RAG/Memory, and Creative Tools

> Living reference for how Radix routes every AI call: the two stacks, the
> provider fallback chain, the RAG + learned-memory + brand grounding layer,
> the agent tools, and the Creative Tools image/video pipeline.
>
> **Secrets:** this doc references keys by their `.env` variable NAME only.
> Actual values live in `/opt/radix-v2/server/.env` (never committed). Do not
> paste raw keys into this file.
>
> Last verified against code + `.env`: 2026-07-09.

---

## 1. Two AI stacks (know which one you're in)

Radix runs **two parallel AI stacks**. They do NOT share code — a fix in one
does not apply to the other.

| Stack | File | Used by | Fallback chain | Enrichment |
|-------|------|---------|----------------|------------|
| **aiRouter** | `server/src/services/providers/ai-router.ts` | creative tools, copywriting, calendar/month generation, design, brand analysis | per-task `CHAIN` (below) | **YES** — knowledge (RAG) + memory (learned) + brand-kit, auto-injected |
| **chat.ts** | `server/src/services/llm/chat.ts` | assistant chat, agent loop, agent tools | `DEFAULT_CHAIN = gemini → xai → moonshot` | **NO centralized enrichers** — the assistant route does RAG grounding manually (`routes/assistant.ts:344`) |

**Rule:** every AI call goes through a fallback chain. No direct single-provider
calls in routes — that crashes the feature when the provider is capped, safety-
blocked, or down.

---

## 2. aiRouter — the universal router

### 2.1 Providers

| Provider | `.env` key | Base URL | Role |
|----------|-----------|----------|------|
| Gemini | `GEMINI_API_KEY` | Google GenAI (OpenAI-compat `/v1beta/openai/`) | **Primary** (billed to company card) |
| xAI (Grok) | `XAI_API_KEY` | `XAI_BASE_URL` = `https://api.x.ai/v1` | Fallback (also cheap draft video) |
| DashScope (Alibaba) | `DASHSCOPE_API_KEY` | `DASHSCOPE_BASE_URL` (Singapore token-plan) | Extra fallback (Qwen/Wan) — no video on current plan except Wan t2v |
| Kimi/Moonshot | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` | Tertiary — **chat.ts only**, long-context text |

### 2.2 Per-task fallback chain (`CHAIN` in ai-router.ts)

```
text        : gemini → xai → dashscope
image       : gemini → xai → dashscope
image_edit  : gemini → dashscope          (skips xai — its /images/edits 403s for this team, non-retryable)
analysis    : gemini → xai → dashscope
video       : gemini(Veo) → xai(Grok) → dashscope(Wan t2v; text-only, 503s image-conditioned)
```

- **Primary override:** `PRIMARY` map from `AI_*_PRIMARY` env (all `gemini` today).
  `AI_ENABLE_FALLBACK=true` — set false to disable and use primary-only.
- **Per-call primary:** a call can force a primary (e.g. draft `text→video`
  forces `xai` so cheap Grok runs first; model-picker choice; `wan*`→dashscope,
  `omni`→gemini). Rest of the chain follows as fallback.
- **`providerAvailable()`** keeps a keyless provider OUT of the chain so a
  missing key can't throw a non-retryable error and break fallback.

### 2.3 Inner model ladder (`model-chain.ts`)

Within a single provider, `runModelLadder()` retries across models before
bubbling to the next provider. Example: Veo Pro 429 → Veo Fast (separate quota)
→ then xAI. Includes a **60-second soft-skip cache**: a model that just hit a
quota/dead-id error is skipped on the next attempt to save the round-trip.

### 2.4 Safety rails around every call

- **Circuit breaker** (`circuit-breaker.ts`) — per `provider:task`, opens after
  repeated failures so a capped provider is skipped fast.
- **Org budget gate** (`assertOrgBudget`) — throws `OrgBudgetExceededError`
  (HTTP 402) when the org hits its monthly AI spend cap (0 = no enforcement).
- **Telemetry ring buffer** (500 entries) → exposed at
  `GET /api/dashboard/ai-stats` (provider/model/latency/fallback/cost).

### 2.5 The RAG + Memory + Brand grounding layer ("AGI + RAG")

Single injection point inside `routeCall()`, **gated to `text`/`analysis` tasks
with a `clientId`**. Order matters — memory is prepended LAST so it sits closest
to the model's attention. All three are best-effort (no-op on failure / empty).

1. **`enrichWithKnowledge`** (`lib/knowledge-enricher.ts`) — **document RAG**.
   Retrieves top client `KnowledgeChunk`s (brand guidelines, past briefs,
   product facts) via `retrieveContext` = Gemini query-embedding
   (`gemini-embedding-2-preview`) + in-memory cosine over cached chunk
   embeddings. Skips the embed round-trip entirely for clients with no uploaded
   knowledge. Depends on `workers/embeddings.worker.ts` having populated
   `KnowledgeChunk.metadata.embedding`.

2. **`enrichWithMemory`** (`lib/memory-enricher.ts`) — **learned feedback**.
   Pulls the most relevant learnings (corrections/preferences/patterns/failures)
   from the `Memory` table and prepends a `[LEARNED FROM PAST FEEDBACK]` block.
   Cap 4 learnings, `MIN_SCORE=0.55` (cosine × weight). Cheap gate: skips
   retrieval when the org has zero active memories. Learnings are written by
   `services/review.service.ts` (thumbs-up → `preference`, edit → `correction`)
   and `services/memory.service.ts` (`recordMemory`). **This is the USP loop —
   it is already wired into calendar/month generation via the router.**

3. **`enrichWithBrandKit`** (`lib/brand-kit-enricher.ts`) — brand voice/colors,
   voice samples (max 3, filtered by platform) + sample images (max 5).

---

## 3. Agent stack (chat.ts + tools)

- **Chain:** `DEFAULT_CHAIN = ['gemini', 'xai', 'moonshot']`. All three expose
  the OpenAI Chat Completions surface, so one `chat.completions.create(...)`
  works for all. Stream + tool-use + JSON mode supported across the board.
- **Thinking-model hazard:** Gemini 3 + Kimi K2.6 burn tokens on
  `reasoning_content` before emitting `content`. Pass `max_tokens ≥ 1024`;
  `chatText()` falls back to `reasoning_content` when `content` is empty.
- **Assistant persona/route:** `routes/assistant.ts` (`POST /assistant/chat`) —
  `RADIX_PERSONA`, two-pass action dispatch (action JSON → execute → summarize),
  manual RAG grounding (line ~344).
- **Agent loop:** `agent/loop.ts` + `agent/content-agent.ts`.

### 3.1 Registered agent tools (`agent/tools/index.ts` → `TOOLS[]`)

Exposed to models via `toAnthropicTools()` / `toOpenAITools()`:

| Tool | File | Purpose |
|------|------|---------|
| `brief_analyze` | brief_analyze.ts | Analyze a client brief (RAG-grounded) |
| `pieces_generate` | pieces_generate.ts | Generate content pieces |
| `calendar_plan` | calendar_plan.ts | Plan a content calendar/month |
| `caption_write` | caption_write.ts | Write captions |
| `hashtag_research` | hashtag_research.ts | Hashtag sets |
| `compliance_check` | compliance_check.ts | Brand/compliance gate |
| `client_switch` | client_switch.ts | Switch active client context |
| `image_generate` | image_generate.ts | Generate an image |
| `competitor_scrape` | competitor_scrape.ts | Scrape a competitor page (feeds Competitor Intel) |
| `visual_search` | visual_search.ts | Find visual references |

---

## 4. Creative Tools (Create Tools) — image & video

Entry: `server/src/routes/creative.ts` → `aiRouter.image()` / `aiRouter.video()`.
UI can pass `provider`, `model`, `quality`/`tier`, `aspectRatio`, `imageSize`,
`safeZone`, `stylePackId`, `enhance`, and `referenceImages[]` (each with an
optional `role: content | style | character`).

### 4.1 Image generate — `POST /api/creative/images/generate`
- Chain: **gemini → xai → dashscope**.
- `quality: standard` → Gemini flash image (nano-banana); `ultra` → Imagen ultra.
- `imageSize: 1K | 2K | 4K`, `aspectRatio`, `safeZone` (keep top/bottom ~15%
  clear for platform UI), `enhance` (model-aware prompt enhancer),
  `stylePackId` (style-pack preset).

### 4.2 Image edit — `POST /api/creative/images/edit`
- Chain: **gemini → dashscope** (skips xAI — 403 on edits).
- `referenceImages[]` with per-image `role` (content / style / character-omni).

### 4.3 Video generate — `POST /api/creative/videos/generate` (async job)
- `aiRouter.video()`. **Cost tiering:**
  - `tier: draft` → **Grok** (`grok-imagine-video`, ~$0.05/s) forced primary.
  - `tier: hd` → **Veo Fast** (`veo-3.1-fast-generate-preview`).
  - **Image-conditioned / has refs** → **Veo** (Grok treats a frame as a style
    hint and invents a different subject; Veo uses it as the real first/last
    frame). Correctness wins over the draft cost saving.
  - `wan*` model → DashScope; `omni` → Gemini.

---

## 5. Provider → model matrix

> **Source of truth = the PROD env `/opt/radix-v2/server/.env`, NOT the
> git-source `/opt/radixcontent/server/.env`.** The two diverge (prod is hand-
> tuned; git-source carries aspirational/stale model ids). Values below verified
> against the **running** prod env on 2026-07-09 and confirmed by a live
> generation (`copywriting/generate` returned `gemini-pro-latest`).

| Task | Gemini (primary) | xAI (Grok) | DashScope (defaults) | Kimi |
|------|------------------|------------|----------------------|------|
| Text | **`gemini-pro-latest`** | `grok-4.20` | `qwen3.7-max` | `kimi-k2.6` (chat.ts only) |
| Chat (assistant) | **`gemini-flash-latest`** | `grok-4.20` | — | `kimi-k2.6` |
| Analysis | **`gemini-pro-latest`** | `grok-4.20` | `qwen3.6-plus` (vision) | — |
| Image | `gemini-3.1-flash-image-preview` | `grok-imagine-image` | `qwen-image-2.0-pro` | — |
| Image (ultra) | **`gemini-3.1-flash-image-preview`** (no Imagen in prod) | — | — | — |
| Video | `veo-3.1-generate-preview` / fast `veo-3.1-fast-generate-preview` | `grok-imagine-video` | `wan2.7-t2v` (text-only) | — |
| Embeddings | `gemini-embedding-2-preview` | — | — | — |

DashScope model ids are NOT set in prod `.env` → the provider's built-in
defaults apply (`qwen3.7-max`, `qwen-image-2.0-pro`, `wan2.7-t2v`,
`qwen3.6-plus` vision).

Env primaries: `AI_TEXT_PRIMARY=AI_IMAGE_PRIMARY=AI_VIDEO_PRIMARY=AI_ANALYSIS_PRIMARY=gemini`,
`AI_ENABLE_FALLBACK=true`. Assistant model var `CLAUDE_ASSISTANT_MODEL=claude-sonnet-4-20250514`
(present but the assistant currently resolves through the gemini→xai→moonshot chat chain).

`gemini-pro-latest` / `gemini-flash-latest` are **alias** model strings — the
cost meter must have these exact strings priced or they log `$0` (see §6).

---

## 6. Known gotchas (from prod history)

- **DashScope key dies at every monthly rollover** — re-issue the token-plan key.
- **Imagen path deprecates 2026-08-17** — watch for it.
- **image_edit must never route through xAI** — 403 is non-retryable and halts
  the ladder before DashScope.
- **chat.ts lacks centralized enrichers + telemetry parity** — the assistant is
  grounded manually, not via the router enrichers. Open item.
- **Cost meter keys off the exact `.env` model string** — an unpriced model
  logs `$0`. Boot guard + test added 2026-06-29; re-check when a model changes.
