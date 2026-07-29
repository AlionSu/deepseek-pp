// Local-skill activation scoring (implicit branch).
// Customized after the scoring paradigm in core/mcp/capability-projection.ts:
// reuses normalizeSearchText / tokenize, drops the pinned dimension (no pinning
// concept), and adds an "applicable / not-applicable scenario" adjustment
// (description-led).
// Enabled only for local indexed skills; does not affect builtin / bundled / imported-github.
//
// Design source: .workbuddy/memory/local-skill-scoring-spec.md (§3 weight table,
// §3.4 scenarioAdjustment, §3.5 threshold dual-gate).

import { normalizeSearchText, tokenize } from '../mcp/capability-projection';

export interface LocalSkillIndex {
  name: string;
  description: string;
  skillDir: string;
  instructions?: string;
}

// Threshold dual-gate: minimum activation score + significant lead gap (prevents "two weak skills competing for activation").
const ACTIVATION_THRESHOLD = 100;
const MIN_LEAD_GAP = 50;

// CJK-friendly tokenization: ASCII letters/digits/underscore/hyphen are kept as-is;
// contiguous CJK segments are split into 2-grams for whole-string matching.
// Fixes the original tokenizer treating a whole Chinese sentence as one token, which
// made the bidirectional match for the applicable-scenario bonus always fail.
export function tokenizeFlexible(value: string): string[] {
  const norm = normalizeSearchText(value);
  const base = tokenize(norm);
  const result = new Set(base);
  const cjk = norm.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    if (seg.length === 1) {
      result.add(seg);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) result.add(seg.slice(i, i + 2));
  }
  return [...result];
}

// Supports two scenario-section writing styles (applicable / not-applicable):
//  1) inline "label: content" (with ASCII or full-width colon)
//  2) markdown heading (e.g. "## 适用场景") up to the next "## " heading or EOF (standard SKILL.md style)
// The original implementation only supported style 1, so local Skills using the
// standard markdown heading style never received the +300 applicable-scenario bonus.
export function extractScenarioBlock(desc: string, headingLabel: string, inlineLabels: string): string {
  const inlinePattern = new RegExp(
    `(?:${inlineLabels})[：:]\\s*([\\s\\S]*?)(?=\\n#{1,3}\\s|\\n\\s*(?:适用场景|适用|使用场景|不适用场景|不适用|禁用场景)[：:]|$)`,
    'i',
  );
  const m = desc.match(inlinePattern);
  if (m) return m[1];
  const headingPattern = new RegExp(`##\\s*${headingLabel}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const hm = desc.match(headingPattern);
  if (hm) return hm[1].replace(/^\s*[-*+]\s+/gm, '').trim();
  return '';
}

// Bidirectional + CJK 2-gram overlap matching. The strict (negative) mode ignores pure-ASCII generic words to avoid weak words like "skill" falsely triggering -1000.
function flexHits(text: string, queryNorm: string, queryTerms: string[], strict: boolean): boolean {
  const t = normalizeSearchText(text);
  if (queryNorm && (t.includes(queryNorm) || (!strict && queryNorm.includes(t)))) return true;
  const textTerms = tokenizeFlexible(text);
  return queryTerms.some((term) => {
    if (strict && /^[a-z0-9_-]+$/i.test(term)) return false;
    if (textTerms.includes(term)) return true;
    if (!strict && textTerms.some((tt) => term.includes(tt) && tt.length >= 2)) return true;
    return false;
  });
}

export function scenarioAdjustment(desc: string, queryNorm: string, queryTerms: string[]): number {
  const applicable = extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景');
  const notApplicable = extractScenarioBlock(desc, '不适用场景', '不适用场景|不适用|禁用场景');
  // The -1000 negative only fires when the query hits a word unique to the
  // not-applicable block relative to the applicable block. Ambiguous words that
  // appear in both blocks must NOT trigger -1000; let the +300 applicable bonus or
  // baseline score decide, to avoid killing valid requests.
  if (notApplicable) {
    const distinctTerms = applicable
      ? queryTerms.filter((term) => !flexHits(applicable, term, [term], false))
      : queryTerms;
    if (flexHits(notApplicable, queryNorm, distinctTerms, true)) return -1000;
  }
  if (applicable && flexHits(applicable, queryNorm, queryTerms, false)) return 300;
  return 0;
}

export function scoreLocalSkill(s: LocalSkillIndex, queryNorm: string, queryTerms: string[]): number {
  // Scoring-visible fields are strictly description + the applicable/not-applicable
  // scenario blocks pulled from instructions, excluding Plan 2 index generic metadata
  // (# Local Skill / Activation Notice etc.) to avoid over-importing scoring-visible fields.
  const scenarioFromInstructions = [
    extractScenarioBlock(s.instructions ?? '', '适用场景', '适用场景|适用|使用场景'),
    extractScenarioBlock(s.instructions ?? '', '不适用场景', '不适用场景|不适用|禁用场景'),
  ]
    .filter(Boolean)
    .join('\n');
  const scoringText = `${s.description}\n${scenarioFromInstructions}`;
  const nameNorm = normalizeSearchText(s.name);
  const descNorm = normalizeSearchText(scoringText);
  let score = 0;
  if (queryNorm) {
    if (nameNorm.includes(queryNorm)) score += 800;
    if (descNorm.includes(queryNorm)) score += 400;
  }
  for (const term of queryTerms) {
    if (nameNorm.includes(term)) score += 100;
    if (descNorm.includes(term)) score += 40;
  }
  // Scoring-visible fields (name/desc weights 800/400/100/40) use the narrowed
  // scoringText (excluding Plan 2 index generic metadata). But the scenario bonus/penalty
  // needs the raw applicable/not-applicable labeled text to be re-extracted by scenarioAdjustment,
  // so we feed description + instructions (instructions carry the scenario labels appended at import),
  // avoiding the dead scenarioAdjustment that always returned 0.
  const scenarioAdj = scenarioAdjustment(`${s.description}\n${s.instructions ?? ''}`, queryNorm, queryTerms);
  score += scenarioAdj;
  return score;
}

export function selectImplicitSkill(query: string, skills: LocalSkillIndex[]): LocalSkillIndex | null {
  if (skills.length === 0) return null;
  const queryNorm = normalizeSearchText(query);
  // Tokenize the user query sensibly before scoring: tokenizeFlexible (CJK 2-gram +
  // ASCII/digit as-is) avoids a whole Chinese sentence being treated as a single token
  // and then failing to match the scoring-visible fields.
  const queryTerms = tokenizeFlexible(queryNorm);
  const scored = skills
    .map((s) => ({ s, score: scoreLocalSkill(s, queryNorm, queryTerms) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const overThreshold = top.score >= ACTIVATION_THRESHOLD;
  const leadOk = !second || top.score >= second.score + MIN_LEAD_GAP;
  const activated = overThreshold && leadOk;
  if (!activated) return null;
  return top.s;
}
