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
  'GEMINI_VIDEO_MODEL',
  'GEMINI_VIDEO_FAST_MODEL',
  'GEMINI_EMBEDDING_MODEL',
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
    return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS] };
  }

  let liveSet: Set<string>;
  try {
    const res = await fetch(`${LIST_MODELS_URL}?key=${apiKey}&pageSize=200`);
    if (!res.ok) {
      console.warn(`[model-validator] ListModels HTTP ${res.status} — skipping (will retry next interval)`);
      return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS] };
    }
    const body = await res.json() as { models?: LiveModel[] };
    liveSet = new Set((body.models || []).map(m => m.name.replace(/^models\//, '')));
  } catch (err: any) {
    console.warn('[model-validator] ListModels failed:', err?.message?.slice(0, 120));
    return { ok: [], dead: [], skipped: [...TRACKED_TEXT_VARS, ...TRACKED_LISTED_VARS] };
  }

  const ok: string[] = [];
  const dead: string[] = [];
  const skipped: string[] = [];

  // 1) Text models: live test-call (catches the "in catalog but 404 on
  //    generate" case that bit the Research page on 2026-05-27).
  // Tested models are deduplicated since several env vars often share an id.
  const seen = new Map<string, 'ok' | 'dead'>();
  for (const varName of TRACKED_TEXT_VARS) {
    const value = process.env[varName];
    if (!value) { skipped.push(varName); continue; }
    if (!seen.has(value)) {
      const alive = await pingModel(apiKey, value);
      seen.set(value, alive ? 'ok' : 'dead');
    }
    if (seen.get(value) === 'ok') {
      ok.push(`${varName}=${value}`);
    } else {
      dead.push(`${varName}=${value}`);
      console.warn(`[model-validator] ⚠️  DEAD MODEL  ${varName}=${value} — generateContent returned 404. Update .env. Auto-rolling aliases: gemini-pro-latest / gemini-flash-latest / gemini-flash-lite-latest.`);
    }
  }

  // 2) Image/video/embedding: listing-only check (test-calls cost real money).
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

/** Cheapest possible generateContent ping — 1-token reply, 5s timeout.
 *  Returns true if HTTP 200, false on 404/400/410. Soft-true on network
 *  errors / 5xx so a transient outage doesn't falsely flag a healthy model. */
async function pingModel(apiKey: string, model: string): Promise<boolean> {
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
    if (res.ok) return true;
    // 4xx other than 429 = real client problem; flag as dead so it surfaces.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return false;
    // 5xx / 429 = transient — soft-true to avoid false alarms.
    return true;
  } catch {
    return true; // network blip; the next 24h cycle will retry
  }
}
