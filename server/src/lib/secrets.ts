/**
 * AES-256-GCM symmetric encryption for at-rest OAuth tokens.
 *
 * Key source: env var RADIX_INTEGRATION_KEY — 32 raw bytes, base64-encoded.
 * Generate with: openssl rand -base64 32
 *
 * Storage format: <iv-base64>:<ciphertext-base64>:<authTag-base64>
 * IV is 12 bytes, regenerated per encryption (never reused with the same key).
 *
 * Key rotation is NOT supported in this v1 implementation — if the key leaks,
 * every PlatformConnection token in the DB is unrecoverable until the user
 * reconsents. v2 should add a `keyVersion` column on PlatformConnection so
 * we can decrypt with old key + re-encrypt with new key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.RADIX_INTEGRATION_KEY;
  if (!raw) {
    throw new Error(
      'RADIX_INTEGRATION_KEY missing. Generate one with `openssl rand -base64 32` and add to server/.env'
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `RADIX_INTEGRATION_KEY must decode to exactly ${KEY_BYTES} bytes; got ${buf.length}. ` +
      `Regenerate with: openssl rand -base64 32`
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') throw new Error('encrypt: input must be string');
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  if (typeof ciphertext !== 'string') throw new Error('decrypt: input must be string');
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('decrypt: malformed ciphertext (expected iv:ct:tag)');
  const [ivB64, ctB64, tagB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Convenience for nullable refresh tokens. */
export function encryptOpt(plaintext: string | null | undefined): string | null {
  return plaintext ? encrypt(plaintext) : null;
}

export function decryptOpt(ciphertext: string | null | undefined): string | null {
  return ciphertext ? decrypt(ciphertext) : null;
}
