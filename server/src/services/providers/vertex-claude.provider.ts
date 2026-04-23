// Vertex AI Claude provider — Anthropic Claude served via GCP Vertex AI Model
// Garden.  Opt-in fallback (or A/B path) for the Grok orchestrator.  Wired
// but not invoked by default — see server/docs/vertex-claude.md for the
// routing decision.
//
// Two transports depending on auth mode:
//   1. ADC (GOOGLE_APPLICATION_CREDENTIALS / Workload Identity)
//      → AnthropicVertex SDK from @anthropic-ai/vertex-sdk
//   2. Short-lived bearer (GCLOUD_ACCESS_TOKEN, dev only)
//      → direct REST against Vertex AI streamRawPredict.  Avoids the SDK's
//        GoogleAuth requirement which can't be satisfied with a raw token.

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'radix-ai-tools';
const REGION = process.env.VERTEX_REGION || 'us-east5';
const MODEL = process.env.VERTEX_CLAUDE_MODEL || 'claude-opus-4-7';
const ANTHROPIC_VERTEX_VERSION = 'vertex-2023-10-16';

export interface VertexClaudeStatus {
  configured: boolean;
  authMode: 'sa-json' | 'access-token' | 'workload-identity' | 'none';
  projectId: string;
  region: string;
  model: string;
}

export function vertexClaudeStatus(): VertexClaudeStatus {
  let mode: VertexClaudeStatus['authMode'] = 'none';
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) mode = 'sa-json';
  else if (process.env.GCLOUD_ACCESS_TOKEN) mode = 'access-token';
  else if (process.env.K_SERVICE || process.env.KUBERNETES_SERVICE_HOST)
    mode = 'workload-identity';
  return {
    configured: mode !== 'none',
    authMode: mode,
    projectId: PROJECT_ID,
    region: REGION,
    model: MODEL,
  };
}

let _sdkClient: AnthropicVertex | null = null;
function getSdkClient(): AnthropicVertex {
  if (!_sdkClient) {
    _sdkClient = new AnthropicVertex({
      projectId: PROJECT_ID,
      region: REGION,
    });
  }
  return _sdkClient;
}

interface VertexMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function callVertexViaToken(
  system: string,
  messages: VertexMessage[],
  maxTokens: number,
): Promise<string> {
  const token = process.env.GCLOUD_ACCESS_TOKEN;
  if (!token) throw new Error('GCLOUD_ACCESS_TOKEN not set');
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/anthropic/models/${MODEL}:rawPredict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      anthropic_version: ANTHROPIC_VERTEX_VERSION,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Vertex ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

export async function callVertexClaude(
  system: string,
  messages: VertexMessage[],
  maxTokens = 2048,
): Promise<string> {
  const status = vertexClaudeStatus();
  if (!status.configured) {
    throw new Error('Vertex Claude not configured — need GOOGLE_APPLICATION_CREDENTIALS or GCLOUD_ACCESS_TOKEN');
  }
  const start = Date.now();
  let text: string;
  if (status.authMode === 'access-token') {
    text = await callVertexViaToken(system, messages, maxTokens);
  } else {
    const r = await getSdkClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
  }
  const latency = Date.now() - start;
  console.log(`[vertex-claude] ${MODEL} (${status.authMode}) ${latency}ms, ${text.length} chars`);
  return text;
}
