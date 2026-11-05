# DashScope (Alibaba Model Studio) integration

Adds Alibaba's **Model Studio "Token Plan"** (org `aura`) to AuraAI's multi-LLM
router as an additional **text** and **image** provider. Live-verified 2026-06-04.

## What it adds

| Capability | Models (this plan's quota) | Endpoint style |
|---|---|---|
| **Text / analysis** | `qwen3.7-max`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v3.2`, `glm-5.1`, `glm-5`, `MiniMax-M2.5`, `kimi-k2.6`, `kimi-k2.5` | OpenAI-compatible `POST {BASE}/chat/completions` |
| **Image** | `qwen-image-2.0`, `qwen-image-2.0-pro`, `wan2.7-image`, `wan2.7-image-pro` | native `POST {HOST}/api/v1/services/aigc/multimodal-generation/generation` (sync → OSS image URL) |
| **Video** | ❌ NOT in this plan's quota (every video model → `Model not exist`). Video stays on Veo/Grok. |

## Configuration (`.env` — never committed)

```
DASHSCOPE_API_KEY=sk-sp-...                 # the Token Plan key
DASHSCOPE_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
DASHSCOPE_TEXT_MODEL=qwen3.7-max            # default text model
DASHSCOPE_IMAGE_MODEL=qwen-image-2.0-pro    # default image model
DASHSCOPE_TIMEOUT_MS=120000
# Anthropic-compatible endpoint also available (unused): .../apps/anthropic
```

Defaults live in `server/src/config/env.ts`. The native image host is derived
from `DASHSCOPE_BASE_URL` (strip `/compatible-mode/v1`), override with
`DASHSCOPE_NATIVE_URL` if needed.

## How it's wired

- **Provider:** `server/src/services/providers/dashscope.provider.ts` — implements
  `text`, `analysis` (OpenAI SDK against the compatible endpoint, handles
  `reasoning_content` fallback for Qwen/DeepSeek thinking models), `image`/`imageEdit`
  (native multimodal-generation, returns `{url}`), and `video` (throws NotSupported).
- **Registration:** added `'dashscope'` to `AiProviderName` (`types.ts`) and to the
  `PROVIDERS` map (`ai-router.ts`).
- **Fallback chain** (`ai-router.ts` `orderedProviders` + `CHAIN`):
  - text/image/analysis: `gemini → xai → dashscope`
  - video: `gemini → xai` (no DashScope video)
  - A provider only enters the chain when its key is configured
    (`providerAvailable`), so a keyless provider can't break the chain.
  - `preferredPrimary` still overrides per-call (model picker / draft-video routing).
- **RAG / memory:** DashScope text/analysis flow through the SAME `routeCall` path,
  where the knowledge + memory enrichers mutate the prompt BEFORE provider
  selection — so DashScope generations are automatically grounded in the client's
  knowledge base + learned corrections. No DashScope-specific wiring needed.
- **Cost meter:** approximate per-M / per-image prices in `lib/ai-pricing.ts`
  (flagged to verify against the plan's unit billing — the plan bills fixed "units").

## Per-call model override (model picker)

`TextRequest.model` / `ImageRequest.model` (optional) override the default model
for a single call. The frontend model picker passes the chosen model through
`creativeApi`/`assistantApi` → routes → `aiRouter`. To force DashScope as the
primary for a call, set `meta.preferredPrimary = 'dashscope'` (or route by the
selected model's provider).

## Verification (live, real API)

```bash
# text (OpenAI-compatible)
curl -s "$DASHSCOPE_BASE_URL/chat/completions" -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.7-max","messages":[{"role":"user","content":"pong?"}],"max_tokens":10}'

# image (native multimodal-generation → OSS url)
curl -s "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"qwen-image-2.0-pro","input":{"messages":[{"role":"user","content":[{"text":"a red apple"}]}]}}'
```

Provider + router fallback were tested live 2026-06-04: text/json/model-override/image
all returned; the chain falls through to DashScope when Gemini+xAI are unavailable.

## Notes / follow-ups

- Image returns an **OSS URL** (expiring signed link) — persist to AuraAI storage if
  long-term retention is needed (Gemini image path already does this; mirror it for
  DashScope if image-gen is promoted from fallback to a user-selectable primary).
- Cost figures are approximate — reconcile against the plan's unit consumption.
- The Anthropic-compatible endpoint is available but unused (OpenAI-compatible is
  the integration path).
