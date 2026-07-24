// T5 D1 路径改写器单测。
// 覆盖：joinUnderRoot 双基/越界、isAbsolutePath、absolutizeSkillReferences 的
// 「双基探测绝对化」「URL/锚点/绝对路径/家目录占位不改写」「文件不存在保留原样」「代码块（fenced/inline）内引用跳过改写」。
//
// 设计来源：local-skill-import-design.md §2.5。算法（双基探测）：
//   1) 先 join(thisFileDir, rel)，fileExists 存在 → 用；
//   2) 否则 join(skillDir, rel)，fileExists 存在 → 用；
//   3) 都不存在 → 保留原样（不误伤 URL / 绝对路径 / 占位 / `..` 越界）。

import { describe, expect, it } from 'vitest';
import {
  absolutizeSkillReferences,
  isAbsolutePath,
  joinUnderRoot,
} from '../core/skill/local-path-rewriter';

describe('joinUnderRoot', () => {
  it('在根下拼接相对路径', () => {
    expect(joinUnderRoot('/skills/demo', 'references/guide.md')).toBe('/skills/demo/references/guide.md');
  });

  it('向上一级（..）解析', () => {
    expect(joinUnderRoot('/skills/demo', '../sibling.md')).toBe('/skills/sibling.md');
  });

  it('越界（逃出 root）→ null', () => {
    expect(joinUnderRoot('/skills/demo', '../../../escape.md')).toBeNull();
  });

  it('保留点号（.）', () => {
    expect(joinUnderRoot('/skills/demo', './guide.md')).toBe('/skills/demo/guide.md');
  });
});

describe('isAbsolutePath', () => {
  it('Windows 盘符视为绝对路径', () => {
    expect(isAbsolutePath('C:\\skills\\demo')).toBe(true);
    expect(isAbsolutePath('D:/skills/demo')).toBe(true);
  });

  it('类 Unix 绝对路径', () => {
    expect(isAbsolutePath('/skills/demo')).toBe(true);
  });

  it('相对路径 / 家目录占位不是绝对路径', () => {
    expect(isAbsolutePath('references/guide.md')).toBe(false);
    expect(isAbsolutePath('~/notes.md')).toBe(false);
  });
});

describe('absolutizeSkillReferences', () => {
  const skillDir = '/skills/demo';
  const thisFileDir = '/skills/demo/sub';

  it('双基探测：thisFileDir 命中优先', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/sub/references/guide.md',
    });
    expect(out).toBe('见 [指南](/skills/demo/sub/references/guide.md)');
  });

  it('双基探测：thisFileDir 缺失则回退 skillDir', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    expect(out).toBe('见 [指南](/skills/demo/references/guide.md)');
  });

  it('两基都不存在 → 保留原样', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => false,
    });
    expect(out).toBe(text);
  });

  it('URL 不改写', () => {
    const text = '见 [文档](https://example.com/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('锚点不改写', () => {
    const text = '见 [章节](#section)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('已是绝对路径不改写', () => {
    const text = '见 [文档](/already/absolute.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('家目录占位（~）不改写', () => {
    const text = '见 [笔记](~/notes.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('相对路径会逃出 skillDir 根 → 不改写（防逃逸）', () => {
    const text = '见 [越界](../../etc/secrets.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('一次改写多个引用', () => {
    const text = '见 [甲](a.md) 与 [乙](b.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => abs === '/skills/demo/a.md' || abs === '/skills/demo/b.md',
    });
    expect(out).toBe('见 [甲](/skills/demo/a.md) 与 [乙](/skills/demo/b.md)');
  });

  it('跳过 fenced 代码块内的伪链接（不改写）', () => {
    const text = [
      '见 [真实链接](references/guide.md)',
      '',
      '```',
      '示例：[example](references/guide.md)',
      '```',
    ].join('\n');
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    // 非代码区的真实链接被改写，代码块内的示例链接保留相对路径。
    expect(out).toContain('[真实链接](/skills/demo/references/guide.md)');
    expect(out).toContain('[example](references/guide.md)');
    // 代码块结构保持完整。
    expect(out).toContain('```');
  });

  it('跳过 inline code 内的伪链接（不改写）', () => {
    const text = '说明：`[example](references/guide.md)` 是示例，而 [真实链接](references/guide.md) 会改写。';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    expect(out).toContain('`[example](references/guide.md)`');
    expect(out).toContain('[真实链接](/skills/demo/references/guide.md)');
  });
});
