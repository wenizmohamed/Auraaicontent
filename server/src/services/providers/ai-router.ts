import { xaiProvider } from './xai.provider.js';
import { geminiProvider } from './gemini.provider.js';
import { dashscopeProvider } from './dashscope.provider.js';
import { isRetryableAiError, isSafetyBlock, AllProvidersFailedError, type ProviderFailure } from './errors.js';
import { filterAvailable, recordSuccess, recordFailure, getCircuitSnapshot } from './circuit-breaker.js';
import type { AiProvider, AiProviderName, AiTask, AiTelemetryEntry, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';
import { db } from '../../db/prisma.js';
import { computeCostUsd, isPriced } from '../../lib/ai-pricing.js';
import { assertOrgBudget } from '../../lib/budget.js';
import { enrichWithBrandKit } from '../../lib/brand-kit-enricher.js';
import { enrichWithKnowledge } from '../../lib/knowledge-enricher.js';
import { enrichWithMemory } from '../../lib/memory-enricher.js';

// Public meta shape passed to every aiRouter.* call.  clientId triggers the
// BrandKit enricher; skipBrandKit bypasses it for debug/testing; platform
// picks the voice-per-platform sample inside the enricher.  Kept in one
// place so adding a new meta field doesn't have to touch every method.
export type AiRouterMeta = {
  jobId?: string;
  clientId?: string;
  orgId?: string;
  userId?: string;
  skipBrandKit?: boolean;
  skipKnowledge?: boolean;
  skipMemory?: boolean;
  platform?: string;
  // Model picker: force a specific provider first for this call (the rest of
  // the task's chain still follows as fallback). Pairs with req.model.
  preferredProvider?: AiProviderName;
};

// Map task → UsageEvent.kind. Image edits bill the same as image gens.
function usageKind(task: AiTask): string {
  if (task === 'image' || task === 'image_edit') return 'ai.image';
  if (task === 'video') return 'ai.video';
  if (task === 'analysis') return 'ai.analysis';
  return 'ai.text';
}

// Persist a usage row for billing + admin dashboard. Fire-and-forget so
// AI latency isn't blocked on DB writes; orgId is required, so calls
// without it (legacy paths still being scoped) are skipped — they show
// in the in-memory telemetry buffer but don't bill.
//
// durationSeconds is required for accurate video billing — Veo and
// grok-imagine-video price per second, not per call. If the provider
// doesn't return clip length, computeCostUsd falls back to the 8s
// default (matches our default VideoRequest.durationSeconds).
function persistUsage(meta: { orgId?: string; userId?: string; clientId?: string; jobId?: string },
                       task: AiTask, model: string, provider: string,
                       tokens: { p?: number; c?: number; t?: number },
                       extras?: { durationSeconds?: number }) {
  if (!meta.orgId) {
    // B5: surface untracked usage so future regressions (a route that forgets to
    // thread orgId) are visible instead of silently un-billed. Keep the early
    // return — we still can't write a UsageEvent without an org.
    console.warn(`[ai-router] usage NOT tracked — missing orgId for task=${task}`, model);
    return;
  }
  const cost = computeCostUsd(model, tokens.p, tokens.c, 1, extras?.durationSeconds);
  const priced = isPriced(model);  // Phase 1: distinguish a real $0 from "cost unknown".
  const kind = usageKind(task);
  void db.usageEvent.create({
    data: {
      orgId: meta.orgId,
      userId: meta.userId ?? null,
      kind,
      units: tokens.t ?? 0,
      costUsd: cost,
      ref: meta.jobId ?? meta.clientId ?? null,
      metadata: {
        model, task, provider, priced,
        promptTokens: tokens.p,
        completionTokens: tokens.c,
        ...(priced ? {} : { unpricedModel: model }),
        ...(extras?.durationSeconds ? { durationSeconds: extras.durationSeconds } : {}),
      },
    },
  }).catch((err: any) => {
    // Don't crash on usage-write failures; cost reporting is best-effort.
    console.warn('[ai-router] usage persist failed:', err?.message || err);
  });
}

// ─── Routing config from env ─────────────────────────────────────
// Weni 2026-04-23: Gemini 3.1 Pro is PRIMARY across the board because the
// API key bills to the Radix company card.  Grok is the fallback.  (Kimi
// isn't in the AiProvider abstraction yet — text fallback to Kimi happens
// at the higher-level chatText/chatStream helper in services/llm/chat.ts.)
const PRIMARY: Record<string, AiProviderName> = {
  text: (process.env.AI_TEXT_PRIMARY as AiProviderName) || 'gemini',
  image: (process.env.AI_IMAGE_PRIMARY as AiProviderName) || 'gemini',
  video: (process.env.AI_VIDEO_PRIMARY as AiProviderName) || 'gemini',
  analysis: (process.env.AI_ANALYSIS_PRIMARY as AiProviderName) || 'gemini',
};

const FALLBACK_ENABLED = process.env.AI_ENABLE_FALLBACK !== 'false';

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  xai: xaiProvider,
  gemini: geminiProvider,
  dashscope: dashscopeProvider,
};

// Per-task fallback chain (order = preference). DashScope joins text/image/
// analysis as an extra fallback (it has no video on the current plan). Gemini
// stays primary by default via the PRIMARY env map; this only adds resilience —
// a request only reaches DashScope if the providers before it fail.
const CHAIN: Record<string, AiProviderName[]> = {
  // xai text is billing-dead (403 credits exhausted) as of 2026-07 — keep it in
  // the chain (harmless once topped up) but AFTER dashscope so a gemini miss
  // falls straight to a WORKING provider instead of wasting a hop on the dead one.
  text: ['gemini', 'dashscope', 'xai'],
  image: ['gemini', 'xai', 'dashscope'],
  // image_edit SKIPS xai: xAI's /images/edits returns 403 permission-denied for
  // this team, and 403 is non-retryable → it used to HALT the ladder before
  // DashScope (Qwen edit), so edits failed whenever Gemini was capped/down.
  // gemini → dashscope only; both can actually edit. (2026-07-06 T0#3 fix.)
  image_edit: ['gemini', 'dashscope'],
  analysis: ['gemini', 'xai', 'dashscope'],
  video: ['gemini', 'xai', 'dashscope'],  // dashscope = Wan t2v (text-only; 503s image-conditioned)
};

// A provider is usable only when its credential is configured — keeps a
// keyless DashScope (or xAI) out of the chain so it can't throw a
// non-retryable "key not set" and break the fallback.
function providerAvailable(name: AiProviderName): boolean {
  switch (name) {
    case 'dashscope': return !!process.env.DASHSCOPE_API_KEY;
    case 'xai': return !!process.env.XAI_API_KEY;
    case 'gemini': return !!process.env.GEMINI_API_KEY;
    default: return false;
  }
}

// preferredPrimary forces a per-call primary (e.g. draft text→video → 'xai' so
// cheap Grok runs first, or a model-picker choice), overriding the env default
// for THIS call only. The rest of the task's CHAIN follows as fallbacks.
function orderedProviders(task: string, preferredPrimary?: AiProviderName): AiProvider[] {
  const normalizedTask = task === 'image_edit' ? 'image' : task;
  // Prefer a task-specific chain (image_edit has its own that skips xai);
  // fall back to the normalized-task chain for everything else.
  const base = CHAIN[task] || CHAIN[normalizedTask] || ['gemini', 'xai'];
  const primary = preferredPrimary || PRIMARY[normalizedTask] || 'gemini';
  // primary first, then the rest of the chain (deduped), filtered to available.
  const ordered = [primary, ...base.filter((p) => p !== primary)].filter(providerAvailable);
  const names = FALLBACK_ENABLED ? ordered : ordered.slice(0, 1);
  const list = names.map((n) => PROVIDERS[n]).filter(Boolean);
  // Never return empty — fall back to the primary (or gemini) even if the
  // availability check is wrong, so the call attempts rather than 500s here.
  return list.length ? list : [PROVIDERS[primary] || PROVIDERS.gemini];
}

// ─── Telemetry ring buffer ───────────────────────────────────────
const telemetryBuf: (AiTelemetryEntry | null)[] = new Array(500).fill(null);
let telemetryHead = 0;
let telemetrySize = 0;
const MAX_LOG = telemetryBuf.length;

function logTelemetry(entry: AiTelemetryEntry) {
  telemetryBuf[telemetryHead] = entry;
  telemetryHead = (telemetryHead + 1) % MAX_LOG;
  if (telemetrySize < MAX_LOG) telemetrySize++;
  const fb = entry.fallbackUsed ? ' [FALLBACK]' : '';
  const err = entry.errorType ? ` err=${entry.errorType}` : '';
  const tok = entry.totalTokens ? ` [${entry.promptTokens ?? '?'}→${entry.completionTokens ?? '?'} tok]` : '';
  console.log(`[AI] ${entry.task} ${entry.provider}/${entry.model} ${entry.latencyMs}ms${tok}${fb}${err}`);
}

export function getAiTelemetry(): AiTelemetryEntry[] {
  const result: AiTelemetryEntry[] = [];
  const start = telemetrySize < MAX_LOG ? 0 : telemetryHead;
  for (let i = 0; i < telemetrySize; i++) {
    const entry = telemetryBuf[(start + i) % MAX_LOG];
    if (entry) result.push(entry);
  }
  return result;
}

// ─── Router ──────────────────────────────────────────────────────
async function routeCall<T>(
  task: AiTask,
  fn: (provider: AiProvider) => Promise<ProviderResult<T>>,
  meta?: AiRouterMeta,
  req?: any,
  extras?: { durationSeconds?: number },
): Promise<ProviderResult<T>> {
  // Spend gate: refuse the call if the org has hit its monthly AI budget.
  // No-op when meta.orgId is missing (legacy callers) or the org's budget
  // is 0 (the default — means "no enforcement"). Throws OrgBudgetExceededError
  // (statusCode 402) which the route handlers serialize as JSON.
  await assertOrgBudget(meta?.orgId);

  // BrandKit enrichment (F3) — single point of injection BEFORE provider
  // selection so every task type + every fallback sees the same enriched
  // prompt.  No-op when no clientId, skipBrandKit=true, or no BrandKit row
  // exists for the client.  Mutates req.prompt in place so the closure
  // captured by `fn` sees the enriched value.
  if (req && meta?.clientId && req.prompt) {
    // Retrieve Knowledge + Memory using the ORIGINAL prompt (captured before any
    // block is prepended, which would skew the query embedding). Gated to
    // text/analysis — neither helps image/video prompts. Both best-effort: no-op
    // when the client has no knowledge / the org has no learnings / embeddings
    // are absent. Memory (learned corrections) is prepended LAST so it sits at
    // the top, closest to the model's attention.
    if (meta?.orgId && (task === 'text' || task === 'analysis')) {
      const originalPrompt = req.prompt;
      req.prompt = await enrichWithKnowledge(req.prompt, meta.orgId, meta.clientId, originalPrompt, {
        skip: meta?.skipKnowledge,
      });
      req.prompt = await enrichWithMemory(req.prompt, meta.orgId, meta.clientId, originalPrompt, {
        skip: meta?.skipMemory,
      });
    }
    req.prompt = await enrichWithBrandKit(req.prompt, meta.clientId, {
      skip: meta?.skipBrandKit,
      platform: meta?.platform as any,
    });
  }

  // Per-call provider-order override: a draft TEXT→video forces Grok (xai)
  // first since it's ~10× cheaper than Veo. HD / undefined tier keeps the env
  // default order. Only applies to video — text/image/analysis pass undefined.
  //
  // IMPORTANT (2026-06-04 fix): image-conditioned video (a source/start/end
  // frame attached) must NOT be forced to Grok. Grok's /videos/generations
  // takes the frame as a `reference_images` *style hint* (prompt-dominated), so
  // it invents a DIFFERENT subject than the uploaded product. Veo attaches the
  // frame as the actual first/last frame. So any image→video request keeps the
  // env default order (Veo-primary) regardless of tier — correctness over the
  // draft cost saving. Pure text→video drafts still go to cheap Grok.
  // Asset reference images (Veo 'ingredients to video') count as image-
  // conditioned too — Grok has no equivalent, so refs must land on Veo.
  const imageConditioned = !!(req?.imageBase64 || req?.startImageBase64 || req?.endImageBase64 || (req?.referenceImages && req.referenceImages.length));
  // Model-picker override wins: a user-chosen provider runs first for this call.
  // Otherwise the draft text→video rule applies; else the env default order.
  const preferredPrimary: AiProviderName | undefined =
    meta?.preferredProvider
    || (task === 'video' && req?.tier === 'draft' && !imageConditioned ? 'xai' : undefined);

  // Circuit breaker: drop providers whose breaker is open so an ongoing outage
  // doesn't tax every request with a full timeout before falling through.
  // filterAvailable guarantees ≥1 provider even if every breaker is open.
  const providers = filterAvailable(orderedProviders(task, preferredPrimary), task);
  const failures: ProviderFailure[] = [];
  let fallbackUsed = false;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (i > 0) fallbackUsed = true;
    try {
      const result = await fn(provider);
      result.fallbackUsed = fallbackUsed;
      recordSuccess(provider.name, task);
      logTelemetry({
        provider: result.provider, model: result.model, task,
        latencyMs: result.latencyMs, fallbackUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        jobId: meta?.jobId, clientId: meta?.clientId, orgId: meta?.orgId,
        // Surface draft-vs-hd routing in ai-stats (video only).
        ...(task === 'video' && req?.tier ? { tier: req.tier } : {}),
        timestamp: new Date().toISOString(),
      });
      persistUsage(
        meta ?? {},
        task,
        result.model,
        result.provider,
        { p: result.promptTokens, c: result.completionTokens, t: result.totalTokens },
        extras,
      );
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableAiError(err);
      // Only retryable failures (outage/timeout/5xx) count toward tripping the
      // breaker. A 400/401 is a bad request, not the provider being down — and
      // a safety/content block is a property of the PROMPT, not provider health
      // (it's retryable so the request still falls through to a provider with a
      // different policy, but it must never trip the breaker). The breaker is
      // now keyed per (provider, task) so a flaky video task can't stall text.
      if (retryable && !isSafetyBlock(errMsg)) recordFailure(provider.name, task, errMsg);
      failures.push({ provider: provider.name, message: errMsg.slice(0, 200), retryable });
      logTelemetry({
        provider: provider.name, model: 'unknown', task,
        latencyMs: 0, fallbackUsed,
        errorType: errMsg.slice(0, 80),
        jobId: meta?.jobId, clientId: meta?.clientId, orgId: meta?.orgId,
        ...(task === 'video' && req?.tier ? { tier: req.tier } : {}),
        timestamp: new Date().toISOString(),
      });

      if (!retryable || !FALLBACK_ENABLED) break;
      console.warn(`[AI] ${provider.name} ${task} failed (retryable), trying fallback: ${errMsg.slice(0, 80)}`);
    }
  }
  throw new AllProvidersFailedError(task, failures);
}

// ─── Public API ──────────────────────────────────────────────────
export const aiRouter = {
  async text(req: TextRequest, meta?: AiRouterMeta): Promise<ProviderResult<string | object>> {
    return routeCall('text', p => p.text(req), meta, req);
  },

  async image(req: ImageRequest, meta?: AiRouterMeta): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    return routeCall(req.imageBase64 ? 'image_edit' : 'image', p => req.imageBase64 ? p.imageEdit(req) : p.image(req), meta, req);
  },

  async video(req: VideoRequest, meta?: AiRouterMeta): Promise<ProviderResult<{ url: string }>> {
    // Image-to-video prefers Gemini (native imageBase64 support), but falls
    // back to xAI via the normal routeCall chain when Gemini is unavailable.
    // xAI receives the base64 as a data-URL in referenceImageUrls.
    //
    // durationSeconds is forwarded to persistUsage so per-second video billing
    // (veo-3.1, grok-imagine-video) reflects the actual clip length. Defaults
    // to 8s when the caller doesn't specify — matches the provider default.
    return routeCall('video', p => p.video(req), meta, req, { durationSeconds: req.durationSeconds });
  },

  async analysis(req: AnalysisRequest, meta?: AiRouterMeta): Promise<ProviderResult<object>> {
    return routeCall('analysis', p => p.analysis(req), meta, req);
  },
};
