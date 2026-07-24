// T4 本地 Skill 激活打分单测。
// 覆盖：selectImplicitSkill 五例（适用场景命中 / 不适用场景命中 / 无相关 / 双弱争激活被双闸拦截 / 名称+描述高分）、
// 以及 scoreLocalSkill / scenarioAdjustment 的精确分量。
//
// 关键语义（来自 local-skill-scoring-spec.md §3 / §3.4 / §3.5）：
//   - normalizeSearchText = NFKC + 小写 + trim；tokenize 按 \p{L}\p{N}_- 切分（中文整句成单 token）。
//   - 整串命中：name +800 / desc +400 / cat +200；逐词命中：name +100 / desc +40 / cat +60。
//   - scenarioAdjustment：适用场景命中 +300，不适用场景命中 -1000。
//   - 阈值双闸：最高分 >= 100 且 最高分 >= 次高分 + 50，否则返回 null。

import { describe, expect, it } from 'vitest';
import {
  type LocalSkillIndex,
  scenarioAdjustment,
  scoreLocalSkill,
  selectImplicitSkill,
} from '../core/skill/local-skill-scorer';

function index(name: string, description: string, skillDir = '/skills/x'): LocalSkillIndex {
  return { name, description, skillDir };
}

describe('scenarioAdjustment', () => {
  it('适用场景命中 → +300', () => {
    expect(scenarioAdjustment('适用场景：生成周报、日报、总结', '周报', ['周报'])).toBe(300);
  });

  it('不适用 / 禁用场景命中 → -1000', () => {
    expect(scenarioAdjustment('通用写作助手。禁用场景：写周报', '周报', ['周报'])).toBe(-1000);
    expect(scenarioAdjustment('不适用场景：写周报', '周报', ['周报'])).toBe(-1000);
  });

  it('无场景标注 → 0', () => {
    expect(scenarioAdjustment('普通描述，与周报无关', '周报', ['周报'])).toBe(0);
  });
});

describe('scoreLocalSkill', () => {
  it('名称逐词 + 描述整串命中累加', () => {
    // 名称 weekly-report 含逐词 weekly/report 各 +100；描述整串命中 weekly report +400、逐词各 +40。
    const score = scoreLocalSkill(
      index('weekly-report', 'Generate weekly report and summary'),
      'weekly report',
      ['weekly', 'report'],
    );
    expect(score).toBe(100 + 100 + 400 + 40 + 40);
  });

  it('不适用场景把正分拉成负分（低于阈值）', () => {
    const score = scoreLocalSkill(
      index('writer', '通用写作助手。禁用场景：写周报'),
      '周报',
      ['周报'],
    );
    // 描述整串命中 +400、逐词 +40；不适用场景 -1000 → -560。
    expect(score).toBe(400 + 40 - 1000);
  });
});

describe('selectImplicitSkill', () => {
  it('空候选 → null', () => {
    expect(selectImplicitSkill('周报', [])).toBeNull();
  });

  it('例1：适用场景命中 → 激活', () => {
    const skills = [index('report', '适用场景：生成周报、日报、总结')];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('report');
  });

  it('例2：不适用场景命中 → 不激活', () => {
    const skills = [index('writer', '通用写作助手。禁用场景：写周报')];
    expect(selectImplicitSkill('周报', skills)).toBeNull();
  });

  it('例3：无相关 Skill → null', () => {
    const skills = [
      index('weather', '查询天气与气象预警'),
      index('news', '新闻摘要与聚合'),
    ];
    expect(selectImplicitSkill('周报', skills)).toBeNull();
  });

  it('例4：双弱候选领先差不足（MIN_LEAD_GAP）→ null', () => {
    // 两个 Skill 均只在描述里出现「周报」整串（+400 +40 = 440），无适用场景加成。
    // 最高分 440 但未超过次高分 440 + 50，触发双闸拦截，避免「两弱争激活」。
    const skills = [
      index('a', '处理周报'),
      index('b', '整理周报'),
    ];
    const picked = selectImplicitSkill('周报', skills);
    expect(picked).toBeNull();
  });

  it('例5：名称逐词 + 描述整串高分 → 激活', () => {
    const skills = [index('weekly-report', 'Generate weekly report and summary')];
    expect(selectImplicitSkill('weekly report', skills)?.name).toBe('weekly-report');
  });

  it('多候选时只返回显著领先且过阈值的那一个', () => {
    const skills = [
      index('report', '适用场景：生成周报、日报、总结'), // 740
      index('digest', '整理会议纪要'), // 0（与「周报」无关）
    ];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('report');
  });
});
