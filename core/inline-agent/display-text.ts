import {
  extractTaskCompleteSignal,
  normalizeInlineAgentFinalAnswerText,
  stripDanglingLeadingPunctuation,
  TASK_COMPLETE_BLOCK_RE,
} from './prompt';

/**
 * Display-layer answer extraction (Issue #551): when the model closed with a
 * `<task_complete>` signal, the user-facing answer is ONLY the signal summary;
 * text before the signal is working notes shown in the process timeline.
 * Falls back to the full normalized text when the summary is absent or empty
 * so a malformed completion never hides the answer.
 *
 * Kept out of {@link ./prompt} because that module is shared into the
 * sidepanel initial shell; this display-only logic is used exclusively by the
 * content-script renderer, so it lives in its own bundle slice.
 */
export function getInlineAgentAnswerText(text: string): string {
  const signal = extractTaskCompleteSignal(text);
  const summary = signal?.summary.trim() ?? '';
  if (summary) return summary;
  return normalizeInlineAgentFinalAnswerText(text);
}

/**
 * Display-layer process/step text (Issue #551): the model's working notes
 * with the internal `<task_complete>` control block removed entirely. The
 * signal summary is the answer and must not be duplicated into the timeline.
 */
export function getInlineAgentProcessText(text: string): string {
  return stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
}
