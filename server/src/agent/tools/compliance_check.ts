// compliance_check — audit text against a Client's ClientBrief constraints.
//
// Pulls complianceNotes, brandDont, and mandatoryInclusions for the client,
// feeds them to Anthropic with a strict JSON output contract, and returns a
// structured issue list. Emits one agent:thought per issue.
//
// Strict mode: any severity=high issue flips passed→false regardless of count.

import { chatText } from '../../services/llm/chat.js';
import { defineTool } from '../tool-types.js';

interface Args {
  text: string;
  clientId: string;
  strict?: boolean;
  /** When provided, write the findings list into CalendarPost.metadata.compliance
   *  so the Content Review page can surface issues per post. */
  postId?: string;
}

type Severity = 'high' | 'med' | 'low';

interface ComplianceIssue {
  severity: Severity;
  quote: string;
  rule_violated: string;
  suggestion: string;
}

interface Result {
  passed: boolean;
  issues: ComplianceIssue[];
  /** Populated when postId was supplied AND the metadata write succeeded. */
  persistedPostId?: string;
}

// Tool LLM rides the Gemini → Grok → Kimi fallback chain.
const VALID_SEVERITIES: readonly Severity[] = ['high', 'med', 'low'] as const;

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (VALID_SEVERITIES as readonly string[]).includes(value);
}

interface BriefConstraints {
  complianceNotes: string | null;
  brandDont: string;
  mandatoryInclusions: string | null;
}

function buildSystemPrompt(constraints: BriefConstraints): string {
  const parts: string[] = [
    'You are a compliance auditor for Radix Media client content (Dubai market).',
    'Evaluate the submitted text against the rules below.',
    'Return ONLY a JSON object — no prose, no markdown fence.',
    'Shape: { "issues": [ { "severity": "high"|"med"|"low", "quote": "...", "rule_violated": "...", "suggestion": "..." } ] }',
    'Severity guidance:',
    '- high: regulatory/legal risk, explicit brand-don\'t violation, missing mandatory disclosure.',
    '- med: off-brand tone, weak phrasing, risky-but-legal wording.',
    '- low: stylistic nits.',
    'If there are no issues, return { "issues": [] }.',
    '',
    'RULES:',
  ];
  if (constraints.brandDont?.trim()) {
    parts.push(`Brand DON'T list:\n${constraints.brandDont.trim()}`);
  }
  if (constraints.complianceNotes?.trim()) {
    parts.push(`Compliance notes:\n${constraints.complianceNotes.trim()}`);
  }
  if (constraints.mandatoryInclusions?.trim()) {
    parts.push(`Mandatory inclusions (flag as high if missing):\n${constraints.mandatoryInclusions.trim()}`);
  }
  if (!constraints.brandDont && !constraints.complianceNotes && !constraints.mandatoryInclusions) {
    parts.push('(No explicit rules configured — flag only clear regulatory issues in the UAE market.)');
  }
  return parts.join('\n');
}

function parseIssues(rawText: string): ComplianceIssue[] {
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const maybeList = (parsed as Record<string, unknown>).issues;
  if (!Array.isArray(maybeList)) return [];

  const issues: ComplianceIssue[] = [];
  for (const item of maybeList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const severity = rec.severity;
    const quote = rec.quote;
    const rule = rec.rule_violated;
    const suggestion = rec.suggestion;
    if (!isSeverity(severity)) continue;
    if (typeof quote !== 'string' || typeof rule !== 'string' || typeof suggestion !== 'string') continue;
    issues.push({ severity, quote, rule_violated: rule, suggestion });
  }
  return issues;
}

export const tool = defineTool<Args, Result>({
  name: 'compliance_check',
  description:
    'Audit text against a Client\'s ClientBrief (complianceNotes + brandDont + mandatoryInclusions). Returns structured issues with severity and suggestions.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Content to audit.' },
      clientId: { type: 'string', description: 'Client to pull brief from.' },
      strict: {
        type: 'boolean',
        description: 'If true, any high-severity issue forces passed=false (default true).',
      },
      postId: {
        type: 'string',
        description: 'Optional — when provided, write findings to CalendarPost.metadata.compliance.',
      },
    },
    required: ['text', 'clientId'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('aborted');
    const strict = args.strict !== false;

    const brief = await ctx.prisma.clientBrief.findFirst({
      where: { clientId: args.clientId, orgId: ctx.orgId },
    }).catch(() => null);

    const constraints: BriefConstraints = {
      complianceNotes: brief?.complianceNotes ?? null,
      brandDont: brief?.brandDont ?? '',
      mandatoryInclusions: brief?.mandatoryInclusions ?? null,
    };

    await ctx.emit('agent:thought', {
      text: `Running compliance check (strict=${strict})…`,
      at: new Date().toISOString(),
    });

    const resp = await chatText({
      max_tokens: 2000,
      messages: [
        { role: 'system', content: buildSystemPrompt(constraints) },
        {
          role: 'user',
          content: `TEXT TO AUDIT:\n---\n${args.text}\n---\nReturn the JSON now.`,
        },
      ],
      response_format: { type: 'json_object' },
    }, {
      meta: { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: ctx.clientId ?? undefined, jobId: ctx.sessionUid },
    });

    if (ctx.signal.aborted) throw new Error('aborted');

    const rawText = resp.text;

    const issues = parseIssues(rawText);

    for (const issue of issues) {
      await ctx.emit('agent:thought', {
        text: `[${issue.severity.toUpperCase()}] ${issue.rule_violated} — "${issue.quote.slice(0, 80)}"`,
        at: new Date().toISOString(),
      });
    }

    const hasHigh = issues.some((i) => i.severity === 'high');
    const passed = strict ? !hasHigh : issues.length === 0;

    await ctx.emit('agent:thought', {
      text: `Compliance: ${passed ? 'PASSED' : 'FAILED'} (${issues.length} issues)`,
      at: new Date().toISOString(),
    });

    // Persist findings into CalendarPost.metadata.compliance when postId is
    // supplied AND the post belongs to this session's client.  Content Review
    // reads metadata to surface compliance state per post.
    let persistedPostId: string | undefined;
    if (args.postId) {
      try {
        const row = await ctx.prisma.calendarPost.findUnique({
          where: { id: args.postId, orgId: ctx.orgId },
          select: { id: true, metadata: true, calendarMonth: { select: { clientId: true } } },
        });
        if (row && row.calendarMonth?.clientId === args.clientId) {
          const existing = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
            ? (row.metadata as Record<string, unknown>)
            : {};
          const nextMetadata: Record<string, unknown> = {
            ...existing,
            compliance: {
              passed,
              issues,
              checkedAt: new Date().toISOString(),
              strict,
            },
          };
          // Prisma's InputJsonValue is stricter than Record<string, unknown>.
          // Round-tripping through JSON.parse(JSON.stringify(...)) produces a
          // structurally-safe value while preserving the shape.
          await ctx.prisma.calendarPost.update({
            where: { id: row.id, orgId: ctx.orgId },
            data: { metadata: JSON.parse(JSON.stringify(nextMetadata)) },
          });
          persistedPostId = row.id;
          await ctx.emit('agent:artifact', {
            path: `post/${row.id}`,
            mimeType: 'application/x-radix-post',
            preview: `Compliance: ${passed ? 'PASSED' : 'FAILED'} (${issues.length} issues)`,
            at: new Date().toISOString(),
          });
          await ctx.emit('agent:thought', {
            text: `Compliance findings written to post ${row.id}.metadata.compliance.`,
            at: new Date().toISOString(),
          });
        }
      } catch (err) {
        await ctx.emit('agent:thought', {
          text: `Compliance persist failed: ${err instanceof Error ? err.message : String(err)}`,
          at: new Date().toISOString(),
        });
      }
    }

    return { passed, issues, persistedPostId };
  },
});
