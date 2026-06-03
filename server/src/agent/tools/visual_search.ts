import type { Tool, ToolContext } from '../tool-types.js';
import { visualSearchService } from '../../services/visual-search.service.js';

interface Input {
  query: string;
  count?: number;
}

interface Output {
  results: {
    thumbnailUrl: string;
    sourceUrl: string;
    sourceDomain: string;
    title?: string;
    description?: string;
  }[];
  provider: string;
}

export const tool: Tool<Input, Output> = {
  name: 'visual_search',
  description:
    'Search for visual reference images by keyword. Returns thumbnail URLs, source URLs, titles and descriptions. ' +
    'Use this when the user asks for visual references, mood boards, design inspiration, or image examples for a topic. ' +
    'Results come from Wikimedia Commons and Pinterest.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query describing the visual you need, e.g. "luxury healthcare branding" or "minimalist tech UI dark mode"',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-20, default 8)',
      },
    },
    required: ['query'],
  },
  async handler(input: Input, ctx: ToolContext): Promise<Output> {
    const { results, provider } = await visualSearchService.search(
      input.query,
      input.count ?? 8,
      { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: ctx.clientId ?? undefined },
    );
    return {
      results: results.map(r => ({
        thumbnailUrl: r.thumbnailUrl,
        sourceUrl: r.sourceUrl,
        sourceDomain: r.sourceDomain,
        title: r.title,
        description: r.description,
      })),
      provider,
    };
  },
};
