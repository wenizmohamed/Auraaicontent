/**
 * Agent template registry.
 *
 * Each template is an opinionated prompt + capability set the assistant
 * can be instantiated with. Templates exist so users get high-quality
 * outputs without needing to know the right system prompt — they pick a
 * use-case ("extract data from clipboard") and the right instructions
 * fire automatically.
 *
 * Mirrors the patterns showcased in 21st.dev's agent registry.
 */

export type AgentTemplateId = 'docs-assistant' | 'structured-extractor' | 'research-then-write';

export interface AgentTemplate {
  id: AgentTemplateId;
  name: string;
  shortLabel: string; // for compact UI surfaces (one or two words)
  description: string;
  systemPrompt: string;
  /** First-message scaffolding the user can edit. */
  starterPrompt: string;
  /** Tag list used by the UI for filtering. */
  tags: string[];
  /** Recommended provider (router will still apply the fallback chain). */
  preferredModel?: 'gemini' | 'grok' | 'kimi';
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'docs-assistant',
    name: 'Docs Assistant (Brand Q&A)',
    shortLabel: 'Brand Q&A',
    description:
      'Answers questions strictly from this tenant\'s knowledge base, briefs, and brand voice. Cites sources. Refuses to invent facts that are not in the corpus.',
    systemPrompt:
      'You are the brand-grounded assistant for the active workspace. Answer ONLY using information present in the workspace knowledge base, briefs, and previously-published content. If the answer is not present, say "I don\'t have that in your workspace yet" and suggest the user add a knowledge item or brief that would let you answer next time. Always cite the source title for any fact you use.',
    starterPrompt: 'What does our brand say about [topic]?',
    tags: ['knowledge', 'brand', 'rag'],
    preferredModel: 'kimi',
  },
  {
    id: 'structured-extractor',
    name: 'Structured Extractor',
    shortLabel: 'Extract',
    description:
      'Turn a pasted PDF, email, transcript, or screenshot OCR into typed JSON ready to populate the calendar, strategy, or insights tabs. Returns valid JSON only.',
    systemPrompt:
      'You convert unstructured text into structured JSON. The user will paste a document. Identify the entity type (calendar event, content idea, brief, knowledge item, contact, transcript) and emit a JSON object matching the workspace\'s schema for that entity. NEVER include prose or markdown around the JSON. If the schema is ambiguous, include a `_uncertainty` array of decisions you made.',
    starterPrompt: 'Paste your raw text below and I will extract structured fields:\n\n',
    tags: ['data', 'extract', 'automation'],
    preferredModel: 'gemini',
  },
  {
    id: 'research-then-write',
    name: 'Research → Write (Multi-stage)',
    shortLabel: 'Research+Write',
    description:
      'Three-stage pipeline: a researcher gathers facts (knowledge + web if available), a writer drafts long-form content, an editor checks against brand voice. Outputs a sourced, on-brand piece.',
    systemPrompt:
      'You orchestrate three phases: (1) RESEARCHER — gather every fact from workspace knowledge + brand briefs that bears on the topic; quote sources verbatim. (2) WRITER — draft the piece in the brand voice, weaving the researched facts in. (3) EDITOR — score the draft against the brand brief, flag any unsupported claim, return a single revised final. Output in this exact order: ## Research notes, ## Draft, ## Final (revised). Use plain markdown, no JSON.',
    starterPrompt: 'Topic: \nDesired length: \nTone: ',
    tags: ['multi-agent', 'longform', 'orchestration'],
    preferredModel: 'gemini',
  },
];

export function getTemplate(id: string): AgentTemplate | null {
  return AGENT_TEMPLATES.find((t) => t.id === id) ?? null;
}
