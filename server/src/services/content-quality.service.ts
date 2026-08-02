// Content-quality services (team feedback 2026-07-14):
//  - runComplianceCheck (Tamer): audits a post/caption against the client's
//    ClientBrief compliance rules — extracted from the compliance_check agent
//    tool so a plain authed endpoint can back a per-post "Check compliance"
//    button (financial/fraud/regulated content).
//  - scorePost (Tamer): rates a post on clarity / relevance / TOV alignment /
//    platform fit / engagement potential, with a one-line reason each and a
//    concrete improvement tip — "recommend how to enhance, not just generate".
//
// Both ride aiRouter.text (json mode) so they inherit the universal fallback
// chain + brand/knowledge/memory enrichment + cost metering. Best-effort:
// callers surface a clean error rather than crashing the Review page.

import { aiRouter } from './providers/ai-router.js';
import { db } from '../db/prisma.js';

// ─── Compliance ──────────────────────────────────────────────────
export type Severity = 'high' | 'med' | 'low';
export interface ComplianceIssue {
  severity: Severity;
  quote: string;
  rule_violated: string;
  suggestion: string;
}
export interface ComplianceResult {
  passed: boolean;
  issues: ComplianceIssue[];
  checkedAt: string;
}

const VALID_SEV: readonly Severity[] = ['high', 'med', 'low'];

function complianceSystem(c: { complianceNotes: string | null; brandDont: string; mandatoryInclusions: string | null; industry?: string | null }): string {
  const p: string[] = [
    'You are a compliance auditor for social/marketing content in the GCC/MENA market.',
    c.industry ? `The client operates in: ${c.industry}. Apply sector norms (e.g. financial-services claims, fraud-awareness accuracy, health/medical disclaimers) where relevant.` : '',
    'Evaluate the submitted text against the rules below and general regulatory risk.',
    'Return ONLY a JSON object: { "issues": [ { "severity": "high"|"med"|"low", "quote": "...", "rule_violated": "...", "suggestion": "..." } ] }.',
    'Severity: high = regulatory/legal risk, explicit brand-don\'t violation, missing mandatory disclosure/disclaimer, misleading or unsubstantiated claim; med = risky-but-legal wording, off-brand tone; low = stylistic nits.',
    'Flag: unsubstantiated superlatives ("guaranteed", "risk-free", "#1"), missing disclaimers on financial/health claims, sensitive or discriminatory phrasing, and anything a regulator could challenge. If no issues, return { "issues": [] }.',
    '',
    'RULES:',
  ];
  if (c.brandDont?.trim()) p.push(`Brand DON'T list:\n${c.brandDont.trim()}`);
  if (c.complianceNotes?.trim()) p.push(`Compliance notes:\n${c.complianceNotes.trim()}`);
  if (c.mandatoryInclusions?.trim()) p.push(`Mandatory inclusions (flag as HIGH if missing):\n${c.mandatoryInclusions.trim()}`);
  if (!c.brandDont && !c.complianceNotes && !c.mandatoryInclusions) {
    p.push('(No explicit rules configured. Flag only clear regulatory/misleading-claim issues for the sector above.)');
  }
  return p.filter(Boolean).join('\n');
}

function parseIssues(raw: unknown): ComplianceIssue[] {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    const s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { parsed = JSON.parse(s); } catch { return []; }
  }
  const list = parsed && typeof parsed === 'object' ? (parsed.issues ?? parsed) : null;
  if (!Array.isArray(list)) return [];
  const out: ComplianceIssue[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const { severity, quote, rule_violated, suggestion } = it as Record<string, unknown>;
    if (typeof severity !== 'string' || !VALID_SEV.includes(severity as Severity)) continue;
    if (typeof quote !== 'string' || typeof rule_violated !== 'string' || typeof suggestion !== 'string') continue;
    out.push({ severity: severity as Severity, quote, rule_violated, suggestion });
  }
  return out;
}

/** Audit arbitrary text against a client's brief rules. strict (default true):
 *  any high-severity issue → passed=false. */
export async function runComplianceCheck(
  orgId: string,
  clientId: string,
  text: string,
  opts: { strict?: boolean; userId?: string } = {},
): Promise<ComplianceResult> {
  const strict = opts.strict !== false;
  const [brief, client] = await Promise.all([
    db.clientBrief.findFirst({ where: { clientId, orgId } }).catch(() => null),
    db.client.findFirst({ where: { id: clientId, orgId }, select: { industry: true } }).catch(() => null),
  ]);
  const result = await aiRouter.text(
    {
      prompt: `TEXT TO AUDIT:\n---\n${text}\n---\nReturn the JSON now.`,
      system: complianceSystem({
        complianceNotes: brief?.complianceNotes ?? null,
        brandDont: brief?.brandDont ?? '',
        mandatoryInclusions: brief?.mandatoryInclusions ?? null,
        industry: client?.industry ?? null,
      }),
      json: true,
      temperature: 0.2,
      maxTokens: 2000,
    },
    { orgId, userId: opts.userId, clientId },
  );
  const issues = parseIssues(result.output);
  const hasHigh = issues.some((i) => i.severity === 'high');
  const passed = strict ? !hasHigh : issues.length === 0;
  return { passed, issues, checkedAt: new Date().toISOString() };
}

// ─── Content score ───────────────────────────────────────────────
export interface ContentScore {
  overall: number; // 0-100 (average of the five, rounded)
  dimensions: {
    clarity: { score: number; note: string };
    relevance: { score: number; note: string };
    toneAlignment: { score: number; note: string };
    platformFit: { score: number; note: string };
    engagement: { score: number; note: string };
  };
  topRecommendation: string;
  scoredAt: string;
}

const DIMS = ['clarity', 'relevance', 'toneAlignment', 'platformFit', 'engagement'] as const;

function scoreSystem(): string {
  return [
    'You are a senior social-content strategist grading ONE piece of content for a client, 0-100 per dimension.',
    'Score five dimensions honestly (be discerning. Most first drafts sit 55-80; reserve 90+ for genuinely excellent):',
    '- clarity: is the message instantly understood?',
    '- relevance: does it serve the brand objective + audience?',
    '- toneAlignment: does it match the brand tone of voice?',
    '- platformFit: right length/format/hook/hashtags for the platform?',
    '- engagement: hook strength, scroll-stopping potential, CTA pull.',
    'For each dimension give a score and a ONE-sentence note. Then give ONE concrete topRecommendation. The single highest-impact edit to make (specific, actionable, not generic).',
    'Return ONLY JSON: {"clarity":{"score":N,"note":"..."},"relevance":{"score":N,"note":"..."},"toneAlignment":{"score":N,"note":"..."},"platformFit":{"score":N,"note":"..."},"engagement":{"score":N,"note":"..."},"topRecommendation":"..."}',
  ].join('\n');
}

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Score a stored CalendarPost. Loads the post + brief context, asks the model
 *  for a rubric score, returns a structured result (also persisted to
 *  post.metadata.score by the route so Review can render chips). */
export async function scorePost(orgId: string, postId: string, userId?: string): Promise<{ score: ContentScore; clientId: string | null }> {
  const post = await db.calendarPost.findFirst({
    where: { id: postId, orgId },
    select: {
      caption: true, title: true, hook: true, cta: true, platform: true, format: true,
      hashtags: true, pillar: true, visualDirection: true,
      calendarMonth: { select: { clientId: true } },
    },
  });
  if (!post) throw new Error('Post not found');
  const clientId = post.calendarMonth?.clientId ?? null;
  const brief = clientId ? await db.clientBrief.findFirst({ where: { clientId, orgId }, select: { tone: true, audience: true, objective: true } }).catch(() => null) : null;

  const ctx = [
    brief?.tone ? `Brand tone: ${brief.tone}` : '',
    brief?.audience ? `Audience: ${brief.audience}` : '',
    brief?.objective ? `Objective: ${brief.objective}` : '',
  ].filter(Boolean).join('\n');

  const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as unknown[]).join(' ') : '';
  const content = [
    `Platform: ${post.platform} | Format: ${post.format}${post.pillar ? ` | Campaign/Pillar: ${post.pillar}` : ''}`,
    post.title ? `Title: ${post.title}` : '',
    post.hook ? `Hook: ${post.hook}` : '',
    `Caption: ${post.caption}`,
    post.cta ? `CTA: ${post.cta}` : '',
    hashtags ? `Hashtags: ${hashtags}` : '',
    post.visualDirection ? `Visual direction: ${post.visualDirection}` : '',
  ].filter(Boolean).join('\n');

  const result = await aiRouter.text(
    { prompt: `${ctx ? `CLIENT CONTEXT:\n${ctx}\n\n` : ''}CONTENT TO SCORE:\n${content}\n\nReturn the JSON now.`, system: scoreSystem(), json: true, temperature: 0.3, maxTokens: 900 },
    { orgId, userId, clientId: clientId || undefined },
  );

  let o: any = result.output;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = {}; } }
  o = o && typeof o === 'object' ? o : {};
  const dim = (k: string) => ({ score: clampScore(o[k]?.score), note: typeof o[k]?.note === 'string' ? o[k].note : '' });
  const dimensions = {
    clarity: dim('clarity'), relevance: dim('relevance'), toneAlignment: dim('toneAlignment'),
    platformFit: dim('platformFit'), engagement: dim('engagement'),
  };
  const overall = Math.round(DIMS.reduce((s, k) => s + dimensions[k].score, 0) / DIMS.length);
  const score: ContentScore = {
    overall,
    dimensions,
    topRecommendation: typeof o.topRecommendation === 'string' ? o.topRecommendation : '',
    scoredAt: new Date().toISOString(),
  };
  return { score, clientId };
}
