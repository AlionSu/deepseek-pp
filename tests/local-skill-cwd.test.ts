// 本地 Skill cwd「初始 cwd 提示」（评审 #4 路线 A）单测：
//   1) enforceLocalSkillCwd 纯函数：仅对 shell_exec / shell_session_begin 在「初始 cwd」层面归一化 cwd=skillDir。
//   2) parseExternalizedToolPayload 落点：当传入 skillDir 时，命令型工具的「初始 cwd」被归一化。
//   3) 声明自洽：本层仅设定初始 cwd，不持久绑定会话（持久会话 cwd 复用由 shell 会话注册表既有语义负责）。

import { describe, expect, it } from 'vitest';
import { enforceLocalSkillCwd, isCwdEnforcedInvocation } from '../core/tool/local-skill-cwd';
import { parseExternalizedToolPayload } from '../core/tool/externalized-payload';

describe('enforceLocalSkillCwd', () => {
  it('shell_exec 未给 cwd → 强制为 skillDir', () => {
    const out = enforceLocalSkillCwd({ command: 'ls' }, 'shell_exec', '/skills/demo');
    expect(out.cwd).toBe('/skills/demo');
  });

  it('shell_exec 给了错误 cwd → 覆盖为 skillDir', () => {
    const out = enforceLocalSkillCwd({ command: 'ls', cwd: '/somewhere/else' }, 'shell_exec', '/skills/demo');
    expect(out.cwd).toBe('/skills/demo');
  });

  it('shell_exec cwd 已等于 skillDir → 原样返回（不复制）', () => {
    const payload = { command: 'ls', cwd: '/skills/demo' };
    const out = enforceLocalSkillCwd(payload, 'shell_exec', '/skills/demo');
    expect(out).toBe(payload);
  });

  it('skillDir 为空 → 不改 payload', () => {
    const payload = { command: 'ls' };
    expect(enforceLocalSkillCwd(payload, 'shell_exec', '')).toBe(payload);
    expect(enforceLocalSkillCwd(payload, 'shell_exec', undefined)).toBe(payload);
  });

  it('local_file_read（无 cwd 语义）→ 不强制', () => {
    const payload = { rootPath: '/skills/demo', selectedPaths: ['SKILL.md'] };
    const out = enforceLocalSkillCwd(payload, 'local_file_read', '/skills/demo');
    expect(out.cwd).toBeUndefined();
    expect(out.rootPath).toBe('/skills/demo');
  });

  it('isCwdEnforcedInvocation 仅覆盖命令型工具', () => {
    expect(isCwdEnforcedInvocation('shell_exec')).toBe(true);
    expect(isCwdEnforcedInvocation('shell_session_begin')).toBe(true);
    expect(isCwdEnforcedInvocation('local_file_read')).toBe(false);
    expect(isCwdEnforcedInvocation('local_skill_preview')).toBe(false);
  });
});

describe('parseExternalizedToolPayload cwd 强制落点', () => {
  it('shell_exec 解析时携带 skillDir → cwd 被强制', () => {
    const { payload, parseError } = parseExternalizedToolPayload(
      '{"command":"ls"}',
      'shell_exec',
      '/skills/demo',
    );
    expect(parseError).toBeUndefined();
    expect(payload?.cwd).toBe('/skills/demo');
  });

  it('不传 skillDir → cwd 不被强制（保持 Agent 原意或缺失）', () => {
    const { payload } = parseExternalizedToolPayload('{"command":"ls"}', 'shell_exec');
    expect(payload?.cwd).toBeUndefined();
  });

  it('local_file_read 不强制 cwd', () => {
    const { payload } = parseExternalizedToolPayload(
      '{"rootPath":"/skills/demo"}',
      'local_file_read',
      '/skills/demo',
    );
    expect(payload?.cwd).toBeUndefined();
  });
});

describe('声明自洽（评审 #4 路线 A）：仅初始 cwd 提示，不持久绑定会话', () => {
  it('enforceLocalSkillCwd 不修改原 payload 对象（只返回新对象表达初始 cwd）', () => {
    const original = { command: 'ls', cwd: '/somewhere/else' };
    const out = enforceLocalSkillCwd(original, 'shell_exec', '/skills/demo');
    // 初始 cwd 被归一化为 skillDir
    expect(out.cwd).toBe('/skills/demo');
    // 原对象不被改动（无副作用，契合"提示"语义而非"持久绑定"）
    expect(original.cwd).toBe('/somewhere/else');
  });

  it('shell_session_exec（会话复用既有 cwd）不在本层被强制', () => {
    const payload = { command: 'ls', sessionId: 's1', cwd: '/skills/demo' };
    // 会话执行命令非 CWD_ENFORCED_INVOCATIONS 成员（仅 begin 加入强制），本层不影响其 cwd 复用
    expect(isCwdEnforcedInvocation('shell_session_exec')).toBe(false);
  });
});
