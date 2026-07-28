// 本地 Skill cwd 初始化提示（评审 #4 路线 A）的核心纯函数。
//
// 当某个 local skill 处于激活态时，其命令型工具调用（shell_exec /
// shell_session_begin）在 Native Host 侧「初始」以该 skill 的 skillDir 为工作目录建议值，
// 而非回退到 homedir()。这是 D4「Local Execution Boundary」在「初始 cwd」层面的落实：Agent 在聊天里
// 经 <shell_exec> 发出的调用，若未显式给出 cwd 或给错，这里把初始 cwd 归一化为 skillDir
// （会话后续调用可经 shell_session_exec 复用会话既有 cwd，本函数不再重复强制）。
//
// 说明（声明自洽）：本函数给出的是「初始 cwd 提示」，不是对会话全周期的硬性持久绑定；
// 持久会话 cwd 由 shell 会话注册表既有语义保持，本 PR 不额外做会话-Skill 强绑定（见 pr457-workplan.md §2.4 路线 A）。
//
// 只作用于接受 cwd 的命令型工具；local_file_read / local_file_write / local_file_stat /
// local_skill_preview 等以 rootPath / paths 入参的工具不在此列（无 cwd 语义，强设无意义）。

import type { ToolPayload } from './types';

const CWD_ENFORCED_INVOCATIONS = new Set(['shell_exec', 'shell_session_begin']);

export function isCwdEnforcedInvocation(invocationName: string): boolean {
  return CWD_ENFORCED_INVOCATIONS.has(invocationName);
}

/**
 * 若 skillDir 非空且调用属于命令型工具，则把 payload.cwd 初始化/归一化为 skillDir（初始 cwd 提示）。
 * - cwd 已等于 skillDir：原样返回（不复制对象）。
 * - cwd 缺失或不同：返回新对象并设置 cwd = skillDir（不修改入参）。
 * - skillDir 为空 / 非命令型工具：原样返回。
 * 说明：仅设定初始 cwd；持久会话的 cwd 复用由 shell 会话注册表既有语义负责（评审 #4 路线 A）。
 */
export function enforceLocalSkillCwd(
  payload: ToolPayload,
  invocationName: string,
  skillDir: string | undefined,
): ToolPayload {
  if (!skillDir || !skillDir.trim()) return payload;
  if (!isCwdEnforcedInvocation(invocationName)) return payload;
  if (payload.cwd !== undefined && payload.cwd === skillDir) return payload;
  return { ...payload, cwd: skillDir };
}
