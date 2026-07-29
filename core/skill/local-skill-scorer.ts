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

// 中文友好的分词：英文/数字/下划线/连字符按原 tokenize；中文连续段做 2-gram，兼顾整串匹配。
// 解决原 tokenize 把中文整句成单 token、导致"适用场景"命中加分的双向匹配永远失败的问题。
export function tokenizeFlexible(value: string): string[] {
  const norm = normalizeSearchText(value);
  const base = tokenize(norm);
  const result = new Set(base);
  const cjk = norm.match(/[一-鿿]+/g) ?? [];
  for (const seg of cjk) {
    if (seg.length === 1) {
      result.add(seg);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) result.add(seg.slice(i, i + 2));
  }
  return [...result];
}

// 兼容两种适用/不适用场景写法：
//  1) 行内 "标签：内容"（带半角/全角冒号）
//  2) markdown 标题 "## 适用场景" ... 到下一个 "## " 标题或文件尾（标准 SKILL.md 写法）
// 原实现只支持格式 1，导致标准 markdown 标题格式的本地 Skill 永远拿不到 +300 适用场景加分。
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

// 双向 + 中文 2-gram 重叠匹配。strict（负向）模式忽略纯英文泛词，避免 "skill" 类弱词误触发 -1000。
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
  // 负向 -1000 仅在 query 命中「不适用场景」中相对「适用场景」独有的词时触发：
  // 若某词同时出现在两者（如「目录」既在「本地项目目录」也在「系统目录」），属歧义词，
  // 不应触发 -1000，交由适用场景 +300 或基线评分决定，避免合法请求被误杀。
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
  // 评分可见字段严格 = description + 正文中「适用/不适用场景」块：从 instructions 提取场景，
  // 排除 Plan 2 index 通用元数据（# Local Skill / Activation Notice 等），避免过度导入评分可见字段
  // （用户要求：只从 description 字段与正文中明确出现适用/不适用场景的字段提取导入，不全量导入正文）。
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
  // 评分可见字段（name/desc 的 800/400/100/40）用收窄后的 scoringText（排除 Plan 2 index 通用元数据）；
  // 但场景加分/减分需带「适用/不适用场景」标签的原始文本才能被 scenarioAdjustment 重新抽到，
  // 故此处喂 description + instructions（instructions 含导入时追加的场景段标签），避免 scenarioAdjustment 恒返回 0 的死代码。
  const scenarioAdj = scenarioAdjustment(`${s.description}\n${s.instructions ?? ''}`, queryNorm, queryTerms);
  score += scenarioAdj;
  return score;
}

export function selectImplicitSkill(query: string, skills: LocalSkillIndex[]): LocalSkillIndex | null {
  if (skills.length === 0) return null;
  const queryNorm = normalizeSearchText(query);
  // 用户输入长句做合理分词后再评分：用 tokenizeFlexible（中文 2-gram + 英文/数字原 tokenize），
  // 避免中文整句被 tokenize 当成单个 token 后直接与评分可见字段比较而无法命中。
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
