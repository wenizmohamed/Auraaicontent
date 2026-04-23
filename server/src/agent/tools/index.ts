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
import type { Tool } from '../tool-types.js';

// Cast each typed tool to the erased registry type.  Runtime behavior is
// unchanged; the loop validates args via each tool's own `input_schema`.
type AnyTool = Tool<Record<string, unknown>, unknown>;

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
];

export const TOOL_BY_NAME: Record<string, AnyTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

// Anthropic-compatible tool schema (for Messages.create({ tools: ... })).
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: AnyTool['input_schema'] }> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
