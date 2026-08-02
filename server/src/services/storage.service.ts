import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Storage service — local filesystem for dev, S3-compatible interface for prod swap
// To switch to S3: replace saveFile/getFileUrl/deleteFile implementations

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const THUMB_DIR = path.resolve(UPLOAD_DIR, 'thumbs');

// Ensure dirs exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

// Extensions we are willing to put on disk under /uploads. The stored name is
// ALWAYS built from this allowlist — never from the uploader's filename, which
// is attacker-controlled. Serving an upload as text/html (or svg) on the app
// origin is stored XSS: it can read localStorage auth tokens = account
// takeover. nginx blocks those types too (defence in depth, 2026-08-02).
const SAFE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tiff',
  '.mp4', '.webm', '.mov', '.m4v',
  '.mp3', '.wav', '.m4a',
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.pptx',
  '.zip', '.bin',
]);

function safeExt(originalName: string, mimeType: string): string {
  const fromMime = mimeTypeToExt(mimeType);
  if (fromMime && fromMime !== '.bin' && SAFE_EXTS.has(fromMime)) return fromMime;
  // Fall back to the uploader's extension ONLY if it is explicitly allowlisted.
  const raw = path.extname(originalName || '').toLowerCase();
  if (SAFE_EXTS.has(raw)) return raw;
  return '.bin';
}

export const storageService = {
  async saveFile(buffer: Buffer, originalName: string, mimeType: string): Promise<{ fileUrl: string; thumbUrl: string | null }> {
    const ext = safeExt(originalName, mimeType);
    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `${hash}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    let thumbUrl: string | null = null;
    if (mimeType.startsWith('image/')) {
      try {
        const sharp = (await import('sharp')).default;
        const thumbFilename = `thumb_${filename}`;
        const thumbPath = path.join(THUMB_DIR, thumbFilename);
        await sharp(buffer).resize(400, 400, { fit: 'inside' }).toFile(thumbPath);
        thumbUrl = `/uploads/thumbs/${thumbFilename}`;
      } catch {
        // Sharp may fail on some formats — skip thumbnail
      }
    }

    return { fileUrl: `/uploads/${filename}`, thumbUrl };
  },

  async deleteFile(fileUrl: string): Promise<void> {
    const filePath = resolveUploadPath(fileUrl);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },

  getAbsolutePath(fileUrl: string): string {
    const p = resolveUploadPath(fileUrl);
    if (!p) throw Object.assign(new Error('Invalid upload path'), { statusCode: 400 });
    return p;
  },

  /** null when the url escapes the uploads dir — callers must treat as invalid. */
  resolveUploadPath,
};

// path.join(cwd, '/uploads/../../etc/passwd') silently escapes the uploads
// directory, so a "/uploads/"-prefixed string is NOT proof of containment.
// Resolve first, then assert the result is still inside UPLOAD_DIR.
function resolveUploadPath(fileUrl: string): string | null {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  const rel = fileUrl.replace(/^\/+/, '');
  if (!rel.startsWith('uploads/')) return null;
  const abs = path.resolve(process.cwd(), rel);
  const root = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  return abs === UPLOAD_DIR || abs.startsWith(root) ? abs : null;
}

function mimeTypeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'application/pdf': '.pdf', 'video/mp4': '.mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[mime] || '.bin';
}
