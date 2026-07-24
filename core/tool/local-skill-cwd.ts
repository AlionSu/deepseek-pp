// 方案A（扩展侧 cwd 硬强制）的核心纯函数。
//
// 当某个 local skill 处于激活态时，其所有命令型工具调用（shell_exec /
// shell_session_begin）都应当在 Native Host 侧以该 skill 的 skillDir 为工作目录执行，
// 而非回退到 homedir()。这是 D4「Local Execution Boundary」的硬落实：Agent 在聊天里
// 经 <shell_exec> 发出的调用，若未显式给出 cwd 或给错，这里强制归一化为 skillDir。
//
// 只作用于接受 cwd 的命令型工具；local_file_read / local_file_write / local_file_stat /
// local_skill_preview 等以 rootPath / paths 入参的工具不在此列（无 cwd 语义，强设无意义）。

import type { ToolPayload } from './types';

const CWD_ENFORCED_INVOCATIONS = new Set(['shell_exec', 'shell_session_begin']);

export function isCwdEnforcedInvocation(invocationName: string): boolean {
  return CWD_ENFORCED_INVOCATIONS.has(invocationName);
}

/**
 * 若 skillDir 非空且调用属于命令型工具，则把 payload.cwd 强制/归一化为 skillDir。
 * - cwd 已等于 skillDir：原样返回（不复制对象）。
 * - cwd 缺失或不同：返回新对象并设置 cwd = skillDir（不修改入参）。
 * - skillDir 为空 / 非命令型工具：原样返回。
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
