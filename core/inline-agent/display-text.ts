import {
  extractTaskCompleteSignal,
  stripDanglingLeadingPunctuation,
  TASK_COMPLETE_BLOCK_RE,
} from './prompt';

/**
 * Display-layer answer extraction (Issue #551, pivoted by UI review): the
 * user-facing answer is the FULL final-turn reply text with the internal
 * `<task_complete>` control block stripped. Real deliverables live in the
 * reply body — a summary-only split hid them inside a collapsed step — so the
 * answer area always renders the complete body, never folded or truncated.
 * The signal summary remains a fallback for runs whose pre-signal text is
 * empty, so a malformed completion never hides the answer.
 *
 * Kept out of {@link ./prompt} because that module is shared into the
 * sidepanel initial shell; this display-only logic is used exclusively by the
 * content-script renderer, so it lives in its own bundle slice.
 */
export function getInlineAgentAnswerText(text: string): string {
  const body = stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
  if (body) return body;
  return extractTaskCompleteSignal(text)?.summary.trim() ?? '';
}

/**
 * Display-layer process/step text: the model's working notes with the
 * internal `<task_complete>` control block removed entirely.
 */
export function getInlineAgentProcessText(text: string): string {
  return stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
}
