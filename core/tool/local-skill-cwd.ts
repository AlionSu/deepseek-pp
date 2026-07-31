// Core pure function for the local-skill cwd initialization hint (Review #4, Route A).
//
// When a local skill is active, its command-type tool calls (shell_exec /
// shell_session_begin) receive an initial working-directory suggestion of the
// skill's skillDir on the Native Host side, instead of falling back to homedir().
// This is the "initial cwd" layer of the D4 Local Execution Boundary: an Agent call
// issued via <shell_exec> that omits or misstates cwd gets its initial cwd
// normalized to skillDir (persistent session calls via shell_session_exec are also
// re-normalized to skillDir when their cwd is missing or wrong, so the "cwd is skillDir" boundary
// holds for every command-type call, not just the first).
//
// Declarative consistency: this function provides *cwd normalization* for every command-type tool call
// (shell_exec / shell_session_begin / shell_session_exec). When a call omits or misstates cwd, it is
// normalized to the grant-derived skillDir, so the local Skill's "cwd is skillDir" boundary holds for
// all command executions (see pr457-workplan.md §2.4, Route A). A session call whose cwd is already
// skillDir is idempotent; a wrong/missing cwd on any command-type call is still corrected.
//
// Applies only to command-type tools that accept cwd. Tools that take rootPath /
// paths as input (local_file_read / local_file_write / local_file_stat /
// local_skill_preview) are out of scope (no cwd semantics, forcing is meaningless).

import type { ToolPayload } from './types';

const CWD_ENFORCED_INVOCATIONS = new Set(['shell_exec', 'shell_session_begin', 'shell_session_exec']);

export function isCwdEnforcedInvocation(invocationName: string): boolean {
  return CWD_ENFORCED_INVOCATIONS.has(invocationName);
}

/**
 * Normalize the initial cwd for command-type tool calls when a local skill is
 * active, per Review #4 Route A and the Review #2 #7 (P1) fix:
 * - cwd missing (undefined): set to the grant-derived skillDir (initial cwd hint).
 * - cwd === skillDir (Agent supplied the correct directory): returned as-is (idempotent).
 * - cwd present but !== skillDir (wrong / misstated): OVERWRITTEN with the
 *   grant-derived skillDir, so a wrong cwd can never execute a shell command
 *   outside the Skill directory. This honors the "error cwd normalized to Skill
 *   directory" promise and fixes the P1 where any caller-supplied cwd silently
 *   overrode the grant's skillDir.
 * 说明：对所有命令型调用（含会话续发的 shell_session_exec）归一化 cwd。cwd 已为 skillDir 的调用幂等；
 * 任意命令型调用若 cwd 缺失或错误，均被纠正为 skillDir，从而闭合 GAP-2（"cwd 恒为 skillDir 硬边界未成立"）。
 */
export function enforceLocalSkillCwd(
  payload: ToolPayload,
  invocationName: string,
  skillDir: string | undefined,
): ToolPayload {
  if (!skillDir || !skillDir.trim()) return payload;
  if (!isCwdEnforcedInvocation(invocationName)) return payload;
  if (payload.cwd === skillDir) return payload;
  return { ...payload, cwd: skillDir };
}
