// 本地 Skill 激活打分（隐式分支）。
// 以 core/mcp/capability-projection.ts 的评分范式为蓝本定制：复用 normalizeSearchText / tokenize，
// 去掉 pinned 维度（无置顶概念），并新增"适用/不适用场景"调整（description 主导）。
// 仅对本地索引 Skill 启用，不波及 builtin / bundled / imported-github。
//
// 设计来源：.workbuddy/memory/local-skill-scoring-spec.md（§3 权重表、§3.4 scenarioAdjustment、§3.5 阈值双闸）。

import { normalizeSearchText, tokenize } from '../mcp/capability-projection';

export interface LocalSkillIndex {
  name: string;
  description: string;
  category?: string;
  skillDir: string;
}

// 阈值双闸：最低激活分 + 显著领先差（防"两弱争激活"）。
const ACTIVATION_THRESHOLD = 100;
const MIN_LEAD_GAP = 50;

function extractScenario(desc: string, labelRegex: RegExp): string {
  // 标签后的冒号须同时兼容半角(:)与全角(：)，否则像「适用场景：生成周报」这类
  // 用全角冒号的场景标注会被漏匹配（applicable/notApplicable 抽为空 → scenarioAdjustment 恒返 0）。
  const pattern = new RegExp(
    labelRegex.source + String.raw`[：:]\s*([\s\S]*?)(?=\n#{1,3}\s|\n[A-Za-z一-龥]{2,}[：:]|$)`,
    'i',
  );
  const m = desc.match(pattern);
  return m ? m[2] : '';
}

function hits(text: string, queryNorm: string, queryTerms: string[]): boolean {
  const t = normalizeSearchText(text);
  if (queryNorm && t.includes(queryNorm)) return true;
  return queryTerms.some((term) => t.includes(term));
}

export function scenarioAdjustment(desc: string, queryNorm: string, queryTerms: string[]): number {
  const applicable = extractScenario(desc, /(适用场景|适用|使用场景)/i);
  const notApplicable = extractScenario(desc, /(不适用场景|不适用|禁用场景)/i);
  if (notApplicable && hits(notApplicable, queryNorm, queryTerms)) return -1000;
  if (applicable && hits(applicable, queryNorm, queryTerms)) return 300;
  return 0;
}

export function scoreLocalSkill(s: LocalSkillIndex, queryNorm: string, queryTerms: string[]): number {
  const nameNorm = normalizeSearchText(s.name);
  const descNorm = normalizeSearchText(s.description);
  const catNorm = s.category ? normalizeSearchText(s.category) : '';
  let score = 0;
  if (queryNorm) {
    if (nameNorm.includes(queryNorm)) score += 800;
    if (descNorm.includes(queryNorm)) score += 400;
    if (catNorm && catNorm.includes(queryNorm)) score += 200;
  }
  for (const term of queryTerms) {
    if (nameNorm.includes(term)) score += 100;
    if (descNorm.includes(term)) score += 40;
    if (catNorm && catNorm.includes(term)) score += 60;
  }
  score += scenarioAdjustment(s.description, queryNorm, queryTerms);
  return score;
}

export function selectImplicitSkill(query: string, skills: LocalSkillIndex[]): LocalSkillIndex | null {
  if (skills.length === 0) return null;
  const queryNorm = normalizeSearchText(query);
  const queryTerms = tokenize(queryNorm);
  const scored = skills
    .map((s) => ({ s, score: scoreLocalSkill(s, queryNorm, queryTerms) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (top.score < ACTIVATION_THRESHOLD) return null;
  if (second && top.score < second.score + MIN_LEAD_GAP) return null;
  return top.s;
}
