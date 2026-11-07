// Vertex AI provider contract tests.
//
// Vertex (Google Cloud / Agent Platform) was added on 2026-11-07 as the
// funded Google route: the Gemini Developer API key is billing-dead (402 on
// every model) while the Vertex entitlement on the same project answers 200.
//
// These tests pin the parts of the contract that are easy to break silently:
//   - the URL shape (project + location live in the PATH, the host stays global)
//   - the mandatory `role: 'user'` on contents
//   - the refusal to serve another provider's model id
//   - the fact that the provider reports its OWN name, so a Vertex failure
//     trips Vertex's circuit breaker and not Gemini's
//   - the absence of any video engine (Vertex serves none)
//   - the absence of any embedding surface (Vertex's embedding space is
//     ORTHOGONAL to the one that wrote our stored vectors)
//
// No network calls: `fetch` is stubbed and the request body is asserted.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The provider reads its env at module load, and ESM imports are hoisted
// above the statements above them — so the override has to be hoisted too.
// vi.hoisted runs before the imports.
vi.hoisted(() => {
  process.env.VERTEX_API_KEY = 'test-vertex-key';
  process.env.VERTEX_PROJECT = 'hubz-510406';
  process.env.VERTEX_LOCATION = 'us';
});

import { vertexProvider } from '../src/services/providers/vertex.provider.js';

interface Captured {
  url: string;
  init: any;
}

let captured: Captured[] = [];
let realFetch: typeof fetch;

function stubFetch(handler: (body: any) => { status?: number; json: any }) {
  (globalThis as any).fetch = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    captured.push({ url: String(url), init });
    const { status = 200, json } = handler(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as any;
  });
}

function textResponse(text: string) {
  return {
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
  };
}

beforeEach(() => {
  captured = [];
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('vertex provider: request shape', () => {
  it('builds the URL with project and location in the PATH and a global host', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello' });

    expect(captured).toHaveLength(1);
    const { url, init } = captured[0];
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/hubz-510406/locations/us/publishers/google/models/gemini-3.8-flash:generateContent',
    );
    // The key travels in a header, never in the query string.
    expect(init.headers['x-goog-api-key']).toBe('test-vertex-key');
    expect(url).not.toContain('test-vertex-key');
  });

  it('sends role:"user" on the contents (Vertex rejects a missing role)', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello' });

    const body = JSON.parse(captured[0].init.body);
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('hello');
  });

  it('sets thinkingBudget 0 so the thinking tokens cannot eat the output cap', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello' });

    const body = JSON.parse(captured[0].init.body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('asks for JSON when the caller wants JSON', async () => {
    stubFetch(() => ({ json: textResponse('{"a":1}') }));
    const res = await vertexProvider.text({ prompt: 'hi', json: true });

    const body = JSON.parse(captured[0].init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(res.output).toEqual({ a: 1 });
  });

  it('filters thought parts out of the answer', async () => {
    // Vertex returns reasoning parts alongside the answer. Reading text from
    // them would prepend the model's private reasoning to the answer.
    stubFetch(() => ({
      json: {
        candidates: [{
          content: {
            parts: [
              { text: 'internal reasoning', thought: true },
              { text: 'the real answer' },
            ],
          },
          finishReason: 'STOP',
        }],
      },
    }));
    const res = await vertexProvider.text({ prompt: 'hello' });
    expect(res.output).toBe('the real answer');
  });
});

describe('vertex provider: model id discipline', () => {
  it('serves a pinned Google model id', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello', model: 'gemini-3-pro-image' });
    expect(captured[0].url).toContain('/models/gemini-3-pro-image:generateContent');
  });

  it('refuses another provider\'s model id instead of forwarding it', async () => {
    // A Qwen id forwarded to a Google endpoint is a guaranteed 404, and the
    // request would burn the whole chain before it found a live engine.
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello', model: 'qwen-image-3.0-pro' });
    // It fell back to the ladder head rather than sending the Qwen id.
    expect(captured[0].url).not.toContain('qwen-image-3.0-pro');
    expect(captured[0].url).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('never lets a Qwen id reach the wire at all', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    await vertexProvider.text({ prompt: 'hello', model: 'qwen3.8-max' });
    for (const c of captured) expect(c.url).not.toContain('qwen');
  });
});

describe('vertex provider: identity and capabilities', () => {
  it('reports its own provider name so its breaker is separate from Gemini', async () => {
    stubFetch(() => ({ json: textResponse('ok') }));
    const res = await vertexProvider.text({ prompt: 'hello' });
    expect(vertexProvider.name).toBe('vertex');
    expect(res.provider).toBe('vertex');
    // The name must NOT be 'gemini' — sharing it would let one outage trip
    // the other provider's circuit breaker.
    expect(vertexProvider.name).not.toBe('gemini');
  });

  it('has no video engine and says so clearly', async () => {
    // Vertex serves no veo-* id and gemini-omni-flash-preview is
    // Developer-API-only. The provider must throw a clear, non-retryable
    // error so the ai-router falls through instead of hanging.
    await expect(vertexProvider.video({ prompt: 'a clip' })).rejects.toThrow(/no Vertex video engine/i);
    expect(captured).toHaveLength(0);
  });

  it('exposes no embedding surface', () => {
    // The provider interface has no embed() and the file must not grow one:
    // Vertex's embedding space is orthogonal to the one that wrote our stored
    // vectors (cos ≈ 0.009–0.023 vs the same text), so a partial flip would
    // silently serve unranked RAG chunks.
    expect((vertexProvider as any).embed).toBeUndefined();
  });
});

describe('vertex provider: error handling', () => {
  it('surfaces a 401 as a provider error rather than a generic throw', async () => {
    stubFetch(() => ({
      status: 401,
      json: { error: { message: 'API key not valid' } },
    }));
    await expect(vertexProvider.text({ prompt: 'hello' })).rejects.toThrow(/401|API key/i);
  });

  it('does NOT retry a 400 (a bad request will fail on every rung too)', async () => {
    stubFetch(() => ({
      status: 400,
      json: { error: { message: 'Invalid argument' } },
    }));
    await expect(vertexProvider.text({ prompt: 'hello' })).rejects.toThrow();
    // One attempt only — the whole ladder must not be burned on a bad body.
    expect(captured.length).toBe(1);
  });
});

describe('vertex provider: image', () => {
  it('requests the IMAGE modality and reads the inline data out', async () => {
    stubFetch(() => ({
      json: {
        candidates: [{
          content: {
            parts: [
              { text: 'thinking', thought: true },
              { inlineData: { mimeType: 'image/png', data: 'BASE64PNG' } },
            ],
          },
          finishReason: 'STOP',
        }],
      },
    }));
    const res = await vertexProvider.image({ prompt: 'a logo' });

    const body = JSON.parse(captured[0].init.body);
    expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    expect((res.output as any).base64).toBe('BASE64PNG');
  });

  it('passes the aspect ratio and size through to imageConfig', async () => {
    stubFetch(() => ({
      json: {
        candidates: [{
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'X' } }] },
          finishReason: 'STOP',
        }],
      },
    }));
    await vertexProvider.image({ prompt: 'a logo', aspectRatio: '16:9', imageSize: '4K' });

    const body = JSON.parse(captured[0].init.body);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '4K' });
  });

  it('defaults the size to 2K on the ultra tier', async () => {
    // The Creative Studio "Ultra" button must render an 2K frame, the same
    // rule the Gemini provider applies. Without it, ultra silently produced
    // the default size and the user paid for a tier they did not get.
    stubFetch(() => ({
      json: {
        candidates: [{
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'X' } }] },
          finishReason: 'STOP',
        }],
      },
    }));
    await vertexProvider.image({ prompt: 'a logo', quality: 'ultra' });
    const body = JSON.parse(captured[0].init.body);
    expect(body.generationConfig.imageConfig.imageSize).toBe('2K');

    // An explicit size still wins over the ultra default.
    captured = [];
    await vertexProvider.image({ prompt: 'a logo', quality: 'ultra', imageSize: '4K' });
    expect(JSON.parse(captured[0].init.body).generationConfig.imageConfig.imageSize).toBe('4K');
  });

  it('reports an empty image response as retryable, not as a success', async () => {
    stubFetch(() => ({
      json: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    }));
    await expect(vertexProvider.image({ prompt: 'a logo' })).rejects.toThrow(/empty image response/i);
  });
});
