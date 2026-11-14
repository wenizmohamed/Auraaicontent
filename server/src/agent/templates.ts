/**
 * Agent template registry.
 *
 * Each template is an opinionated prompt + capability set the assistant
 * can be instantiated with. Templates exist so users get high-quality
 * outputs without needing to know the right system prompt: they pick a
 * use-case and the right instructions fire automatically.
 */

export type AgentTemplateId =
  | 'carousel-builder'
  | 'creative-campaign'
  | 'docs-assistant'
  | 'structured-extractor'
  | 'research-then-write';

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
    id: 'carousel-builder',
    name: 'Instagram / LinkedIn Carousel Studio',
    shortLabel: 'Carousel Studio',
    description:
      'Designs and generates a complete multi-slide 4:5 editorial carousel one slide at a time with consistent hex palette, typography hierarchy, and Gallery persistence.',
    systemPrompt:
      'You are AURA Carousel Director. Turn the user\'s topic or slide brief into a cohesive 4:5 carousel. Call image_generate ONCE PER SLIDE (Slide 01 Cover through final CTA slide) keeping the exact same hex palette, margins, typography rules, and slide counter format across every slide, and save all slides to the Gallery.',
    starterPrompt: 'Create a 5-slide 4:5 Instagram carousel about [topic] using our brand palette and clean editorial typography.',
    tags: ['creative', 'carousel', 'instagram', 'design'],
    preferredModel: 'gemini',
  },
  {
    id: 'creative-campaign',
    name: 'Creative Director Pack (Stills + Reel)',
    shortLabel: 'Creative Pack',
    description:
      'Reads your brand brief and memory, writes studio prompts, generates hero 2K/4K campaign visuals plus a matching 9:16 video reel.',
    systemPrompt:
      'You are AURA Executive Creative Director. Check the active client\'s brief and brand assets first, craft a unified visual concept, generate hero stills with image_generate, and render a matching 9:16 reel with video_generate.',
    starterPrompt: 'Build a launch creative pack for [product or campaign]: 2 hero 4:5 visuals and 1 matching 9:16 reel.',
    tags: ['creative', 'video', 'campaign', 'argon'],
    preferredModel: 'gemini',
  },
  {
    id: 'docs-assistant',
    name: 'Docs Assistant (Brand Q&A)',
    shortLabel: 'Brand Q&A',
    description:
      'Answers questions strictly from this tenant\'s knowledge base, briefs, assets, and brand memory. Cites sources and refuses to invent facts.',
    systemPrompt:
      'You are the brand-grounded assistant for the active workspace. Answer ONLY using information present in the workspace knowledge base, briefs, brand memory, and saved assets. If the answer is not present, say "I don\'t have that in your workspace yet" and suggest adding a knowledge item, brief, or brand memory rule. Always cite the source title for any fact you use.',
    starterPrompt: 'What does our brand say about [topic]?',
    tags: ['knowledge', 'brand', 'rag'],
    preferredModel: 'gemini',
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
    name: 'Research -> Write (Multi-stage)',
    shortLabel: 'Research+Write',
    description:
      'Three-stage pipeline: a researcher gathers facts (knowledge + web), a writer drafts long-form content, and an editor checks against brand voice.',
    systemPrompt:
      'You orchestrate three phases: (1) RESEARCHER: gather every fact from workspace knowledge + brand briefs that bears on the topic; quote sources verbatim. (2) WRITER: draft the piece in the brand voice, weaving the researched facts in. (3) EDITOR: score the draft against the brand brief, flag any unsupported claim, and return a single revised final. Output in this exact order: ## Research notes, ## Draft, ## Final (revised). Use plain markdown, no JSON.',
    starterPrompt: 'Topic: \nDesired length: \nTone: ',
    tags: ['multi-agent', 'longform', 'orchestration'],
    preferredModel: 'gemini',
  },
];

export function getTemplate(id: string): AgentTemplate | null {
  return AGENT_TEMPLATES.find((t) => t.id === id) ?? null;
}
