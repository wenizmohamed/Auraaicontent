// Encryption roundtrip + tamper detection for OAuth tokens at rest.
// Without these tests, a change to the AES algorithm, IV length, or
// storage format would silently corrupt every PlatformConnection row in
// the DB irrecoverably (no key rotation in v1) — users would have to
// re-OAuth every connected account before scheduled publishes worked.
//
// Run:  npm test -- secrets.spec.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

const ORIG_KEY = process.env.RADIX_INTEGRATION_KEY;

beforeAll(() => {
  // Deterministic 32-byte key for the test run. Base64 of 32 bytes = 44 chars.
  process.env.RADIX_INTEGRATION_KEY = randomBytes(32).toString('base64');
});

afterAll(() => {
  if (ORIG_KEY === undefined) delete process.env.RADIX_INTEGRATION_KEY;
  else process.env.RADIX_INTEGRATION_KEY = ORIG_KEY;
});

describe('secrets — AES-256-GCM token encryption', () => {
  it('roundtrips ascii plaintext', async () => {
    const { encrypt, decrypt } = await import('../src/lib/secrets.js');
    const plain = 'EAAR1234567890abcdef-meta-long-lived-access-token';
    const ct = encrypt(plain);
    expect(ct.split(':')).toHaveLength(3);
    expect(decrypt(ct)).toBe(plain);
  });

  it('roundtrips unicode plaintext', async () => {
    const { encrypt, decrypt } = await import('../src/lib/secrets.js');
    const plain = 'مرحبا 👋 — token with emojis + arabic';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('produces a different ciphertext each call (IV per encryption)', async () => {
    const { encrypt } = await import('../src/lib/secrets.js');
    const plain = 'same-input';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(a.split(':')[0]).not.toBe(b.split(':')[0]); // IV must differ
  });

  it('rejects ciphertext with a tampered authTag', async () => {
    const { encrypt, decrypt } = await import('../src/lib/secrets.js');
    const ct = encrypt('legit-payload');
    const [iv, body, tag] = ct.split(':');
    // Flip one byte of the tag — GCM must refuse to authenticate.
    const tagBuf = Buffer.from(tag, 'base64');
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = `${iv}:${body}:${tagBuf.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects ciphertext with a tampered body', async () => {
    const { encrypt, decrypt } = await import('../src/lib/secrets.js');
    const ct = encrypt('legit-payload');
    const [iv, body, tag] = ct.split(':');
    const bodyBuf = Buffer.from(body, 'base64');
    bodyBuf[0] = bodyBuf[0] ^ 0xff;
    const tampered = `${iv}:${bodyBuf.toString('base64')}:${tag}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects malformed (wrong segment count) ciphertext', async () => {
    const { decrypt } = await import('../src/lib/secrets.js');
    expect(() => decrypt('not:enough')).toThrow(/malformed/i);
    expect(() => decrypt('too:many:parts:here')).toThrow(/malformed/i);
    expect(() => decrypt('')).toThrow(/malformed/i);
  });

  it('throws clearly when the key env var is missing', async () => {
    const { encrypt } = await import('../src/lib/secrets.js');
    const saved = process.env.RADIX_INTEGRATION_KEY;
    delete process.env.RADIX_INTEGRATION_KEY;
    try {
      expect(() => encrypt('x')).toThrow(/RADIX_INTEGRATION_KEY missing/);
    } finally {
      process.env.RADIX_INTEGRATION_KEY = saved;
    }
  });

  it('throws clearly when the key is the wrong length', async () => {
    const { encrypt } = await import('../src/lib/secrets.js');
    const saved = process.env.RADIX_INTEGRATION_KEY;
    process.env.RADIX_INTEGRATION_KEY = randomBytes(16).toString('base64'); // only 16 bytes
    try {
      expect(() => encrypt('x')).toThrow(/32 bytes/);
    } finally {
      process.env.RADIX_INTEGRATION_KEY = saved;
    }
  });

  it('encryptOpt/decryptOpt pass null through', async () => {
    const { encryptOpt, decryptOpt } = await import('../src/lib/secrets.js');
    expect(encryptOpt(null)).toBeNull();
    expect(encryptOpt(undefined)).toBeNull();
    expect(decryptOpt(null)).toBeNull();
    expect(decryptOpt(undefined)).toBeNull();
  });

  it('encryptOpt/decryptOpt roundtrip non-null values', async () => {
    const { encryptOpt, decryptOpt } = await import('../src/lib/secrets.js');
    const ct = encryptOpt('refresh_token_payload');
    expect(typeof ct).toBe('string');
    expect(decryptOpt(ct)).toBe('refresh_token_payload');
  });
});
