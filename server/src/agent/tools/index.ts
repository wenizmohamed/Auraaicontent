// Registry of all content-ops tools.
// Import each tool file and expose a flat `TOOLS` array keyed by `tool.name`.

import { tool as briefAnalyze } from './brief_analyze.js';
import { tool as piecesGenerate } from './pieces_generate.js';
import { tool as calendarPlan } from './calendar_plan.js';
import { tool as captionWrite } from './caption_write.js';
import { tool as hashtagResearch } from './hashtag_research.js';
import { tool as complianceCheck } from './compliance_check.js';
import { tool as clientSwitch } from './client_switch.js';
import { tool as imageGenerate } from './image_generate.js';
import { tool as competitorScrape } from './competitor_scrape.js';
import { tool as visualSearch } from './visual_search.js';
import { tool as calendarRead } from './calendar_read.js';
import { tool as assetSearch } from './asset_search.js';
import { tool as webResearch } from './web_research.js';
import { tool as postSchedule } from './post_schedule.js';
import { tool as briefSave } from './brief_save.js';
import { tool as videoGenerate } from './video_generate.js';
import type { Tool } from '../tool-types.js';

// Cast each typed tool to the erased registry type. Runtime behavior is
// unchanged; the loop validates parsed arguments against each tool's
// `input_schema` (via validateToolInput below) BEFORE dispatching to the
// handler, and on mismatch feeds a structured, actionable error back to the
// model instead of calling the handler.
type AnyTool = Tool<Record<string, unknown>, unknown>;

export type ToolInputSchema = AnyTool['input_schema'];

export const TOOLS: AnyTool[] = [
  briefAnalyze as unknown as AnyTool,
  piecesGenerate as unknown as AnyTool,
  calendarPlan as unknown as AnyTool,
  captionWrite as unknown as AnyTool,
  hashtagResearch as unknown as AnyTool,
  complianceCheck as unknown as AnyTool,
  clientSwitch as unknown as AnyTool,
  imageGenerate as unknown as AnyTool,
  competitorScrape as unknown as AnyTool,
  visualSearch as unknown as AnyTool,
  calendarRead as unknown as AnyTool,
  assetSearch as unknown as AnyTool,
  webResearch as unknown as AnyTool,
  postSchedule as unknown as AnyTool,
  briefSave as unknown as AnyTool,
  videoGenerate as unknown as AnyTool,
];

export const TOOL_BY_NAME: Record<string, AnyTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

// ---------------------------------------------------------------------------
// Tool argument validation.
//
// Dependency-free validator for the JSON Schema subset the tools actually
// declare: type object / string / number / integer / boolean / array,
// `required`, `enum`, nested `properties`, and `items`. Anything outside that
// subset (format, pattern, min/max, ...) is intentionally not enforced.
// `additionalProperties: false` is declared on most schemas but deliberately
// NOT enforced here: rejecting a harmless extra key would burn an agent
// iteration for no correctness gain. Missing or wrong-typed fields are the
// failures that TypeError inside handlers, so those are what we block.

interface SchemaNode {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, SchemaNode>;
  required?: string[];
  enum?: Array<string | number>;
  items?: SchemaNode;
  additionalProperties?: boolean;
  description?: string;
}

export interface ValidationIssue {
  // Dot/bracket path to the offending field; '(root)' for the top level.
  field: string;
  expected: string;
  received: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function describeValue(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string') {
    const s = v as string;
    return `string ${JSON.stringify(s.length > 40 ? `${s.slice(0, 40)}...` : s)}`;
  }
  if (t === 'number' || t === 'boolean') return `${t} (${String(v)})`;
  return t;
}

function childPath(parent: string, key: string): string {
  return parent === '(root)' ? key : `${parent}.${key}`;
}

function checkNode(value: unknown, schema: SchemaNode, path: string, issues: ValidationIssue[]): void {
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ field: path, expected: 'object', received: describeValue(value) });
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const req of schema.required ?? []) {
        if (obj[req] === undefined) {
          const propType = schema.properties?.[req]?.type;
          issues.push({
            field: childPath(path, req),
            expected: propType ? `required ${propType}` : 'required value',
            received: 'missing',
          });
        }
      }
      for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
        const v = obj[key];
        if (v === undefined) continue; // absence is handled by `required` above
        checkNode(v, propSchema, childPath(path, key), issues);
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push({ field: path, expected: 'array', received: describeValue(value) });
        return;
      }
      if (schema.items) {
        const items = schema.items;
        value.forEach((el, i) => checkNode(el, items, `${path}[${i}]`, issues));
      }
      break;
    }
    case 'string':
      if (typeof value !== 'string') {
        issues.push({ field: path, expected: 'string', received: describeValue(value) });
        return;
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ field: path, expected: 'number', received: describeValue(value) });
        return;
      }
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issues.push({ field: path, expected: 'integer', received: describeValue(value) });
        return;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        issues.push({ field: path, expected: 'boolean', received: describeValue(value) });
        return;
      }
      break;
    default:
      break; // untyped node: only enum (below) applies
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    issues.push({
      field: path,
      expected: `one of [${schema.enum.map((e) => JSON.stringify(e)).join(', ')}]`,
      received: describeValue(value),
    });
  }
}

/** Validate parsed tool-call arguments against the tool's input_schema. */
export function validateToolInput(schema: ToolInputSchema, input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  checkNode(input, schema as SchemaNode, '(root)', issues);
  return { ok: issues.length === 0, issues };
}

/**
 * Serialize validation issues into a structured tool result the model can
 * act on: names the offending field, what was expected, what arrived, and
 * how to retry. Returned as the role:'tool' message content so a bad call
 * becomes a self-correction on the next iteration instead of a handler crash.
 */
export function formatValidationError(toolName: string, issues: ValidationIssue[]): string {
  return JSON.stringify({
    error: 'invalid_tool_arguments',
    tool: toolName,
    issues,
    hint: 'The handler was NOT executed. Fix the listed fields and call the tool again with corrected arguments.',
  });
}

// Anthropic-compatible tool schema (kept for Vertex Claude fallback path).
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: AnyTool['input_schema'] }> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

// OpenAI-compatible tool schema (xAI Grok, OpenAI, Vertex non-Claude).
// Shape: { type: 'function', function: { name, description, parameters } }
export function toOpenAITools(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: AnyTool['input_schema'] };
}> {
  return TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
