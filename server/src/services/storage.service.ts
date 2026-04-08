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

export const storageService = {
  async saveFile(buffer: Buffer, originalName: string, mimeType: string): Promise<{ fileUrl: string; thumbUrl: string | null }> {
    const ext = path.extname(originalName) || mimeTypeToExt(mimeType);
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
    const filePath = path.join(process.cwd(), fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },

  getAbsolutePath(fileUrl: string): string {
    return path.join(process.cwd(), fileUrl);
  },
};

function mimeTypeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'application/pdf': '.pdf', 'video/mp4': '.mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[mime] || '.bin';
}
