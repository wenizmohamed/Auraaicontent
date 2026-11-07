// The prompt must be written for the engine that will actually run it.
//
// The enhancer picks a per-engine instruction block ("dialect") that decides
// the shape of the prompt: whether the audio lines are KEPT (Wan 3.0 renders
// sound in the same pass) or DELETED (Wan 2.7 and HappyHorse publish Video
// only), whether the layout is spelled out (Qwen) or narrated (Gemini).
//
// Two bugs hid behind this:
//
//  1. "Improve with AI" sent NO engine and NO model, so the enhancer wrote
//     for a generic engine while the router ran a very specific one. Auto
//     video (wan3.0-video-prime, which has audio) was getting the audio-less
//     dialect, so the user's sound design was silently dropped.
//  2. HappyHorse 1.1 (all three entries in the picker) matched no branch at
//     all and fell through to the empty string.
//
// These tests pin the mapping so neither can come back.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  engineDialect,
  engineForModel,
  autoEngineFor,
  dialectKeyFor as serverDialectKeyFor,
  DIALECT_HINTS as SERVER_DIALECT_HINTS,
  type EnhanceMode,
  type DialectKey,
} from '../src/services/prompt-enhancer.service';
// The shipped picker catalog: the source of truth for which engines exist.
import {
  MODELS_BY_SECTION,
  DIALECT_HINTS as FE_DIALECT_HINTS,
  dialectKeyFor as feDialectKeyFor,
  type CreativeSection,
} from '../../apps/desktop/src/lib/creative-models';

const VIDEO_SECTIONS: CreativeSection[] = ['text-to-video', 'image-to-video', 'reference-video'];
const IMAGE_SECTIONS: CreativeSection[] = ['text-to-image', 'image-edit', 'upscale'];

/** Every explicit (non-Auto) engine the picker offers in a section. */
function explicitEngines(section: CreativeSection): { value: string; model?: string; provider?: string }[] {
  return MODELS_BY_SECTION[section].filter((o) => o.value !== 'auto');
}

// The server loads server/.env at import time, and that local file still
// carries AI_IMAGE_PRIMARY=gemini while prod runs dashscope. Every test here
// pins the routing env explicitly so it asserts the PROD behaviour and cannot
// be flipped by whatever happens to be in a developer's .env.
const ENV_KEYS = ['AI_IMAGE_PRIMARY', 'AI_VIDEO_PRIMARY', 'DASHSCOPE_IMAGE_MODEL', 'DASHSCOPE_VIDEO_MODEL'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AI_IMAGE_PRIMARY = 'dashscope';
  process.env.AI_VIDEO_PRIMARY = 'dashscope';
  process.env.DASHSCOPE_IMAGE_MODEL = 'qwen-image-3.0-pro';
  process.env.DASHSCOPE_VIDEO_MODEL = 'wan3.0-video-prime';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('engine resolution', () => {
  it('maps a model id to the provider that serves it', () => {
    expect(engineForModel('wan3.0-video-prime')).toBe('dashscope');
    expect(engineForModel('wan2.7-t2v')).toBe('dashscope');
    expect(engineForModel('happyhorse-1.1-i2v')).toBe('dashscope');
    expect(engineForModel('grok-imagine-video')).toBe('xai');
    expect(engineForModel('veo-3.1-generate-preview')).toBe('gemini');
    expect(engineForModel('gemini-omni-flash-preview')).toBe('gemini');
    // Absent model = Auto = the Alibaba primary.
    expect(engineForModel(undefined)).toBe('dashscope');
    expect(engineForModel('')).toBe('dashscope');
  });

  it('resolves Auto from the same env the router uses', () => {
    expect(autoEngineFor('text-to-image')).toEqual({ engine: 'dashscope', model: 'qwen-image-3.0-pro' });
    expect(autoEngineFor('text-to-video')).toEqual({ engine: 'dashscope', model: 'wan3.0-video-prime' });
  });

  it('follows a repointed primary (the prompt moves with the router)', () => {
    process.env.AI_VIDEO_PRIMARY = 'vertex';
    expect(autoEngineFor('text-to-video')).toEqual({ engine: 'vertex' });
  });
});

describe('every offered engine gets a dialect', () => {
  // The guard that stops the HappyHorse hole from reopening.
  for (const section of IMAGE_SECTIONS) {
    for (const o of explicitEngines(section)) {
      it(`${section}: ${o.value} has an image dialect`, () => {
        const d = engineDialect('text-to-image', o.provider, o.model);
        expect(d.length).toBeGreaterThan(0);
        expect(d).toContain('ENGINE NOTES');
      });
    }
  }

  for (const section of VIDEO_SECTIONS) {
    for (const o of explicitEngines(section)) {
      it(`${section}: ${o.value} has a video dialect`, () => {
        const d = engineDialect('text-to-video', 'dashscope', o.model);
        expect(d.length).toBeGreaterThan(0);
        expect(d).toContain('ENGINE NOTES');
      });
    }
  }

  it('Auto resolves to a dialect in every mode (no engine, no model)', () => {
    for (const mode of ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video'] as EnhanceMode[]) {
      const d = engineDialect(mode, undefined, undefined);
      expect(d.length).toBeGreaterThan(0);
      expect(d).toContain('ENGINE NOTES');
    }
  });
});

describe('the audio split', () => {
  // Wan 3.0 renders sound in the SAME pass as the picture. Its dialect must
  // KEEP the audio lines.
  it('Wan 3.0 keeps the audio lines', () => {
    const d = engineDialect('text-to-video', 'dashscope', 'wan3.0-video-prime');
    expect(d).toMatch(/KEEP the audio/i);
    expect(d).toContain('Wan 3.0');
  });

  it('Wan 3.0 (the plain id) also keeps the audio lines', () => {
    expect(engineDialect('text-to-video', 'dashscope', 'wan3.0-video')).toMatch(/KEEP the audio/i);
  });

  // Wan 2.7 publishes Video only on the live workspace: no audio modality.
  it('Wan 2.7 drops the audio lines', () => {
    const d = engineDialect('text-to-video', 'dashscope', 'wan2.7-t2v');
    expect(d).toMatch(/Omit the SFX/i);
    expect(d).not.toMatch(/KEEP the audio/i);
  });

  // HappyHorse 1.1 is also Video-only, and it is its own engine family.
  it('HappyHorse drops the audio lines and does not inherit Wan', () => {
    const d = engineDialect('text-to-video', 'dashscope', 'happyhorse-1.1-t2v');
    expect(d).toMatch(/Omit the SFX/i);
    expect(d).not.toMatch(/KEEP the audio/i);
    expect(d).toContain('HappyHorse');
  });

  it('HappyHorse never inherits the Wan 3.0 audio instruction', () => {
    for (const m of ['happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v']) {
      expect(engineDialect('text-to-video', 'dashscope', m)).not.toMatch(/KEEP the audio/i);
    }
  });

  it('Auto video resolves to Wan 3.0, so it keeps the audio', () => {
    // Auto is wan3.0-video-prime in prod. Even with no env set, the default
    // must be the audio-capable engine.
    const prev = process.env.DASHSCOPE_VIDEO_MODEL;
    try {
      delete process.env.DASHSCOPE_VIDEO_MODEL;
      expect(engineDialect('text-to-video', undefined, undefined)).toMatch(/KEEP the audio/i);
    } finally {
      if (prev === undefined) delete process.env.DASHSCOPE_VIDEO_MODEL;
      else process.env.DASHSCOPE_VIDEO_MODEL = prev;
    }
  });
});

describe('image dialects', () => {
  it('Qwen 3.0 Pro gets the Qwen layout note', () => {
    const d = engineDialect('text-to-image', 'dashscope', 'qwen-image-3.0-pro');
    expect(d).toContain('Qwen-Image');
    expect(d).toMatch(/layout/i);
  });

  it('Qwen 2.1 gets its own note (it understands local edits)', () => {
    const d = engineDialect('image-edit', 'dashscope', 'qwen-image-2.1-pro');
    expect(d).toContain('Qwen-Image 2.1');
  });

  it('Gemini / Vertex get the narrative note, not the Alibaba one', () => {
    const d = engineDialect('text-to-image', 'vertex', 'gemini-nano-banana-2.1');
    expect(d).toContain('nano-banana');
    expect(d).not.toContain('Qwen-Image');
  });

  it('Auto image resolves to Qwen', () => {
    const prev = process.env.DASHSCOPE_IMAGE_MODEL;
    try {
      delete process.env.DASHSCOPE_IMAGE_MODEL;
      expect(engineDialect('text-to-image', undefined, undefined)).toContain('Qwen-Image');
    } finally {
      if (prev === undefined) delete process.env.DASHSCOPE_IMAGE_MODEL;
      else process.env.DASHSCOPE_IMAGE_MODEL = prev;
    }
  });
});

// The frontend shows the user WHICH engine the prompt is written for, so the
// picker and the enhancer must agree on every engine. Two lists drift; a
// test that compares them stops them drifting.
describe('the picker and the enhancer agree', () => {
  const FE_TO_SERVER_MODE: Record<CreativeSection, EnhanceMode> = {
    'text-to-image': 'text-to-image',
    'image-edit': 'image-edit',
    'upscale': 'text-to-image',
    'text-to-video': 'text-to-video',
    'image-to-video': 'image-to-video',
    // The server has no reference-video mode; reference renders are image-to-video.
    'reference-video': 'image-to-video',
  };

  it('the two dialect-hint tables have the same keys', () => {
    expect(Object.keys(FE_DIALECT_HINTS).sort()).toEqual(Object.keys(SERVER_DIALECT_HINTS).sort());
  });

  it('every hint string is identical on both sides', () => {
    for (const key of Object.keys(SERVER_DIALECT_HINTS) as DialectKey[]) {
      expect(FE_DIALECT_HINTS[key], `hint text drifted for "${key}"`).toBe(SERVER_DIALECT_HINTS[key]);
    }
  });

  it('every engine the picker offers resolves to the same dialect on both sides', () => {
    for (const section of Object.keys(MODELS_BY_SECTION) as CreativeSection[]) {
      const serverMode = FE_TO_SERVER_MODE[section];
      for (const o of MODELS_BY_SECTION[section]) {
        if (o.value === 'auto') continue; // Auto resolves server-side from env.
        const feKey = feDialectKeyFor(o, section);
        const serverKey = serverDialectKeyFor(serverMode, o.provider, o.model);
        expect(serverKey, `${section}/${o.value} dialect drifted`).toBe(feKey);
      }
    }
  });

  it('every engine the picker offers has a non-empty dialect', () => {
    for (const section of Object.keys(MODELS_BY_SECTION) as CreativeSection[]) {
      const serverMode = FE_TO_SERVER_MODE[section];
      for (const o of MODELS_BY_SECTION[section]) {
        if (o.value === 'auto') continue;
        const d = engineDialect(serverMode, o.provider, o.model);
        expect(d.length, `${section}/${o.value} has no dialect`).toBeGreaterThan(0);
        expect(d).toContain('ENGINE NOTES');
      }
    }
  });
});
