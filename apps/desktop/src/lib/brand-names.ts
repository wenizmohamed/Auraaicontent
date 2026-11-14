// What the platform calls each engine on screen.
//
// AURA is the orchestrator: it plans the work, picks the engine, writes the
// prompt and checks the result. It is never the name of an engine. Engines
// carry their makers' product names, and the word "Gemini" is not shown
// (Weni, 2026-11-14): Google's models appear as Nano Banana, Omni, Veo or
// Google <variant>. Internal ids never change: provider "gemini" and model
// strings such as "gemini-4-carbon" drive routing and the cost meter.

const MODEL_NAMES: Array<[RegExp, string]> = [
  [/gemini-4-argon/, 'Google Argon'],
  [/gemini-4-carbon/, 'Google Carbon'],
  [/gemini-4-hydrogen/, 'Google Hydrogen'],
  [/gemini-3-pro-image/, 'Nano Banana Pro'],
  [/nano-banana-2\.1/, 'Nano Banana 2.1'],
  [/nano-banana|gemini-[\d.]+-flash(-lite)?-image/, 'Nano Banana'],
  [/gemini-\d+(\.\d+)?-flash(-lite)?/, 'Google Flash'],
  [/omni-1\.2/, 'Omni 1.2 Flash'],
  [/omni-1\.1/, 'Omni 1.1 Flash'],
  [/omni/, 'Omni'],
  [/veo/, 'Veo'],
  [/embedding/, 'Google embeddings'],
  [/^gemini/, 'Google'],
];

/** Display name for a model id. Non-Google ids come back unchanged. */
export function brandModel(model?: string | null): string {
  const raw = (model || '').trim();
  const m = raw.replace(/^(google|models)\//i, '').toLowerCase();
  for (const [re, name] of MODEL_NAMES) if (re.test(m)) return name;
  return raw;
}

/** Display name for a provider id: Google's endpoints show as Google. */
export function brandProvider(provider?: string | null): string {
  const p = (provider || '').trim().toLowerCase();
  if (p === 'gemini' || p === 'google') return 'Google';
  if (p === 'vertex') return 'Google (Vertex)';
  return provider || '';
}

/** "provider/model" line for result captions, with Google's engines named. */
export function brandEngine(provider?: string | null, model?: string | null): string {
  const p = (provider || '').toLowerCase();
  if (p === 'gemini' || p === 'google' || p === 'vertex' || /^gemini|nano-banana|omni|veo/i.test(model || '')) {
    return model ? brandModel(model) : brandProvider(provider);
  }
  return model ? `${provider}/${model}` : (provider || '');
}
