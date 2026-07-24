// 方案A（扩展侧 cwd 硬强制）单测：
//   1) enforceLocalSkillCwd 纯函数：仅对 shell_exec / shell_session_begin 强制 cwd=skillDir。
//   2) parseExternalizedToolPayload 落点：当传入 skillDir 时，命令型工具的 cwd 被归一化。

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
