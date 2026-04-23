# Vertex AI Claude — config reference

As of 2026-04-23 Radix V2's primary orchestrator is **Grok 4.x via xAI** (`server/src/agent/loop.ts`). Direct Anthropic Claude was removed at Weni's direction. This doc captures the configuration needed to bring Claude back as a **secondary path through Google Cloud Vertex AI Model Garden** if redundancy or A/B testing is wanted later.

## Why Vertex (and not direct Anthropic)

- All billing rolls into the existing `radix-ai-tools` GCP project.
- One service-account credential covers Gemini + Claude.
- IAM controls per-region quotas + audit log already pipes to Stackdriver.
- Anthropic's first-party API is fine, but the team standardised on GCP.

## What is already configured

The VPS `.env` carries the Vertex creds today (set 2026-04-23, Weni-supplied):

```
GCP_PROJECT_ID=radix-ai-tools
VERTEX_REGION=us-east5
VERTEX_CLAUDE_MODEL=claude-opus-4-7
GCLOUD_ACCESS_TOKEN=<short-lived bearer minted by gcloud auth print-access-token>
```

`GCLOUD_ACCESS_TOKEN` is a short-lived OAuth token (~1h TTL). For production it should be replaced with a service-account JSON key path:

```
GOOGLE_APPLICATION_CREDENTIALS=/etc/radix/sa.json
```

The Anthropic Vertex SDK reads `GOOGLE_APPLICATION_CREDENTIALS` automatically.

## Wiring (when you decide to enable it)

### 1. Add the SDK

```bash
cd server
npm install @anthropic-ai/vertex-sdk
```

### 2. Provider helper

Create `server/src/services/providers/vertex-claude.provider.ts`:

```ts
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'radix-ai-tools';
const REGION = process.env.VERTEX_REGION || 'us-east5';
const MODEL = process.env.VERTEX_CLAUDE_MODEL || 'claude-opus-4-7';

let _client: AnthropicVertex | null = null;
export function getVertexClaude(): AnthropicVertex {
  if (!_client) {
    _client = new AnthropicVertex({
      projectId: PROJECT_ID,
      region: REGION,
    });
  }
  return _client;
}

export async function callVertexClaude(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxTokens = 2048,
): Promise<string> {
  const client = getVertexClaude();
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });
  return r.content
    .filter((b: { type: string }): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
```

### 3. Auth options

Pick ONE for the VPS:

| Mode | Setup | TTL | Suitable for |
|---|---|---|---|
| Service-account JSON | Mint key in Cloud Console → IAM → Service Accounts. Save to `/etc/radix/sa.json`, chmod 600. Set `GOOGLE_APPLICATION_CREDENTIALS=/etc/radix/sa.json` in `.env`. | permanent | production |
| Workload Identity | Bind GKE/Cloud Run service account → Vertex AI User role. No file. | permanent | k8s/cloud-run only |
| `GCLOUD_ACCESS_TOKEN` | `gcloud auth print-access-token` → paste into env. | ~1h | dev / smoke test |

The token Weni supplied (`AQ.Ab8RN6Lc-…`) is in mode 3. To use it without code changes, run the server with that env var; the Anthropic Vertex SDK falls back to `GoogleAuth` which will pick up `Authorization: Bearer ${GCLOUD_ACCESS_TOKEN}` if you patch `vertex-claude.provider.ts` to inject it manually:

```ts
const client = new AnthropicVertex({
  projectId: PROJECT_ID,
  region: REGION,
  // Manual token injection — only for short-lived dev tokens
  googleAuth: {
    getAccessToken: async () => process.env.GCLOUD_ACCESS_TOKEN,
  } as never,
});
```

### 4. Routing rule

Either:
- **Primary stays Grok**: only call Vertex Claude in retry-on-fail for assistant.ts:
  ```ts
  try { return await callGrok(system, messages); }
  catch { return await callVertexClaude(system, messages); }
  ```
- **A/B test**: route `?provider=claude` query param to Vertex, default to Grok.
- **Per-tool**: in agent/loop.ts, swap `MODEL` to `claude-opus-4-7` when input mentions "long-form" or "compliance heavy".

### 5. IAM roles required on the service account

- `roles/aiplatform.user` — Vertex AI User (lets you call models).
- `roles/serviceusage.serviceUsageConsumer` — quota.
- Optional: `roles/logging.logWriter` if you want SDK telemetry.

### 6. Smoke test command

After wiring:

```bash
node -e "import('./dist/services/providers/vertex-claude.provider.js').then(m => m.callVertexClaude('You are a smoke test.', [{role:'user',content:'Reply PONG and nothing else'}]).then(t => console.log('Vertex Claude:', t)))"
```

Expected output: `Vertex Claude: PONG` in 1–3 seconds.

## What to NOT do

- **Don't ship `GCLOUD_ACCESS_TOKEN`** to git or to long-lived production. It expires in an hour and the agent will silently start failing once it does.
- **Don't add Vertex Claude as a hidden default** in the agent loop. The orchestrator is Grok per Weni's 2026-04-23 directive — Vertex Claude is opt-in.
- **Don't conflate Vertex Claude with direct Anthropic Claude.** They use different SDKs (`@anthropic-ai/vertex-sdk` vs `@anthropic-ai/sdk`), different auth, different model naming (`claude-opus-4-7` vs `claude-opus-4-7-20251010`).
