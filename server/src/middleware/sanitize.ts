// Input sanitization for AI prompts — prevents prompt injection attacks.
// Strips dangerous patterns from user-provided text before it reaches AI providers.

// Patterns that could manipulate AI behavior
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above/gi,
  /you\s+are\s+now\s+(?:a|an|in)\s+/gi,
  /system\s*:\s*/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /\bDAN\b/g,
  /do\s+anything\s+now/gi,
  /jailbreak/gi,
  /bypass\s+(?:your|all|any)\s+(?:rules|filters|restrictions)/gi,
];

/**
 * Sanitize a user-provided prompt before sending to an AI provider.
 * Strips known injection patterns and normalizes whitespace.
 * Returns the cleaned text (never throws).
 */
export function sanitizePrompt(input: string): string {
  if (typeof input !== 'string') return '';
  let text = input;
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, '');
  }
  // Collapse excessive whitespace
  text = text.replace(/\s{3,}/g, '  ').trim();
  return text;
}

/**
 * Validate a prompt is non-empty and within reasonable length.
 * Returns { valid, error? }.
 */
export function validatePrompt(input: string, maxLength: number = 10000): { valid: boolean; error?: string } {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { valid: false, error: 'Prompt cannot be empty' };
  }
  if (input.length > maxLength) {
    return { valid: false, error: `Prompt exceeds maximum length (${maxLength} chars)` };
  }
  return { valid: true };
}
