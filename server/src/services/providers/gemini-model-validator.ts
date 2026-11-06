/**
 * Boot-time + periodic Gemini model validator (RES-2).
 *
 * Why this exists: Google deprecates preview model IDs without warning
 * (incident 2026-05-27 — `gemini-3.1-flash-lite-preview` 404'd after
 * months in prod, killing the Research page). Hard-coding model strings
 * in env vars means the next deprecation silently rots a different
 * feature.
 *
 * What this does on boot:
 *   1. GET https://generativelanguage.googleapis.com/v1beta/models
 *   2. Compare every GEMINI_*_MODEL env var against the live list
 *   3. Log a loud WARN per dead model (does NOT crash — graceful degrade)
 *   4. Schedule a re-check every 24h so a model dying mid-uptime surfaces
 *
 * Mitigation: prefer the `-latest` aliases (gemini-flash-latest etc.)
 * which Google auto-rotates. The validator still runs to catch any
 * frozen model id that slipped into env.
 */
import { env } from '../../config/env.js';

const LIST_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Env vars to validate. Text models get a live generateContent test-call
// (presence in ListModels is necessary but NOT sufficient — Google leaves
// deprecated models in the catalog while 404'ing actual requests). Image
// and video models are listed-only (test-generating burns API credits).
const TRACKED_TEXT_VARS = [
  'GEMINI_TEXT_MODEL',
  'GEMINI_FLASH_TEXT_MODEL',
  'GEMINI_LITE_MODEL',
  'GEMINI_CHAT_MODEL',
  'GEMINI_ANALYSIS_MODEL',
];
const TRACKED_LISTED_VARS = [
  'GEMINI_IMAGE_MODEL',
  'GEMINI_IMAGE_FAST_MODEL',
  'GEMINI_IMAGE_ULTRA_MODEL',
  'GEMINI_IMAGE_EDIT_MODEL',
  'GEMINI_EMBEDDING_MODEL',
];

// Video ids are NOT listed by ListModels (Google hides Veo from the catalog
// even when it works), so a listing check flags every video model as dead.
// Probe them the same way as the text models: a 404 on the real endpoint is
// the only reliable death signal.
const TRACKED_VIDEO_VARS = [
  'GEMINI_VIDEO_MODEL',
  'GEMINI_VIDEO_FAST_MODEL',
];

interface LiveModel {
  name: string; // "models/gemini-pro-latest"
  displayName?: string;
  supportedGenerationMethods?: string[];
}

let started = false;

export function startGeminiModelValidator(): void {
  if (started) return;
  started = true;
  // Run once at boot (slight delay so we don't block server-listen).
  setTimeout(() => { void runValidation(); }, 5_000);
  // Re-check daily so a mid-uptime deprecation surfaces in logs.
  setInterval(() => { void runValidation(); }, RECHECK_INTERVAL_MS).unref();
}

export async function runValidation(): Promise<{ ok: string[]; dead: string[]; skipped: string[] }> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[model-validator] GEMINI_API_KEY missing — skipping');
    return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS, ...TRACKED_VIDEO_VARS] };
  }

  let liveSet: Set<string>;
  try {
    const res = await fetch(`${LIST_MODELS_URL}?key=${apiKey}&pageSize=200`);
    if (!res.ok) {
      console.warn(`[model-validator] ListModels HTTP ${res.status} — skipping (will retry next interval)`);
      return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS, ...TRACKED_VIDEO_VARS] };
    }
    const body = await res.json() as { models?: LiveModel[] };
    liveSet = new Set((body.models || []).map(m => m.name.replace(/^models\//, '')));
  } catch (err: any) {
    console.warn('[model-validator] ListModels failed:', err?.message?.slice(0, 120));
    return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS, ...TRACKED_VIDEO_VARS] };
  }

  const ok: string[] = [];
  const dead: string[] = [];
  const skipped: string[] = [];

  // 1) Text models: live test-call (catches the "in catalog but 404 on
  //    generate" case that bit the Research page on 2026-05-27).
  // Tested models are deduplicated since several env vars often share an id.
  const seen = new Map<string, { alive: boolean; status: number }>();
  for (const varName of TRACKED_TEXT_VARS) {
    const value = process.env[varName];
    if (!value) { skipped.push(varName); continue; }
    if (!seen.has(value)) {
      seen.set(value, await pingModel(apiKey, value));
    }
    const probe = seen.get(value)!;
    if (probe.alive) {
      ok.push(`${varName}=${value}`);
      // Transient billing/quota/rate-limit answer — say so plainly, but the
      // model is NOT dead. This is the 2026-11-05 false-alarm case.
      if (probe.status && probe.status !== 200) {
        console.warn(
          `[model-validator] ${varName}=${value} answered HTTP ${probe.status} (not a 404/410) — ` +
          `the model id is fine; this is a transient billing/quota/rate-limit response, not a dead model.`,
        );
      }
    } else {
      dead.push(`${varName}=${value}`);
      console.warn(`[model-validator] ⚠️  DEAD MODEL  ${varName}=${value} — generateContent returned ${probe.status}. Update .env. Auto-rolling aliases: gemini-pro-latest / gemini-flash-latest / gemini-flash-lite-latest.`);
    }
  }

  // 2) Video: Omni lives on the Interactions API, the Veo-style endpoint does
  //    not serve it. Probe Omni on its own path, any other id on the Veo path.
  for (const varName of TRACKED_VIDEO_VARS) {
    const value = process.env[varName];
    if (!value) { skipped.push(varName); continue; }
    if (!seen.has(value)) {
      const alive = /omni/i.test(value)
        ? await pingOmniModel(apiKey, value)
        : await pingVideoModel(apiKey, value);
      seen.set(value, { alive, status: alive ? 200 : 404 });
    }
    if (seen.get(value)!.alive) {
      ok.push(`${varName}=${value}`);
    } else {
      dead.push(`${varName}=${value}`);
      console.warn(`[model-validator] DEAD MODEL  ${varName}=${value} - video endpoint returned 404. Update .env.`);
    }
  }

  // 3) Image/embedding: listing-only check (test-calls cost real money).
  for (const varName of TRACKED_LISTED_VARS) {
    const value = process.env[varName];
    if (!value) { skipped.push(varName); continue; }
    if (liveSet.has(value)) {
      ok.push(`${varName}=${value}`);
    } else {
      dead.push(`${varName}=${value}`);
      console.warn(`[model-validator] ⚠️  DEAD MODEL  ${varName}=${value} — not in ListModels. Update .env.`);
    }
  }

  if (dead.length === 0) {
    console.log(`[model-validator] ✓ ${ok.length} configured Gemini models valid${skipped.length ? ` (${skipped.length} unset)` : ''}`);
  } else {
    console.warn(`[model-validator] ✗ ${dead.length} of ${ok.length + dead.length} configured Gemini models are DEAD. App will degrade via ladder fallback but should be fixed in .env.`);
  }

  return { ok, dead, skipped };
}

/** Probe Omni on the Interactions API. A request there starts a real render,
 *  so we only judge the HTTP status: 200 = alive, 404/410 = dead. */
async function pingOmniModel(apiKey: string, model: string): Promise<boolean> {
  const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: 'health check',
        response_format: { type: 'video', aspect_ratio: '16:9', delivery: 'uri' },
        generation_config: { video_config: { task: 'text_to_video' } },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404 || res.status === 410) return false;
    return true;
  } catch {
    return true; // network blip; retried on the next 24h cycle
  }
}

/** Probe a video model on its real endpoint. A job submission costs a real
 *  render, so we only look at the HTTP status: 404/410 = dead, anything else
 *  (200 accepted, 429, 5xx) = alive. */
async function pingVideoModel(apiKey: string, model: string): Promise<boolean> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predictLongRunning?key=${apiKey}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt: 'health check' }], parameters: { sampleCount: 1 } }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404 || res.status === 410) return false;
    return true;
  } catch {
    return true; // network blip; retried on the next 24h cycle
  }
}

/** Cheapest possible generateContent ping — 1-token reply, 5s timeout.
 *  Returns true if HTTP 200, false ONLY on 404/410 (the model id is gone).
 *  Soft-true on everything else so a transient outage doesn't falsely flag a
 *  healthy model.
 *
 *  Why only 404/410 (2026-11-05): the old code treated ANY 4xx except 429 as
 *  death. Google answers 402 Payment Required when the prepaid balance is
 *  drained, and 403 when a key hits a per-model quota — both are BILLING
 *  states, not model rot. Those transient windows marked 5 of 12 configured
 *  models "DEAD ... returned 404" (with a hardcoded 404 that was never the
 *  status actually seen) while every one of them answered 200 live. The
 *  validator is a deprecation detector; a deprecation is always 404/410. */
async function pingModel(apiKey: string, model: string): Promise<{ alive: boolean; status: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ok' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return { alive: true, status: res.status };
    // Only a missing/removed model id counts as dead.
    if (res.status === 404 || res.status === 410) return { alive: false, status: res.status };
    // Billing / quota / rate-limit / server errors = transient. Report the
    // real status so the log is truthful, but do NOT flag the model dead.
    return { alive: true, status: res.status };
  } catch {
    return { alive: true, status: 0 }; // network blip; retried on the next 24h cycle
  }
}
