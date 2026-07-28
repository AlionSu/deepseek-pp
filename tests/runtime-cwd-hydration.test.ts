// cwd hydration 双分支回归（响应评审 #1 / 第二次评审行内 #1）：
// 验证 resolveToolCallPayload 在「普通 XML / legacy DSML」与「externalized」两条路径
// 都从 grant 派生 cwd（不重新信任 call 字段），且未绑定 Skill 授权时不注入。
//
// 关键约束：cwd 仅从 getGrantLocalSkillDir(grant.id) 派生；普通分支经授权层统一输出的
// externalPayloadNamespace（= grant.id）取得，无 Skill 授权时为 undefined → 不注入。

import { describe, expect, it, vi, beforeEach } from 'vitest';

const TEST_SKILL_DIR = '/skills/demo';

// 在导入 runtime 之前拦截 authorization 的 getGrantLocalSkillDir，避免触碰真实 state。
vi.mock('../core/tool/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/tool/authorization')>();
  return {
    ...actual,
    getGrantLocalSkillDir: vi.fn(async (grantId: string): Promise<string | undefined> => {
      return grantId === 'grant-1' ? TEST_SKILL_DIR : undefined;
    }),
  };
});

import { resolveToolCallPayload } from '../core/tool/runtime';
import type { ToolCall } from '../core/tool/types';

function normalCall(invocationName: string, cwd?: string): ToolCall {
  const payload: Record<string, unknown> = { command: 'ls' };
  if (cwd !== undefined) payload.cwd = cwd;
  return {
    id: 'call-1',
    descriptorId: 'local:test:sample_tool',
    name: invocationName,
    invocationName,
    payload: payload as ToolCall['payload'],
    raw: '<tool_call/>',
  };
}

describe('resolveToolCallPayload cwd hydration — normal (inline XML) branch', () => {
  it('经 Skill 授权的普通 shell_exec 调用 → cwd 被注入为 grant 的 skillDir', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });

  it('普通 shell_exec 已给合法 cwd → 保留调用方原值（幂等：仅缺失时注入）', async () => {
    const call = normalCall('shell_exec', '/somewhere/else');
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBe('/somewhere/else');
  });

  it('非命令型工具（local_file_read）→ cwd 不注入', async () => {
    const call: ToolCall = {
      id: 'call-2',
      descriptorId: 'local:test:file_read',
      name: 'local_file_read',
      invocationName: 'local_file_read',
      payload: { rootPath: '/skills/demo', selectedPaths: ['SKILL.md'] } as ToolCall['payload'],
      raw: '<tool_call/>',
    };
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });

  it('未绑定 Skill 授权（externalPayloadNamespace 为 undefined）→ cwd 不注入', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, undefined);
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });

  it('未绑定 Skill 授权（grant 无 localSkillDir）→ cwd 不注入', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, 'no-skill-grant');
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });
});

describe('resolveToolCallPayload cwd hydration — externalized branch (regression)', () => {
  it('externalized payload 仍从 grant 派生 cwd（不回归，派生函数被调用）', async () => {
    const { getGrantLocalSkillDir } = await import('../core/tool/authorization');
    const spy = vi.mocked(getGrantLocalSkillDir);

    // externalized payload 需要真实的 ref 解析；此处仅确认 externalized 分支仍调用派生函数
    // （完整 externalized 解析由 tool-runtime-externalized-payload.test.ts 覆盖）。
    const call: ToolCall = {
      id: 'call-3',
      descriptorId: 'local:test:sample_tool',
      name: 'shell_exec',
      invocationName: 'shell_exec',
      payload: {
        ref: 'nonexistent-ref',
        invocationName: 'shell_exec',
      } as ToolCall['payload'],
      raw: '<tool_call/>',
    };
    await resolveToolCallPayload(call, 'grant-1');
    // externalized 分支必须调用 getGrantLocalSkillDir（派生 cwd），证明未退化为"不注入"
    expect(spy).toHaveBeenCalledWith('grant-1');
  });
});
