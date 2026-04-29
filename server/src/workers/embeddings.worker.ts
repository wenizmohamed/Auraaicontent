import fs from 'fs';
import { embedText } from '../services/gemini.service.js';
import { knowledgeService } from '../services/knowledge.service.js';
import { storageService } from '../services/storage.service.js';
import { db } from '../db/prisma.js';

// ─── Text extraction ─────────────────────────────────────────────

async function extractText(fileUrl: string, mimeType: string): Promise<string> {
  const absPath = storageService.getAbsolutePath(fileUrl);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  // Plain text / markdown
  if (mimeType.includes('text/') || mimeType.includes('markdown')) {
    return fs.readFileSync(absPath, 'utf-8');
  }

  // PDF — use pdf-parse if available, otherwise raw buffer toString
  if (mimeType === 'application/pdf') {
    try {
      const pdfModule = await import('pdf-parse');
      const pdfParse = (pdfModule as any).default || pdfModule;
      const buffer = fs.readFileSync(absPath);
      const data = await pdfParse(buffer);
      return data.text || '';
    } catch {
      return fs.readFileSync(absPath, 'utf-8'); // fallback
    }
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

  // Fallback
  return fs.readFileSync(absPath, 'utf-8');
}

// ─── Chunking ────────────────────────────────────────────────────

function chunkText(text: string, maxTokens: number = 800, overlap: number = 100): string[] {
  // Approximate: 1 token ≈ 4 chars
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;
  const chunks: string[] = [];

  // Split by paragraphs first for cleaner boundaries
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

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

export async function embedKnowledgeItem(orgId: string, knowledgeItemId: string): Promise<{ chunksCreated: number; embeddingsGenerated: number }> {
  const item = await knowledgeService.getById(orgId, knowledgeItemId);
  if (!item) throw new Error('Knowledge item not found');

  // 1. Extract text
  let text = item.textContent || '';
  if (!text && item.fileUrl) {
    text = await extractText(item.fileUrl, item.type);
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
      const embedding = await embedText(chunkText);
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
