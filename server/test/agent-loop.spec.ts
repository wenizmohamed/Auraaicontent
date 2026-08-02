// Agent loop tool-argument validation tests. Pure: no database, no network.
// Covers the dependency-free JSON Schema subset validator the loop runs
// before dispatching a tool handler, plus the structured error format that
// turns a bad tool call into a self-correction.

import { describe, it, expect } from 'vitest';
import {
  TOOLS,
  TOOL_BY_NAME,
  validateToolInput,
  formatValidationError,
  type ToolInputSchema,
} from '../src/agent/tools/index.js';

// Composite schema exercising the full supported subset: object / string /
// number / integer / boolean / array, required, enum, nested properties, items.
const schema: ToolInputSchema = {
  type: 'object',
  properties: {
    pieceId: { type: 'string' },
    platform: { type: 'string', enum: ['instagram', 'linkedin', 'tiktok', 'twitter'] },
    count: { type: 'number' },
    strict: { type: 'boolean' },
    handles: { type: 'array', items: { type: 'string' } },
    brief: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        pieceCount: { type: 'integer' },
      },
      required: ['objective'],
    },
  },
  required: ['pieceId', 'platform'],
  additionalProperties: false,
};

describe('validateToolInput', () => {
  it('accepts a fully valid input', () => {
    const res = validateToolInput(schema, {
      pieceId: 'post_123',
      platform: 'instagram',
      count: 12,
      strict: true,
      handles: ['@radix', 'competitor'],
      brief: { objective: 'Q3 awareness push', pieceCount: 18 },
    });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it('accepts valid input with optional fields omitted', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'tiktok' });
    expect(res.ok).toBe(true);
  });

  it('fails on a missing required field, naming the field', () => {
    const res = validateToolInput(schema, { platform: 'instagram' });
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.field === 'pieceId');
    expect(issue).toBeDefined();
    expect(issue?.received).toBe('missing');
    expect(issue?.expected).toContain('string');
  });

  it('fails on a wrong-typed field, naming the field and expected type', () => {
    const res = validateToolInput(schema, { pieceId: 42, platform: 'instagram' });
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.field === 'pieceId');
    expect(issue?.expected).toBe('string');
    expect(issue?.received).toContain('number');
  });

  it('fails on an unknown enum value, listing the allowed values', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'snapchat' });
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.field === 'platform');
    expect(issue).toBeDefined();
    expect(issue?.expected).toContain('one of');
    expect(issue?.expected).toContain('instagram');
  });

  it('does not double-report enum when the type is already wrong', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 7 });
    const issues = res.issues.filter((i) => i.field === 'platform');
    expect(issues).toHaveLength(1);
    expect(issues[0].expected).toBe('string');
  });

  it('fails on a wrong-typed boolean', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', strict: 'yes' });
    const issue = res.issues.find((i) => i.field === 'strict');
    expect(issue?.expected).toBe('boolean');
  });

  it('rejects NaN for number fields', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', count: NaN });
    const issue = res.issues.find((i) => i.field === 'count');
    expect(issue?.expected).toBe('number');
  });

  it('validates nested objects: missing nested required field uses a dotted path', () => {
    const res = validateToolInput(schema, {
      pieceId: 'p1',
      platform: 'instagram',
      brief: { pieceCount: 18 },
    });
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.field === 'brief.objective');
    expect(issue).toBeDefined();
    expect(issue?.received).toBe('missing');
  });

  it('validates nested objects: wrong-typed nested field uses a dotted path', () => {
    const res = validateToolInput(schema, {
      pieceId: 'p1',
      platform: 'instagram',
      brief: { objective: 'x', pieceCount: 'lots' },
    });
    const issue = res.issues.find((i) => i.field === 'brief.pieceCount');
    expect(issue?.expected).toBe('integer');
  });

  it('rejects a non-integer number where integer is required', () => {
    const res = validateToolInput(schema, {
      pieceId: 'p1',
      platform: 'instagram',
      brief: { objective: 'x', pieceCount: 3.5 },
    });
    const issue = res.issues.find((i) => i.field === 'brief.pieceCount');
    expect(issue?.expected).toBe('integer');
  });

  it('rejects a scalar where a nested object is expected', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', brief: 'not-an-object' });
    const issue = res.issues.find((i) => i.field === 'brief');
    expect(issue?.expected).toBe('object');
  });

  it('rejects a non-array where an array is expected', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', handles: '@radix' });
    const issue = res.issues.find((i) => i.field === 'handles');
    expect(issue?.expected).toBe('array');
  });

  it('validates array items, reporting the offending index', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', handles: ['ok', 7] });
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.field === 'handles[1]');
    expect(issue?.expected).toBe('string');
  });

  it('rejects an array where an object is expected at the root', () => {
    const res = validateToolInput(schema, ['pieceId']);
    expect(res.ok).toBe(false);
    expect(res.issues[0].field).toBe('(root)');
    expect(res.issues[0].expected).toBe('object');
  });

  it('rejects null at the root', () => {
    const res = validateToolInput(schema, null);
    expect(res.ok).toBe(false);
    expect(res.issues[0].field).toBe('(root)');
  });

  it('a tool with no required fields accepts {}', () => {
    const optionalOnly: ToolInputSchema = {
      type: 'object',
      properties: {
        clientSlug: { type: 'string' },
        clientId: { type: 'string' },
      },
      additionalProperties: false,
    };
    const res = validateToolInput(optionalOnly, {});
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it('does not reject unknown extra keys (self-correction over pedantry)', () => {
    const res = validateToolInput(schema, { pieceId: 'p1', platform: 'instagram', extra: 'harmless' });
    expect(res.ok).toBe(true);
  });

  it('reports multiple issues in one pass', () => {
    const res = validateToolInput(schema, { count: 'three', handles: [1] });
    expect(res.ok).toBe(false);
    const fields = res.issues.map((i) => i.field);
    expect(fields).toContain('pieceId');
    expect(fields).toContain('platform');
    expect(fields).toContain('count');
    expect(fields).toContain('handles[0]');
  });
});

describe('formatValidationError', () => {
  it('produces structured, parseable JSON naming the tool and fields', () => {
    const res = validateToolInput(schema, { platform: 'snapchat' });
    const raw = formatValidationError('caption_write', res.issues);
    const parsed = JSON.parse(raw) as {
      error: string;
      tool: string;
      issues: Array<{ field: string; expected: string; received: string }>;
      hint: string;
    };
    expect(parsed.error).toBe('invalid_tool_arguments');
    expect(parsed.tool).toBe('caption_write');
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.issues.some((i) => i.field === 'pieceId')).toBe(true);
    expect(parsed.issues.some((i) => i.field === 'platform')).toBe(true);
    expect(parsed.hint).toContain('call the tool again');
  });
});

describe('tool registry', () => {
  it('every registered tool has a name, description, and object input_schema', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(14);
    for (const t of TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.handler).toBe('function');
      expect(TOOL_BY_NAME[t.name]).toBe(t);
    }
  });

  it('registers the four new tools by their fixed names', () => {
    for (const name of ['calendar_read', 'asset_search', 'web_research', 'post_schedule']) {
      expect(TOOL_BY_NAME[name], `missing tool: ${name}`).toBeDefined();
    }
  });

  it('every registered schema accepts an input that satisfies its own required list', () => {
    // Synthesize a minimal valid input per tool from its schema and confirm
    // the validator passes it: catches a tool declaring a required field it
    // forgot to describe, and keeps validator + schemas mutually consistent.
    const sample = (node: Record<string, unknown>): unknown => {
      const type = node.type as string | undefined;
      const anEnum = node.enum as unknown[] | undefined;
      if (anEnum && anEnum.length > 0) return anEnum[0];
      if (type === 'string') return 'sample';
      if (type === 'number') return 1;
      if (type === 'integer') return 1;
      if (type === 'boolean') return true;
      if (type === 'array') return [];
      if (type === 'object') {
        const props = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
        const req = (node.required ?? []) as string[];
        const out: Record<string, unknown> = {};
        for (const key of req) out[key] = sample(props[key] ?? {});
        return out;
      }
      return 'sample';
    };
    for (const t of TOOLS) {
      const input = sample(t.input_schema as unknown as Record<string, unknown>);
      const res = validateToolInput(t.input_schema, input);
      expect(res.issues, `${t.name} rejected its own minimal input`).toEqual([]);
    }
  });
});
