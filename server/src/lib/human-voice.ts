// Human-voice rules for everything Radix writes.
//
// Weni, 2026-08-02: nothing the tool produces should read as "obviously AI".
// The single loudest tell is the em dash (—), which models reach for constantly
// and human social copy almost never uses. Corporate-AI vocabulary is the
// second. Two layers, because a prompt directive alone is not a guarantee:
//   1. HUMAN_VOICE_RULE  — told to the model up front.
//   2. deAiText()        — applied to the output, so it holds even when the
//                          model ignores the instruction.

export const HUMAN_VOICE_RULE =
  'Write like a sharp human, never like an AI. HARD RULE: never use em dashes or en dashes '
  + '(— –) anywhere in the output; use a full stop, comma, colon or brackets instead. '
  + 'Avoid AI-tell vocabulary and corporate filler ("unlock", "elevate", "seamless", "empower", '
  + '"leverage", "robust", "delve", "harness", "cutting-edge", "game-changer", "tapestry", '
  + '"testament to", "in today\'s fast-paced world", "dive in", "embark", "meticulous", '
  + '"stunning", "breathtaking"). Avoid the three-item rhythm ("faster, smarter, better") '
  + 'and hollow openers ("In a world where..."). Prefer concrete, specific, plain wording.';

// Continuation words: the clause after the dash belongs to the same sentence,
// so it gets a comma rather than a full stop.
const CONT = /^(?:including|includes|and\b|or\b|but\b|so\b|plus|with|without|not\b|never|always|up to|per\b|from|via|e\.?g\.?|i\.?e\.?|then|yet\b|while|once)/i;
const OPENERS = ['(', '[', '{', '"', "'", '`', ':', ';', ','];

/**
 * Replace em/en dashes with human punctuation. Idempotent and safe on any
 * string; leaves hyphens in words (well-known, image-to-video) untouched.
 */
export function deAiText(input: string): string {
  if (!input || (!input.includes('—') && !input.includes('–'))) return input;
  // A dash BETWEEN DIGITS is a numeric range, not a clause separator. Turn it
  // into a plain hyphen first, otherwise "delivered in 2-3 days" (typed with an
  // en dash) came out as "delivered in 2. 3 days".
  let t = input.replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1-');
  t = t.replace(/–/g, '—');
  let guard = 0;
  while (t.includes('—') && guard < 200) {
    guard++;
    const i = t.indexOf('—');
    let j = i;
    while (j > 0 && (t[j - 1] === ' ' || t[j - 1] === '\t')) j--;
    let k = i + 1;
    while (k < t.length && (t[k] === ' ' || t[k] === '\t')) k++;
    const before = t.slice(0, j);
    const after = t.slice(k);
    const bstrip = before.replace(/[ \t]+$/, '');
    if (!bstrip) {
      t = before + after;                       // leading dash: drop it
    } else if (OPENERS.includes(bstrip[bstrip.length - 1])) {
      // Dash right after an opening bracket takes no space ("(— note)" -> "(note)").
      // After a closing quote or a colon/semicolon/comma it MUST keep one, or
      // "Menu: — new items" collapsed to "Menu:new items".
      const tight = '([{'.includes(bstrip[bstrip.length - 1]);
      t = tight ? bstrip + after : `${bstrip} ${after}`;
    } else if (!after || after[0] === '\n') {
      t = bstrip + after;                       // trailing dash: drop it
    } else if (/[.?!…]$/.test(bstrip)) {
      // Already ends a sentence ("Ready? — tap the link") -> just space it.
      const nxt = /[a-z]/.test(after[0]) ? after[0].toUpperCase() + after.slice(1) : after;
      t = `${bstrip} ${nxt}`;
    } else if (CONT.test(after)) {
      t = `${bstrip}, ${after}`;
    } else if (/[a-z]/i.test(after[0])) {
      const keepCase = /^[a-z]\d/.test(after) || (after.length > 1 && after[1] === after[1].toUpperCase() && /[A-Za-z]/.test(after[1]));
      t = `${bstrip}. ${keepCase ? after : after[0].toUpperCase() + after.slice(1)}`;
    } else {
      t = `${bstrip}. ${after}`;
    }
  }
  return t.replace(/[ \t]{2,}/g, ' ');
}

/** Apply deAiText to every string in an object/array, in place-safe fashion. */
export function deAiDeep<T>(value: T): T {
  if (typeof value === 'string') return deAiText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deAiDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    // Only rebuild PLAIN objects. Rebuilding a class instance from its own
    // enumerable props destroys it: deAiDeep(new Date()) returned {}, which
    // would silently corrupt any payload carrying Date/Decimal/Buffer fields.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deAiDeep(v);
    return out as T;
  }
  return value;
}
