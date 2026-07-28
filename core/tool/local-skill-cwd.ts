// Core pure function for the local-skill cwd initialization hint (Review #4, Route A).
//
// When a local skill is active, its command-type tool calls (shell_exec /
// shell_session_begin) receive an initial working-directory suggestion of the
// skill's skillDir on the Native Host side, instead of falling back to homedir().
// This is the "initial cwd" layer of the D4 Local Execution Boundary: an Agent call
// issued via <shell_exec> that omits or misstates cwd gets its initial cwd
// normalized to skillDir (later session calls reuse the existing session cwd via
// shell_session_exec, and this function does not re-force it).
//
// Declarative consistency: this function provides an *initial cwd hint*, not a
// hard session-wide binding. Persistent session cwd is owned by the shell-session
// registry semantics; this PR adds no skill-session hard binding (see pr457-workplan.md §2.4, Route A).
//
// Applies only to command-type tools that accept cwd. Tools that take rootPath /
// paths as input (local_file_read / local_file_write / local_file_stat /
// local_skill_preview) are out of scope (no cwd semantics, forcing is meaningless).

import type { ToolPayload } from './types';

const CWD_ENFORCED_INVOCATIONS = new Set(['shell_exec', 'shell_session_begin']);

export function isCwdEnforcedInvocation(invocationName: string): boolean {
  return CWD_ENFORCED_INVOCATIONS.has(invocationName);
}

/**
 * If skillDir is non-empty and the call is a command-type tool, set payload.cwd to
 * skillDir only when cwd is missing (initial cwd hint).
 * - cwd already present (any value): returned as-is (caller-supplied cwd wins).
 * - cwd missing and skillDir valid: returns a new object with cwd = skillDir (does not mutate input).
 * - skillDir empty / non-command tool: returned as-is.
 * Note: only sets the initial cwd; persistent session cwd reuse is owned by the
 * shell-session registry semantics (Review #4, Route A).
 */
export function enforceLocalSkillCwd(
  payload: ToolPayload,
  invocationName: string,
  skillDir: string | undefined,
): ToolPayload {
  if (!skillDir || !skillDir.trim()) return payload;
  if (!isCwdEnforcedInvocation(invocationName)) return payload;
  if (payload.cwd !== undefined) return payload;
  return { ...payload, cwd: skillDir };
}
