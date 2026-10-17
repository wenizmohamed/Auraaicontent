import fs from 'fs';
import { embedText } from '../services/gemini.service.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { knowledgeService } from '../services/knowledge.service.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';

// ─── Text extraction ─────────────────────────────────────────────

// Who the file belongs to, so the AI read of a non-text file is metered.
interface ExtractContext {
  orgId: string;
  clientId?: string | null;
  title?: string | null;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
};
// Inline request ceiling for a multimodal read. base64 adds a third, and the
// provider caps the whole request at 20 MB.
const MAX_AI_READ_BYTES = 14 * 1024 * 1024;

type MediaKind = 'image' | 'audio' | 'video' | 'pdf';

function mediaKind(mimeType: string, absPath: string): { kind: MediaKind; mime: string } | null {
  const ext = (absPath.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
  const byExt = EXT_MIME[ext];
  if (mimeType.startsWith('image/') || IMAGE_EXT.test(absPath)) return { kind: 'image', mime: mimeType.startsWith('image/') ? mimeType : byExt };
  if (mimeType.startsWith('audio/') || AUDIO_EXT.test(absPath)) return { kind: 'audio', mime: mimeType.startsWith('audio/') ? mimeType : byExt };
  if (mimeType.startsWith('video/') || VIDEO_EXT.test(absPath)) return { kind: 'video', mime: mimeType.startsWith('video/') ? mimeType : byExt };
  return null;
}

const AI_READ_PROMPT: Record<MediaKind, string> = {
  image:
    'This image was uploaded to a brand knowledge base. Return JSON {"summary": string, "text": string}. ' +
    'summary: 3 to 6 sentences on what it shows and every brand signal in it (logo, colours, typography, layout, mood, product, people, setting). ' +
    'text: every word visible in the image, verbatim, in reading order, in its original language. Empty string if there is none.',
  audio:
    'This audio file was uploaded to a brand knowledge base. Return JSON {"summary": string, "text": string}. ' +
    'summary: 3 to 6 sentences on what it is and its key points. text: a faithful transcript of everything said, in its original language.',
  video:
    'This video was uploaded to a brand knowledge base. Return JSON {"summary": string, "text": string}. ' +
    'summary: what happens scene by scene, the visual style, and every brand signal. ' +
    'text: a faithful transcript of everything said plus any on-screen text, in its original language.',
  pdf:
    'This PDF has no readable text layer (it is scanned or image based). Return JSON {"summary": string, "text": string}. ' +
    'summary: 3 to 6 sentences on what the document is. text: all text in the document, verbatim, page by page, in its original language.',
};

// Read a non-text file with a multimodal model and turn it into searchable
// text. Goes through aiRouter so the call is metered and budget-gated like
// every other AI call. Images can fall back across providers; audio, video and
// PDF are pinned to Gemini, the only provider in the chain that accepts them.
async function readWithAi(absPath: string, kind: MediaKind, mime: string, ctx?: ExtractContext): Promise<string> {
  const size = fs.statSync(absPath).size;
  if (size > MAX_AI_READ_BYTES) {
    throw new Error(`This ${kind} file is too large to read (${Math.round(size / 1048576)} MB, the limit is 14 MB). Upload a smaller or shorter version.`);
  }
  const result = await aiRouter.analysis(
    { prompt: AI_READ_PROMPT[kind], imageBase64: fs.readFileSync(absPath).toString('base64'), mimeType: mime },
    {
      orgId: ctx?.orgId,
      clientId: ctx?.clientId ?? undefined,
      skipBrandKit: true, skipKnowledge: true, skipMemory: true,
      ...(kind === 'image' ? {} : { preferredProvider: 'gemini' as const }),
    },
  );
  const out = (result.output ?? {}) as { summary?: unknown; text?: unknown };
  const summary = typeof out.summary === 'string' ? out.summary.trim() : '';
  const body = typeof out.text === 'string' ? out.text.trim() : '';
  const label = kind === 'pdf' ? 'Scanned document' : kind.charAt(0).toUpperCase() + kind.slice(1);
  const parts = [`[${label}${ctx?.title ? `: ${ctx.title}` : ''}]`];
  if (summary) parts.push(summary);
  if (body) parts.push(`${kind === 'image' ? 'Text in the image' : kind === 'pdf' ? 'Document text' : 'Transcript'}:\n${body}`);
  if (parts.length === 1) throw new Error(`Could not read anything from this ${kind} file`);
  return parts.join('\n\n');
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

// PPTX is a zip of slide XML. SheetJS (already a dependency for spreadsheets)
// reads zip containers, so no extra package is needed.
async function extractPptx(absPath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const cfb = XLSX.CFB.read(fs.readFileSync(absPath), { type: 'buffer' });
  const entries = cfb.FullPaths
    .map((path: string, i: number) => ({ path, content: cfb.FileIndex[i]?.content }))
    .filter((e: { path: string; content: unknown }) => /ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(e.path) && e.content);
  const num = (p: string) => Number(p.match(/(\d+)\.xml$/)?.[1] || 0);
  const textOf = (content: unknown) => {
    const xml = Buffer.from(content as Uint8Array).toString('utf8');
    return [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).filter((t) => t.trim()).join(' ');
  };
  const slides = entries.filter((e: { path: string }) => /slides\/slide\d+\.xml$/.test(e.path)).sort((x: { path: string }, y: { path: string }) => num(x.path) - num(y.path));
  const notes = new Map<number, string>(entries.filter((e: { path: string }) => /notesSlide\d+\.xml$/.test(e.path)).map((e: { path: string; content: unknown }) => [num(e.path), textOf(e.content)]));
  const parts: string[] = [];
  for (const sl of slides) {
    const n = num(sl.path);
    const body = textOf(sl.content);
    const note = notes.get(n);
    if (body || note) parts.push(`# Slide ${n}\n${body}${note ? `\nNotes: ${note}` : ''}`);
  }
  return parts.join('\n\n').trim();
}

// Last resort for binary formats with no dedicated reader (legacy .doc, .ppt,
// .rtf with binary parts): pull out the runs of readable text, 8-bit and
// UTF-16. Accept the result only when it looks like real prose.
function extractReadableStrings(buf: Buffer): string {
  const runs: string[] = [];
  const latin = buf.toString('latin1').match(/[\x20-\x7E\u00A0-\u00FF]{6,}/g) || [];
  const wide = buf.toString('utf16le').match(/[\x20-\x7E\u00A0-\u024F\u0600-\u06FF]{6,}/g) || [];
  for (const r of [...wide, ...latin]) {
    const t = r.trim();
    if (t.length >= 6 && /[A-Za-z\u0600-\u06FF]{3,}\s+[A-Za-z\u0600-\u06FF]{2,}/.test(t)) runs.push(t);
  }
  return [...new Set(runs)].join('\n');
}

async function extractText(fileUrl: string, mimeType: string, ctx?: ExtractContext): Promise<string> {
  const absPath = storageService.getAbsolutePath(fileUrl);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  // Images, audio and video have no text to parse: a multimodal model reads
  // them (describe + OCR, or transcribe) so they become searchable knowledge.
  const media = mediaKind(mimeType || '', absPath);
  if (media) {
    // The model reads PNG, JPEG and WebP directly. Other image formats (GIF,
    // TIFF, BMP, AVIF) are converted to PNG first; formats nothing here can
    // open (PSD, AI, RAW) get a plain instruction instead of a provider 400.
    if (media.kind === 'image' && !/^image\/(png|jpe?g|webp)$/i.test(media.mime || '')) {
      const tmp = `${absPath}.read.png`;
      try {
        const sharp = (await import('sharp')).default;
        await sharp(absPath).png().toFile(tmp);
        return await readWithAi(tmp, 'image', 'image/png', ctx);
      } catch {
        throw new Error('This image format cannot be read. Export it as PNG, JPG or PDF and upload that.');
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return readWithAi(absPath, media.kind, media.mime, ctx);
  }

  // Plain text / markdown
  if (mimeType.includes('text/') || mimeType.includes('markdown')) {
    return fs.readFileSync(absPath, 'utf-8');
  }

  // PDF. pdf-parse v2 exports a PDFParse class; v1 exported a function. The
  // code called the v1 function, which no longer exists, so every PDF silently
  // fell back to "read the raw bytes as text" and was embedded as binary noise
  // (found 2026-10-10). Support both shapes.
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(absPath)) {
    try {
      const pdfModule: any = await import('pdf-parse');
      const buffer = fs.readFileSync(absPath);
      let data: { text?: string };
      if (typeof pdfModule.PDFParse === 'function') {
        const parser = new pdfModule.PDFParse({ data: buffer });
        try { data = await parser.getText(); } finally { await parser.destroy?.().catch(() => {}); }
      } else {
        const pdfParse = pdfModule.default || pdfModule;
        data = await pdfParse(buffer);
      }
      // v2 appends "-- 1 of N --" page markers; they are not content.
      const parsed = (data.text || '').replace(/^-- \d+ of \d+ --$/gm, '').trim();
      if (parsed.replace(/\s+/g, '').length >= 40) return parsed;
    } catch {
      // fall through to the AI read below
    }
    // No text layer (a scan or an image-only export): read it with the model
    // instead of embedding the raw PDF bytes as "text".
    return readWithAi(absPath, 'pdf', 'application/pdf', ctx);
  }

  // PPTX — slide text and speaker notes.
  if (mimeType.includes('presentationml') || /\.pptx$/i.test(absPath)) {
    const text = await extractPptx(absPath).catch(() => '');
    if (text) return text;
    throw new Error('This presentation has no readable text. Export it as PDF and upload that.');
  }

  // DOCX — use mammoth if available
  if (mimeType.includes('wordprocessingml') || mimeType.includes('docx')) {
    try {
      const mammoth = await import('mammoth');
      const buffer = fs.readFileSync(absPath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch {
      return fs.readFileSync(absPath, 'utf-8');
    }
  }

  // XLSX / XLS — SheetJS (Asya 2026-07-14). Flatten every sheet to labelled
  // rows so brand data in spreadsheets (product lists, tone matrices, plans)
  // becomes searchable RAG text. Match on mime OR extension (Windows sends
  // application/octet-stream for .xlsx sometimes).
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel') || /\.xlsx?$/i.test(absPath)) {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(fs.readFileSync(absPath), { type: 'buffer' });
      const parts: string[] = [];
      for (const name of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        if (csv.trim()) parts.push(`# Sheet: ${name}\n${csv}`);
      }
      const text = parts.join('\n\n').trim();
      if (text) return text;
      throw new Error('empty workbook');
    } catch {
      throw new Error('Unsupported or unreadable spreadsheet');
    }
  }

  // Fallback — but GUARD against silently embedding binary garbage (a renamed
  // .xls, an image, a zip). If the decoded text is mostly non-printable, fail
  // loudly instead of poisoning the client's RAG corpus with noise.
  const raw = fs.readFileSync(absPath, 'utf-8');
  const sample = raw.slice(0, 4000);
  const nonPrintable = (sample.match(/[�\x00-\x08\x0E-\x1F]/g) || []).length;
  if (sample.length > 0 && nonPrintable / sample.length > 0.1) {
    const salvaged = extractReadableStrings(fs.readFileSync(absPath));
    if (salvaged.length >= 200) return salvaged;
    throw new Error(`Could not read this file type (${mimeType || 'unknown'}). Save it as PDF, DOCX or TXT and upload that.`);
  }
  return raw;
}

// ─── Chunking ────────────────────────────────────────────────────

function chunkText(text: string, maxTokens: number = 800, overlap: number = 100): string[] {
  // Approximate: 1 token ≈ 4 chars
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;
  const chunks: string[] = [];

  // Split by paragraphs first for cleaner boundaries. A "paragraph" longer
  // than a chunk (minified HTML, CSV rows, one-line exports) is hard-sliced:
  // without this, Maxwax's HTML uploads became 18-20 chunks of 4.38 MB EACH
  // and brief_analyze crashed Prisma loading them (2026-10-17).
  const paragraphs = text
    .split(/\n\s*\n/)
    .filter(p => p.trim().length > 0)
    .flatMap(p => {
      if (p.length <= maxChars) return [p];
      const parts: string[] = [];
      for (let i = 0; i < p.length; i += maxChars - overlapChars) parts.push(p.slice(i, i + maxChars));
      return parts;
    });

  let buffer = '';
  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).length > maxChars && buffer.length > 0) {
      chunks.push(buffer.trim());
      // Overlap: keep tail of previous chunk
      buffer = buffer.slice(-overlapChars) + '\n\n' + para;
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para;
    }
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());

  return chunks;
}

// ─── Embed worker ────────────────────────────────────────────────

// Public entry point. Records the outcome on the item (metadata.embedded /
// chunks / readError) so the Knowledge page can show "ready" or "could not
// read" with the reason, instead of a file that silently never becomes usable.
export async function embedKnowledgeItem(orgId: string, knowledgeItemId: string): Promise<{ chunksCreated: number; embeddingsGenerated: number }> {
  const stamp = async (patch: Record<string, unknown>) => {
    try {
      const row = await db.knowledgeItem.findUnique({ where: { id: knowledgeItemId, orgId }, select: { metadata: true } });
      const prev = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
      await db.knowledgeItem.update({ where: { id: knowledgeItemId, orgId }, data: { metadata: { ...prev, ...patch } as any } });
    } catch { /* status is best-effort */ }
  };
  try {
    const result = await embedKnowledgeItemInner(orgId, knowledgeItemId);
    await stamp({ embedded: result.chunksCreated > 0, chunks: result.chunksCreated, readError: null, readAt: new Date().toISOString() });
    return result;
  } catch (err) {
    await stamp({ embedded: false, readError: (err instanceof Error ? err.message : String(err)).slice(0, 300), readAt: new Date().toISOString() });
    throw err;
  }
}

async function embedKnowledgeItemInner(orgId: string, knowledgeItemId: string): Promise<{ chunksCreated: number; embeddingsGenerated: number }> {
  const item = await knowledgeService.getById(orgId, knowledgeItemId);
  if (!item) throw new Error('Knowledge item not found');

  // 1. Extract text
  let text = item.textContent || '';
  if (!text && item.fileUrl) {
    text = await extractText(item.fileUrl, item.type, { orgId, clientId: item.clientId, title: item.title });
    // Save extracted text back to item
    await db.knowledgeItem.update({ where: { id: knowledgeItemId, orgId }, data: { textContent: text } });
  }
  if (!text.trim()) throw new Error('No text content to embed');

  // 2. Chunk
  const textChunks = chunkText(text);

  // 3. Delete existing chunks (re-embed)
  await db.knowledgeChunk.deleteMany({ where: { orgId, knowledgeItemId } });

  // 4. Embed each chunk and save
  let embeddingsGenerated = 0;
  for (let i = 0; i < textChunks.length; i++) {
    const chunkText = textChunks[i];
    try {
      const embedding = await embedText(chunkText, { orgId });
      await db.knowledgeChunk.create({
        data: {
          orgId,
          knowledgeItemId,
          chunkText,
          metadata: { embedding, chunkIndex: i, totalChunks: textChunks.length },
        },
      });
      embeddingsGenerated++;
    } catch (err) {
      // Save chunk without embedding on failure
      await db.knowledgeChunk.create({
        data: {
          orgId,
          knowledgeItemId,
          chunkText,
          metadata: { chunkIndex: i, totalChunks: textChunks.length, embeddingError: String(err) },
        },
      });
    }
  }

  return { chunksCreated: textChunks.length, embeddingsGenerated };
}
