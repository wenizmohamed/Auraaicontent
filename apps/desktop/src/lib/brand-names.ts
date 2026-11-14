// What the platform calls each engine on screen.
//
// Google's models carry AURA names everywhere a user can see them (Weni,
// 2026-11-14: "change anything that says gemini on the platform to aura").
// The vendor chip in the model picker still says Google, so nothing false is
// claimed. Internal ids never change: provider "gemini" and model strings such
// as "gemini-4-carbon" drive routing and the cost meter.

const MODEL_NAMES: Array<[RegExp, string]> = [
  [/gemini-4-(argon|carbon)/, 'AURA'],
  [/gemini-4-hydrogen|gemini-\d+(\.\d+)?-flash(-lite)?(?!-image)/, 'AURA Fast'],
  [/gemini-3-pro-image/, 'AURA Image Pro'],
  [/nano-banana|gemini-[\d.]+-flash(-lite)?-image/, 'AURA Image'],
  [/omni-1\.2/, 'AURA Omni 1.2 Flash'],
  [/omni-1\.1/, 'AURA Omni 1.1 Flash'],
  [/omni/, 'AURA Omni'],
  [/veo/, 'AURA Video'],
  [/^gemini/, 'AURA'],
];

/** Display name for a model id. Non-Google ids come back unchanged. */
export function brandModel(model?: string | null): string {
  const raw = (model || '').trim();
  const m = raw.replace(/^(google|models)\//i, '').toLowerCase();
  for (const [re, name] of MODEL_NAMES) if (re.test(m)) return name;
  return raw;
}

/** Display name for a provider id ("gemini" and "google" are AURA). */
export function brandProvider(provider?: string | null): string {
  const p = (provider || '').trim().toLowerCase();
  if (p === 'gemini' || p === 'google') return 'AURA';
  if (p === 'vertex') return 'AURA (Vertex)';
  return provider || '';
}

/** "provider/model" line for result captions, with Google engines branded. */
export function brandEngine(provider?: string | null, model?: string | null): string {
  const p = (provider || '').toLowerCase();
  if (p === 'gemini' || p === 'google' || p === 'vertex' || /^gemini|nano-banana|omni|veo/i.test(model || '')) {
    return model ? brandModel(model) : brandProvider(provider);
  }
  return model ? `${provider}/${model}` : (provider || '');
}
