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

/**
 * Resolve the user-facing final answer of a completed run from its two
 * candidate sources (Issue #551 follow-up): the loop's resolved final text
 * `finalAnswer` and the last step's rendered text `lastStepText` (the same
 * final turn as it was streamed). When one is an exact prefix of the other
 * they provably share an origin and the longer one is the complete reply —
 * traces persisted by older builds stored a summary/prefix as `finalText`
 * while the full reply (e.g. a generated HTML document) only survived in the
 * last step. Unrelated texts keep `finalAnswer` (budget notices, legacy
 * summary-split runs). `fromStep` tells the caller the step body IS the
 * answer and may be cleared without a further equality check.
 */
export function resolveInlineAgentAnswerText(
  finalAnswer: string,
  lastStepText: string,
): { answer: string; fromStep: boolean } {
  if (!lastStepText) return { answer: finalAnswer, fromStep: false };
  if (!finalAnswer) return { answer: lastStepText, fromStep: true };
  if (lastStepText === finalAnswer) return { answer: finalAnswer, fromStep: false };
  if (lastStepText.startsWith(finalAnswer)) return { answer: lastStepText, fromStep: true };
  if (finalAnswer.startsWith(lastStepText)) return { answer: finalAnswer, fromStep: false };
  return { answer: finalAnswer, fromStep: false };
}
