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
| **chat.ts** | `server/src/services/llm/chat.ts` | assistant chat, agent loop, agent tools | `DEFAULT_CHAIN = dashscope → vertex → xai → gemini → moonshot` | **NO centralized enrichers** — the assistant route does RAG grounding manually (`routes/assistant.ts:344`) |

**Rule:** every AI call goes through a fallback chain. No direct single-provider
calls in routes — that crashes the feature when the provider is capped, safety-
blocked, or down.

---

## 2. aiRouter — the universal router

### 2.1 Providers

| Provider | `.env` key | Base URL | Role |
|----------|-----------|----------|------|
| DashScope (Alibaba) | `DASHSCOPE_API_KEY` (EU) + `DASHSCOPE_VIDEO_API_KEY` (Tokyo) | `DASHSCOPE_BASE_URL` (EU `eu-central-1`), `DASHSCOPE_VIDEO_BASE_URL` (Tokyo `ap-northeast-1`) | **Primary** — text + image + video (Qwen / Wan / HappyHorse) |
| Vertex AI (Google) | `VERTEX_API_KEY` | `https://aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/google/models/<id>:generateContent` | Fallback — text + image + image-edit + analysis. **No video engine on Vertex.** |
| Gemini (Developer API) | `GEMINI_API_KEY` | Google GenAI (OpenAI-compat `/v1beta/openai/`) | Standby — the Developer API key is billing-dead (402), the lane recovers by itself when credits return |
| xAI (Grok) | `XAI_API_KEY` | `XAI_BASE_URL` = `https://api.x.ai/v1` | Fallback (also cheap draft video) |
| Kimi/Moonshot | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` | Tertiary — **chat.ts only**, long-context text |

**The Alibaba workspace split (2026-11-07).** Each Alibaba workspace has its own
key, host, model catalog and price sheet. Production is split deliberately:

- **EU (Frankfurt) — text + image.** The only live workspace with a *readable
  priced catalog*, so the cost meter can be exact.
- **Tokyo — video.** Owns the `wan2.7-*` family that EU's catalog omits, and
  both serve `wan3.0-*` and `happyhorse-1.1-*`. The EU and Tokyo catalogs
  agree on every model they share.

The US workspace generates fine but its price catalog answers 403, so it cannot
be metered honestly and is not used in production.

**Vertex's location lives in the PATH, not the host.** The working URL is the
global host `aiplatform.googleapis.com` with
`/v1/projects/<project>/locations/<location>/...`. `us-aiplatform.googleapis.com`
answers 400 "Invalid hostname" and `us-central1-aiplatform.googleapis.com`
answers 404.

**Vertex is a DISTINCT provider name.** It is not folded into `gemini`: the
Developer API is billing-dead while the Vertex entitlement is funded, and
sharing a name would let one outage trip the other's circuit breaker.

### 2.2 Per-task fallback chain (`CHAIN` in ai-router.ts)

```
text        : dashscope → vertex → gemini → xai
image       : dashscope → vertex → gemini → xai
image_edit  : dashscope → vertex → gemini  (skips xai — its /images/edits 403s for this team, non-retryable)
analysis    : dashscope → vertex → gemini → xai
video       : dashscope → gemini → xai     (NO Vertex rung — Vertex serves no video model)
```

`vertex` sits ahead of `gemini` because the Gemini Developer API key answers
402 on every model: leaving it first would pay a doomed round-trip on every
call. It is absent from `video` on purpose — Vertex serves no video engine,
so the provider throws a clear error instead of hanging on a model that can
never answer.

- **Primary override:** `PRIMARY` map from `AI_*_PRIMARY` env (all `dashscope` today).
  `AI_ENABLE_FALLBACK=true` — set false to disable and use primary-only.
- **Per-call primary:** a call can force a primary (model-picker choice;
  `wan*`→dashscope, `qwen*`→dashscope, `gemini-*`→vertex). Rest of the chain
  follows as fallback.
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

   **Embedding provider status (2026-11-07): there is none.** The Gemini
   Developer API key is billing-dead (402 on every model, embeddings
   included) and Alibaba serves no embedding model at all. Retrieval therefore
   runs on the **lexical lane**, which needs no key. The provider logs
   `NO embedding provider reachable — serving the lexical lane instead` when
   it happens, so the dashboard tells the truth instead of silently serving
   unranked chunks.

   **Vertex is NOT a valid embedding fallback.** Its `gemini-embedding-001`
   returns 3072 dims — the same COUNT as our stored vectors — so the
   `STORED_EMBED_DIMS` guard cannot detect the swap. Measured against real
   prod chunk rows: `cos(stored, vertex-same-text) = 0.0090 – 0.0231` vs
   `cos(stored, vertex-unrelated-text) ≈ 0`. Vertex's embedding space is
   **orthogonal** to the one that wrote our 3,450 chunk vectors. A Vertex
   re-embed is only safe as a FULL store migration (every chunk and memory
   rewritten in one run, old vectors discarded) — never a partial flip.

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

- **Chain:** `DEFAULT_CHAIN = ['dashscope', 'vertex', 'xai', 'gemini', 'moonshot']`.
  All five expose the OpenAI Chat Completions surface, so one
  `chat.completions.create(...)` works for all. Stream + tool-use + JSON mode
  supported across the board. Vertex is reached through its OpenAI-compatible
  route (`/endpoints/openapi/chat/completions`, model id `google/<model>`) and
  returns the same `google.thought_signature` on tool calls, so it takes the
  Gemini branch in `shapeToolHistoryFor`.
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
- Chain: **dashscope → vertex → gemini → xai**.
- `quality: standard` → Qwen Image 3.0 Pro (Alibaba, the primary);
  `ultra` → Gemini 3 Pro Image on Vertex.
- `imageSize: 1K | 2K | 4K`, `aspectRatio`, `safeZone` (keep top/bottom ~15%
  clear for platform UI), `enhance` (model-aware prompt enhancer),
  `stylePackId` (style-pack preset).

### 4.2 Image edit — `POST /api/creative/images/edit`
- Chain: **dashscope → vertex → gemini** (skips xAI — 403 on edits).
- `referenceImages[]` with per-image `role` (content / style / character-omni).

### 4.3 Video generate — `POST /api/creative/videos/generate` (async job)
- `aiRouter.video()`. **Cost tiering:**
  - `tier: hd` → **Wan 3.0 Prime** on the Alibaba Tokyo workspace
    ($0.127199/s at 720P, $0.254399/s at 1080P). The default engine.
  - `tier: draft` → **Wan 2.7** on Tokyo ($0.086012/s at 720P).
  - `wan*` / `happyhorse*` model → DashScope (Tokyo key + host).
  - **No Vertex rung** — Vertex serves no video model, so the video chain is
    `dashscope → gemini → xai`.
  - The intra-provider ladder advances only on an Alibaba **allocation-quota**
    error; a content filter or bad request propagates immediately, because the
    next model would fail the same way.

---

## 5. Provider → model matrix

> **Source of truth = the PROD env `/opt/radix-v2/server/.env`, NOT the
> git-source `/opt/radixcontent/server/.env`.** The two diverge (prod is hand-
> tuned; git-source carries aspirational/stale model ids). Values below
> re-verified live against the running prod env on 2026-11-07 — every engine
> was probed with a real generation call, and every rate comes from the
> workspace's own price catalog.

| Task | Alibaba EU (primary) | Vertex AI | Gemini (standby) | xAI (Grok) | Kimi |
|------|----------------------|-----------|------------------|------------|------|
| Text | **`qwen3.8-max`** | `gemini-3.8-flash` | `gemini-3.1-pro-preview` | `grok-4.7` | `kimi-k2.6` (chat.ts only) |
| Chat (assistant) | **`qwen3.8-max`** | `gemini-3.8-flash` | `gemini-3.1-pro-preview` | `grok-4.7` | `kimi-k2.6` |
| Analysis | **`qwen3.8-max`** (vision) | `gemini-3.8-flash` | `gemini-3.1-pro-preview` | `grok-4.7` | — |
| Image | **`qwen-image-3.0-pro`** | `gemini-nano-banana-2.1` | `gemini-3.1-flash-image` | `grok-imagine-image` | — |
| Image (ultra) | `qwen-image-3.0-pro` @2K | **`gemini-3-pro-image`** | `gemini-3-pro-image` | — | — |
| Video | **`wan3.0-video-prime`** (Tokyo) | — (no video on Vertex) | `gemini-omni-flash-preview` | `grok-imagine-video` | — |
| Embeddings | — (Alibaba serves none) | — (orthogonal space, see §2.5) | `gemini-embedding-2-preview` | — | — |

The **video** lane runs on the Alibaba **Tokyo** workspace
(`DASHSCOPE_VIDEO_API_KEY` + `DASHSCOPE_VIDEO_BASE_URL`); text, image and
analysis run on **EU** (`DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`). Both
catalogs agree on every model they share.

Env primaries: `AI_TEXT_PRIMARY=AI_IMAGE_PRIMARY=AI_VIDEO_PRIMARY=AI_ANALYSIS_PRIMARY=dashscope`,
`AI_ENABLE_FALLBACK=true`.

The cost meter keys off the EXACT model string, so every id a provider ladder
can emit — including the `:<res>` billing suffixes Alibaba appends
(`:480p`, `:720p`, `:1080p`, `:1k`, `:2k`) — must have a row in `ai-pricing.ts`
or it logs `$0` (see §6).

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
