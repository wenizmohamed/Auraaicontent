/**
 * HTML → readable text (2026-11-05).
 *
 * THE PROBLEM
 * -----------
 * `extractText` returned the RAW bytes of every uploaded `.html` file. That
 * put CSS, `<script>` bodies, inline styles and tag soup into the RAG corpus.
 * Measured on prod: 3,714 of 7,111 chunks (52%) were markup rather than
 * content. The damage was not just noise — a CSS chunk scored 0.551 against
 * the query "products and their features" and was INJECTED into the prompt,
 * while a real Mayaseen strategy document at 0.542 was rejected by the
 * threshold. The markup was outranking the content.
 *
 * It was also a prompt-injection surface: uploaded HTML could carry hidden
 * text aimed at the model, and raw `<script>` bodies reached the prompt
 * verbatim.
 *
 * WHAT THIS DOES
 * --------------
 * 1. Drops `<script>`, `<style>`, `<noscript>`, `<svg>` and `<iframe>`
 *    entirely (their contents are never prose).
 * 2. Drops comments and doctype declarations.
 * 3. Converts block-level tags to newlines so paragraphs survive.
 * 4. Strips every remaining tag and decodes the common HTML entities.
 * 5. Collapses whitespace.
 *
 * Plain-text, markdown, PDF, DOCX, XLSX and PPTX paths are untouched — this
 * is only for HTML-ish input.
 */

/** Tags whose CONTENT is never prose. Removed with their contents. */
const DROP_WITH_CONTENT = /<(script|style|noscript|svg|iframe|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** HTML comments (including conditional comments). */
const COMMENTS = /<!--[\s\S]*?-->/g;
/** The doctype / processing instructions. */
const DOCTYPE = /<![^>]*>/g;
/** Tags that imply a line break. */
const BLOCK_TAGS = /<\/?(p|div|br|hr|li|ul|ol|tr|td|th|table|thead|tbody|section|article|header|footer|nav|aside|main|h[1-6]|blockquote|pre|figure|figcaption|dl|dt|dd)\b[^>]*>/gi;
/** Any remaining tag. */
const ANY_TAG = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&#39;': "'", '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
  '&lsquo;': '‘', '&rsquo;': '’', '&ldquo;': '“', '&rdquo;': '”',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&euro;': '€',
  '&pound;': '£', '&deg;': '°', '&bull;': '•', '&middot;': '·',
};

/** Decode numeric (`&#39;`, `&#x27;`) and named HTML entities. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** True when the text looks like HTML rather than prose. */
export function looksLikeHtml(text: string): boolean {
  return /<\s*(html|head|body|div|p|span|a|meta|script|style|table)\b/i.test(text);
}

/**
 * Convert an HTML document to readable plain text.
 * Returns the input unchanged when there is nothing markup-like in it.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  let out = html;

  out = out.replace(DROP_WITH_CONTENT, ' ');
  out = out.replace(COMMENTS, ' ');
  out = out.replace(DOCTYPE, ' ');
  out = out.replace(BLOCK_TAGS, '\n');
  out = out.replace(ANY_TAG, ' ');
  out = decodeEntities(out);

  // Collapse: trim each line, drop the empty ones, squeeze the spaces.
  const lines = out
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(l => l.length > 0);
  return lines.join('\n').trim();
}

/**
 * Sanitise extracted text for embedding: if it looks like markup, convert it
 * to prose first. Applied to every uploaded file's text so a future HTML
 * upload can't poison the corpus again.
 */
export function sanitizeForEmbedding(text: string): string {
  if (!text) return '';
  if (!looksLikeHtml(text)) return text;
  const converted = htmlToText(text);
  // The conversion produced nothing usable (a page that is almost entirely
  // markup). Keep the original rather than storing an empty document — but
  // strip the markup anyway if any prose survived, since even one word of
  // prose is better than a page of CSS.
  if (converted.length >= 40) return converted;
  return converted.length > 0 ? converted : text;
}
