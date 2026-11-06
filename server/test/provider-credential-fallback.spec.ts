import { describe, it, expect } from 'vitest';
import { isRetryableAiError, AllProvidersFailedError } from '../src/services/providers/errors.js';

describe('provider credential problems fall through the chain', () => {
  it('treats Alibaba 403 "access to model denied" as retryable', () => {
    // THE regression (2026-11-06): the workspace key lost its chat
    // entitlement and answered 403. The generic /403/ rule made it
    // non-retryable, so the router broke out of its provider loop after the
    // FIRST hop and never tried Gemini or xAI — the whole chain was dead
    // behind one dead credential.
    const err = new Error(
      '403 Access to model denied. Please make sure you are eligible for using the model.',
    );
    (err as any).status = 403;
    expect(isRetryableAiError(err)).toBe(true);
  });

  it('treats Alibaba 400 Arrearage as retryable', () => {
    const err = new Error(
      '{"code":"Arrearage","message":"Access denied, please make sure your account is in good standing."}',
    );
    (err as any).status = 400;
    expect(isRetryableAiError(err)).toBe(true);
  });

  it('treats AccessDenied.Unpurchased as retryable', () => {
    const err = new Error(
      '{"code":"AccessDenied.Unpurchased","message":"Access to model denied."}',
    );
    (err as any).status = 403;
    expect(isRetryableAiError(err)).toBe(true);
  });

  it('treats xAI exhausted credits as retryable', () => {
    const err = new Error(
      'Your team b4bc845e-81c1-402c-84c5-c5592445730e has either used all available credits or reached its monthly spending limit.',
    );
    (err as any).status = 403;
    expect(isRetryableAiError(err)).toBe(true);
  });

  it('treats Moonshot invalid authentication as retryable', () => {
    const err = new Error('{"error":{"message":"Invalid Authentication"}}');
    (err as any).status = 401;
    expect(isRetryableAiError(err)).toBe(true);
  });

  it('STILL treats a genuine bad request as non-retryable', () => {
    // The fix must not turn every 4xx into a fallback. A request the
    // provider understood and rejected must not be retried on the next rung.
    const err = new Error('400 Bad Request: prompt exceeds max length');
    (err as any).status = 400;
    expect(isRetryableAiError(err)).toBe(false);
  });

  it('STILL treats a malformed payload as non-retryable', () => {
    const err = new Error('malformed payload');
    (err as any).status = 400;
    expect(isRetryableAiError(err)).toBe(false);
  });
});

describe('AllProvidersFailedError message', () => {
  it('says "out of credits" when every provider died on a credential/quota problem', () => {
    const err = new AllProvidersFailedError('text', [
      { provider: 'dashscope', message: '403 Access to model denied', retryable: true },
      { provider: 'gemini', message: '402 Your prepayment credits are depleted', retryable: true },
    ]);
    expect(err.message).toMatch(/out of text credits/i);
    expect(err.statusCode).toBe(503);
  });

  it('still reports the provider list for a mixed failure', () => {
    const err = new AllProvidersFailedError('image', [
      { provider: 'dashscope', message: '403 Access to model denied', retryable: true },
      { provider: 'gemini', message: 'malformed payload', retryable: false },
    ]);
    expect(err.message).toMatch(/dashscope/);
    expect(err.message).toMatch(/gemini/);
  });
});
