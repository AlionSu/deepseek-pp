/**
 * Deterministic auto-save policy for long inline-agent outputs (#497).
 *
 * A final agent answer is auto-saved as an artifact only when it is long
 * enough to be a real long-form output and the loop did not already persist output
 * through an explicit save/write tool.
 */

export const AGENT_OUTPUT_AUTO_SAVE_MIN_CHARS = 5000;
export const AGENT_OUTPUT_AUTO_SAVE_MAX_BYTES = 2_000_000;

const AGENT_OUTPUT_SAVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'artifact_create',
  'artifact_bundle_create',
  'local_file_write',
]);

export function shouldAutoSaveAgentOutput(
  finalText: string,
  executedToolNames: readonly string[],
): boolean {
  if (!finalText || finalText.trim().length < AGENT_OUTPUT_AUTO_SAVE_MIN_CHARS) return false;
  return !executedToolNames.some((name) => AGENT_OUTPUT_SAVE_TOOL_NAMES.has(name));
}
