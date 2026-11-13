// The primary org id was renamed on 2026-11-14. Tokens signed before the
// rename (up to 7 days old with "remember me") must keep working: verifyToken
// maps the old id onto the new one for both HTTP and Socket.IO auth.
// Delete this file together with RENAMED_ORG_IDS after 2026-11-21.

import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://test@127.0.0.1:1/test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
});

const { signToken, verifyToken } = await import('../src/middleware/auth.js');

describe('verifyToken across the org id rename', () => {
  it('maps a pre-rename token onto the new org id', () => {
    const t = signToken({ userId: 'u1', email: 'a@b.c', role: 'admin', orgId: 'org_radix_media', orgRole: 'OWNER' } as any);
    expect(verifyToken(t).orgId).toBe('org_auracontent');
  });

  it('leaves every other org id alone', () => {
    const t = signToken({ userId: 'u2', email: 'x@y.z', role: 'user', orgId: 'cmw6hlpdg008zkz93on6nkt36', orgRole: 'OWNER' } as any);
    expect(verifyToken(t).orgId).toBe('cmw6hlpdg008zkz93on6nkt36');
  });

  it('still rejects a token signed with another secret', () => {
    expect(() => verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.bad')).toThrow();
  });
});
