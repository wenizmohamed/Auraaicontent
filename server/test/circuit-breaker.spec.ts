// Circuit-breaker cooldown behaviour.
//
// The breaker is per-(provider, task). A transient failure (outage, 5xx)
// should re-probe quickly, but a QUOTA/credits exhaustion is not a blip: a
// monthly plan that ran out stays out until its reset date. With one cooldown
// for both, every request during a dead quota period paid a doomed round trip
// on the dead provider before falling through.
//
// Live case 2026-10-30: Alibaba's token plan was exhausted until 11-04 16:00
// UTC. 105 wasted calls landed in the log because the breaker re-probed every
// 30 seconds.
//
// Run:  npm test -- circuit-breaker.spec.ts

import { describe, expect, it, beforeEach } from 'vitest';
import {
  recordFailure, recordSuccess, isProviderOpen, filterAvailable,
  getCircuitSnapshot, resetAllCircuits,
} from '../src/services/providers/circuit-breaker.js';

const PROVIDERS = [{ name: 'dashscope' }, { name: 'gemini' }];

const QUOTA_MSG = '429 Your token-plan 1-month quota has been exhausted. The quota will reset at 11-04 16:00:00 UTC.';
const TRANSIENT_MSG = '503 high demand';

describe('circuit breaker cooldown', () => {
  beforeEach(() => resetAllCircuits());

  it('opens the breaker after the failure threshold', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', TRANSIENT_MSG);
    expect(isProviderOpen('dashscope', 'text')).toBe(true);
  });

  it('holds a quota failure open far longer than a transient failure', () => {
    // Same threshold, same provider/task — only the reason differs.
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', TRANSIENT_MSG);
    const transient = getCircuitSnapshot().find(c => c.provider === 'dashscope' && c.task === 'text')!;
    expect(transient.cooldownRemainingMs).toBeGreaterThan(0);
    expect(transient.cooldownRemainingMs).toBeLessThanOrEqual(30_000);

    resetAllCircuits();
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', QUOTA_MSG);
    const quota = getCircuitSnapshot().find(c => c.provider === 'dashscope' && c.task === 'text')!;
    expect(quota.state).toBe('open');
    // A quota that dies until the monthly reset must not be re-probed in 30s.
    expect(quota.cooldownRemainingMs).toBeGreaterThan(30_000);
  });

  it('keeps the breaker open while the quota is dead', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', QUOTA_MSG);
    // A half-open probe that fails again re-opens for the long cooldown.
    recordFailure('dashscope', 'text', QUOTA_MSG);
    const snap = getCircuitSnapshot().find(c => c.provider === 'dashscope' && c.task === 'text')!;
    expect(snap.state).toBe('open');
    expect(snap.cooldownRemainingMs).toBeGreaterThan(30_000);
  });

  it('closes on success', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', QUOTA_MSG);
    expect(isProviderOpen('dashscope', 'text')).toBe(true);
    recordSuccess('dashscope', 'text');
    expect(isProviderOpen('dashscope', 'text')).toBe(false);
  });

  it('drops an open provider from the chain but never returns an empty chain', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'text', QUOTA_MSG);
    const kept = filterAvailable(PROVIDERS, 'text');
    expect(kept.map(p => p.name)).toEqual(['gemini']);

    // Everything open -> best-effort returns the original list (never refuse).
    for (let i = 0; i < 4; i++) recordFailure('gemini', 'text', QUOTA_MSG);
    const all = filterAvailable(PROVIDERS, 'text');
    expect(all.length).toBeGreaterThan(0);
  });

  it('isolates the blast radius per task', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'image', QUOTA_MSG);
    expect(isProviderOpen('dashscope', 'image')).toBe(true);
    expect(isProviderOpen('dashscope', 'text')).toBe(false);
    expect(isProviderOpen('dashscope', 'video')).toBe(false);
  });

  it('shares one breaker between image and image_edit', () => {
    for (let i = 0; i < 4; i++) recordFailure('dashscope', 'image_edit', QUOTA_MSG);
    expect(isProviderOpen('dashscope', 'image')).toBe(true);
  });
});
