// Claude is reached through the official Anthropic API with a Claude Console
// key, and nothing else.
//
// Until 2026-11-14 the provider sent requests to a reseller and dressed them
// up as the Claude Code CLI (claude-code beta header, claude-cli User-Agent,
// a "You are Claude Code" system prompt with the real instructions moved
// into the user turn) so a subscription token would be accepted. Anthropic
// does not permit routing an app's requests through Free/Pro/Max/Ultra plan
// credentials. These tests pin the official shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgresql://test@127.0.0.1:1/test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
});

const { anthropicApiKey, anthropicProvider } = await import('../src/services/providers/anthropic.provider.js');

let savedKey: string | undefined;
let captured: { url: string; init: any }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  captured = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    }), { status: 200 });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe('anthropicApiKey', () => {
  it('accepts only an official Claude Console key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test';
    expect(anthropicApiKey()).toBe('sk-ant-api03-test');
  });

  it('ignores a reseller token', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-a9df2f26c8e5bdc1afc9a944f26f9df57af7110200000000000000000000000';
    expect(anthropicApiKey()).toBeUndefined();
  });

  it('ignores a Claude subscription token (claude setup-token makes sk-ant-oat...)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-oat01-subscription-oauth-token';
    expect(anthropicApiKey()).toBeUndefined();
  });

  it('is undefined when nothing is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(anthropicApiKey()).toBeUndefined();
  });
});

describe('the request the provider sends', () => {
  it('goes to api.anthropic.com with x-api-key and no Claude Code disguise', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test';
    await anthropicProvider.text({ prompt: 'Write one line.', system: 'You are AURA.' });

    expect(captured).toHaveLength(1);
    const { url, init } = captured[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-api03-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['Authorization']).toBeUndefined();
    expect(init.headers['anthropic-beta']).toBeUndefined();
    expect(init.headers['User-Agent']).toBeUndefined();
    expect(init.headers['x-app']).toBeUndefined();

    const body = JSON.parse(init.body);
    expect(body.system).toBe('You are AURA.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Write one line.' }]);
    expect(init.body).not.toMatch(/Claude Code/);
  });

  it('refuses to call anything without an official key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-reseller-token';
    await expect(anthropicProvider.text({ prompt: 'x' })).rejects.toThrow(/official/);
    expect(captured).toHaveLength(0);
  });
});
