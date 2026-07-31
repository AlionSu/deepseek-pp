// Local-skill activation scoring (implicit branch).
// Customized after the scoring paradigm in core/mcp/capability-projection.ts:
// reuses normalizeSearchText / tokenize, drops the pinned dimension (no pinning
// concept), and adds an "applicable / not-applicable scenario" adjustment
// (description-led).
// Enabled only for local indexed skills; does not affect builtin / bundled / imported-github.
//
// Design source: .workbuddy/memory/local-skill-scoring-spec.md (§3 weight table,
// §3.4 scenarioAdjustment, §3.5 threshold dual-gate).
//
// P1-B / P1-C 修改（PR #457 三审）：
//  - scenarioAdjustment 固定 +300 改为 F0-A 覆盖率驱动动态加成（≥0.6 → round(cov*100)，封顶 +100）。
//  - selectImplicitSkill 新增泛词闸门（查询仅由 ≤2 个常见二字词构成 → 不激活）。
//  - 2 字查询不再吃描述整串 +400（仅查询整串规范化后长度 ≥ 3 才给）。
//  - scoreLocalSkill 基础分净化：scoringText 仅含 description + applicable 块，剔除 notApplicable 正向打分。
//  - extractScenarioBlock 负向后顾 (?<!不) + heading 负向防御 (?!不)，防止"适用场景"作为"不适用场景"子串误匹配，同时保留行内合法负向标注。

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

// 常见二字词否定表（泛词闸门，P1-B 修法1）：查询仅由这些弱特异性词构成时，
// 仅凭"共享一个常见二字词"不得激活本地 Skill（如"财务"不得误激活财务报表类 Skill）。
// 注意：特定场景词（如"周报""报表生成"）不应列入，否则会误杀真实适用场景命中。
const COMMON_TWO_CHAR_NEGATIVE_WORDS = new Set<string>([
  '财务', '新闻', '报告', '报表', '分析', '数据', '文件', '信息', '内容', '总结',
  '查询', '搜索', '处理', '管理', '生成', '编写', '检查', '说明',
]);

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

// 泛词闸门（P1-B 修法1）：查询规范化后仅由 ≤2 个常见二字词构成 → 视为弱共享，直接不激活。
function isGenericNegativeQuery(queryNorm: string): boolean {
  const words = queryNorm.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) => COMMON_TWO_CHAR_NEGATIVE_WORDS.has(w));
}

// 场景块覆盖率（F0-A，P1-B）：共享 2-gram 数 / 查询 2-gram 总数。
// 用于替代固定 +300，只有当查询至少 60% 的 2-gram 碎片也出现在适用场景文本时才给加成。
function scenarioCoverage(applicableText: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const textTerms = new Set(tokenizeFlexible(applicableText));
  const hits = queryTerms.filter((t) => textTerms.has(t)).length;
  return hits / queryTerms.length;
}

// Supports two scenario-section writing styles (applicable / not-applicable):
//  1) inline "label: content" (with ASCII or full-width colon)
//  2) markdown heading (e.g. "## 适用场景") up to the next "## " heading or EOF (standard SKILL.md style)
// The original implementation only supported style 1, so local Skills using the
// standard markdown heading style never received the applicable-scenario bonus.
//
// P1-C：负向后顾 (?<!不) 替代行首锚，防止"适用场景"作为"不适用场景"子串被误匹配，
// 同时保留行内合法负向标注（如"禁用场景：写周报"）的匹配；
// headingPattern 负向防御 (?!不)，防止 "## 不适用场景" 被适用场景 heading 误抓。
export function extractScenarioBlock(desc: string, headingLabel: string, inlineLabels: string): string {
  const inlinePattern = new RegExp(
    `(?<!不)(?:${inlineLabels})[：:]\\s*([\\s\\S]*?)(?=\\n#{1,3}\\s|\\n\\s*(?:适用场景|适用|使用场景|不适用场景|不适用|禁用场景)[：:]|$)`,
    'i',
  );
  const m = desc.match(inlinePattern);
  if (m) return m[1];
  const headingPattern = new RegExp(`##\\s*(?!不)${headingLabel}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
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
  // appear in both blocks must NOT trigger -1000; let the applicable bonus or
  // baseline score decide, to avoid killing valid requests.
  if (notApplicable) {
    const distinctTerms = applicable
      ? queryTerms.filter((term) => !flexHits(applicable, term, [term], false))
      : queryTerms;
    if (flexHits(notApplicable, queryNorm, distinctTerms, true)) return -1000;
  }
  // P1-B（F0-A）：覆盖率驱动动态加成，替代固定 +300。
  // coverage ≥ 0.6 才给加成，round(coverage*100) 封顶 +100；避免最弱语言单元(2-gram)
  // 触发最强相关性(+300)判据的语义粒度错误（如查询"财务"误激活财务报表类 Skill）。
  if (applicable) {
    const coverage = scenarioCoverage(applicable, queryTerms);
    if (coverage >= 0.6) return Math.min(100, Math.round(coverage * 100));
  }
  return 0;
}

export function scoreLocalSkill(s: LocalSkillIndex, queryNorm: string, queryTerms: string[]): number {
  // P1-B 基础分净化：scoringText 仅含 description + applicable 块，剔除 notApplicable 块正向打分
  // （修复 B10 误激活：不适用场景块中的词不再贡献正向基础分）。
  const applicableFromInstructions = extractScenarioBlock(
    s.instructions ?? '',
    '适用场景',
    '适用场景|适用|使用场景',
  );
  const scoringText = [s.description, applicableFromInstructions].filter(Boolean).join('\n');
  const nameNorm = normalizeSearchText(s.name);
  const descNorm = normalizeSearchText(scoringText);
  let score = 0;
  if (queryNorm) {
    if (nameNorm.includes(queryNorm)) score += 800;
    // P1-B 修法3：仅当查询整串（规范化后）长度 ≥ 3 时才给描述整串 +400，
    // 避免 2 字查询（如"周报"）仅凭一个常见 2-gram 命中描述即获 +400 高分而误激活。
    if (descNorm.includes(queryNorm) && queryNorm.length >= 3) score += 400;
  }
  for (const term of queryTerms) {
    if (nameNorm.includes(term)) score += 100;
    if (descNorm.includes(term)) score += 40;
  }
  // Scoring-visible fields (name/desc weights 800/400/100/40) use the narrowed
  // scoringText (excluding Plan 2 index generic metadata + not-applicable block).
  // scenarioAdjustment needs the raw applicable/not-applicable labeled text re-extracted
  // from description + instructions (instructions carry the scenario labels appended at import).
  const scenarioAdj = scenarioAdjustment(`${s.description}\n${s.instructions ?? ''}`, queryNorm, queryTerms);
  score += scenarioAdj;
  return score;
}

export function selectImplicitSkill(query: string, skills: LocalSkillIndex[]): LocalSkillIndex | null {
  if (skills.length === 0) return null;
  const queryNorm = normalizeSearchText(query);
  // P1-B 修法1：泛词闸门。查询仅由 ≤2 个常见二字词构成（如"财务""新闻 报表"）→ 直接不激活，
  // 避免"仅共享一个常见二字词"即错误激活本地 Skill。
  if (isGenericNegativeQuery(queryNorm)) return null;
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
