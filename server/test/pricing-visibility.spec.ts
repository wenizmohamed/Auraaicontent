// Tests for who may see money in the product.
//
// canSeePricing(email, orgRole): OWNER/ADMIN always qualify by role;
// anyone listed in ACCOUNTING_EMAILS or STAFF_EMAILS qualifies by email
// regardless of role; everyone else is denied.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canSeePricing } from '../src/lib/pricing-visibility.js';

const ENV_KEYS = ['ACCOUNTING_EMAILS', 'STAFF_EMAILS'] as const;

describe('canSeePricing', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('role-based access', () => {
    it('allows OWNER regardless of email', () => {
      expect(canSeePricing('anyone@anywhere.com', 'OWNER')).toBe(true);
      expect(canSeePricing(undefined, 'OWNER')).toBe(true);
      expect(canSeePricing('', 'OWNER')).toBe(true);
    });

    it('allows ADMIN regardless of email', () => {
      expect(canSeePricing('anyone@anywhere.com', 'ADMIN')).toBe(true);
      expect(canSeePricing(null, 'ADMIN')).toBe(true);
    });

    it('matches roles case-insensitively (lowercase owner/admin)', () => {
      expect(canSeePricing('x@y.com', 'owner')).toBe(true);
      expect(canSeePricing('x@y.com', 'admin')).toBe(true);
      expect(canSeePricing('x@y.com', 'Owner')).toBe(true);
      expect(canSeePricing('x@y.com', 'Admin')).toBe(true);
    });

    it('denies EDITOR when email is not allowlisted', () => {
      expect(canSeePricing('editor@auracontent.com', 'EDITOR')).toBe(false);
    });

    it('denies VIEWER when email is not allowlisted', () => {
      expect(canSeePricing('viewer@auracontent.com', 'VIEWER')).toBe(false);
    });

    it('denies unknown or lowercase non-privileged roles', () => {
      expect(canSeePricing('x@y.com', 'editor')).toBe(false);
      expect(canSeePricing('x@y.com', 'MEMBER')).toBe(false);
      expect(canSeePricing('x@y.com', 'nonsense')).toBe(false);
    });
  });

  describe('ACCOUNTING_EMAILS allowlist', () => {
    it('allows any role when email is in ACCOUNTING_EMAILS', () => {
      process.env.ACCOUNTING_EMAILS = 'money@auracontent.com,books@auracontent.com';
      expect(canSeePricing('money@auracontent.com', 'EDITOR')).toBe(true);
      expect(canSeePricing('books@auracontent.com', 'VIEWER')).toBe(true);
      expect(canSeePricing('money@auracontent.com', undefined)).toBe(true);
    });

    it('still denies emails not on the list', () => {
      process.env.ACCOUNTING_EMAILS = 'money@auracontent.com';
      expect(canSeePricing('other@auracontent.com', 'EDITOR')).toBe(false);
    });
  });

  describe('STAFF_EMAILS allowlist', () => {
    it('allows any role when email is in STAFF_EMAILS', () => {
      process.env.STAFF_EMAILS = 'weni@auracontent.com,dev@auracontent.com';
      expect(canSeePricing('weni@auracontent.com', 'EDITOR')).toBe(true);
      expect(canSeePricing('dev@auracontent.com', 'VIEWER')).toBe(true);
      expect(canSeePricing('dev@auracontent.com', null)).toBe(true);
    });

    it('checks both lists (either grants access)', () => {
      process.env.ACCOUNTING_EMAILS = 'acct@auracontent.com';
      process.env.STAFF_EMAILS = 'staff@auracontent.com';
      expect(canSeePricing('acct@auracontent.com', 'VIEWER')).toBe(true);
      expect(canSeePricing('staff@auracontent.com', 'VIEWER')).toBe(true);
      expect(canSeePricing('neither@auracontent.com', 'VIEWER')).toBe(false);
    });
  });

  describe('email normalization', () => {
    it('is case-insensitive and whitespace-tolerant on the caller email', () => {
      process.env.ACCOUNTING_EMAILS = 'weni@x.com';
      expect(canSeePricing('  Weni@X.com ', 'EDITOR')).toBe(true);
      expect(canSeePricing('WENI@X.COM', 'VIEWER')).toBe(true);
    });

    it('is case-insensitive and whitespace-tolerant on the allowlist side', () => {
      process.env.STAFF_EMAILS = '  WENI@X.COM , other@y.com ';
      expect(canSeePricing('weni@x.com', 'EDITOR')).toBe(true);
      expect(canSeePricing('other@y.com', 'EDITOR')).toBe(true);
    });
  });

  describe('missing email', () => {
    it('denies undefined, null and empty email for EDITOR', () => {
      process.env.ACCOUNTING_EMAILS = 'money@auracontent.com';
      process.env.STAFF_EMAILS = 'weni@x.com';
      expect(canSeePricing(undefined, 'EDITOR')).toBe(false);
      expect(canSeePricing(null, 'EDITOR')).toBe(false);
      expect(canSeePricing('', 'EDITOR')).toBe(false);
      expect(canSeePricing('   ', 'EDITOR')).toBe(false);
    });
  });

  describe('unset allowlists', () => {
    it('denies non-privileged roles when both env vars are unset', () => {
      expect(process.env.ACCOUNTING_EMAILS).toBeUndefined();
      expect(process.env.STAFF_EMAILS).toBeUndefined();
      expect(canSeePricing('weni@x.com', 'EDITOR')).toBe(false);
      expect(canSeePricing('weni@x.com', 'VIEWER')).toBe(false);
    });

    it('denies when allowlists are empty strings', () => {
      process.env.ACCOUNTING_EMAILS = '';
      process.env.STAFF_EMAILS = '';
      expect(canSeePricing('weni@x.com', 'EDITOR')).toBe(false);
    });

    it('empty-string allowlist does not grant access to empty email', () => {
      process.env.ACCOUNTING_EMAILS = ',,';
      expect(canSeePricing('', 'EDITOR')).toBe(false);
      expect(canSeePricing('   ', 'EDITOR')).toBe(false);
    });
  });

  describe('exact matching (no substring tricks)', () => {
    it('is not fooled by a superstring of an allowlisted email', () => {
      process.env.ACCOUNTING_EMAILS = 'weni@x.com';
      expect(canSeePricing('evil-weni@x.com', 'EDITOR')).toBe(false);
      expect(canSeePricing('weni@x.com.evil.org', 'EDITOR')).toBe(false);
    });

    it('is not fooled by a substring of an allowlisted email', () => {
      process.env.STAFF_EMAILS = 'weni@x.com';
      expect(canSeePricing('eni@x.com', 'EDITOR')).toBe(false);
      expect(canSeePricing('weni@x', 'EDITOR')).toBe(false);
    });
  });
});
