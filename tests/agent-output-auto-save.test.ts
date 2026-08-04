import { describe, expect, it } from 'vitest';
import {
  AGENT_OUTPUT_AUTO_SAVE_MIN_CHARS,
  shouldAutoSaveAgentOutput,
} from '../core/inline-agent/auto-save';

const longText = 'x'.repeat(AGENT_OUTPUT_AUTO_SAVE_MIN_CHARS);

describe('shouldAutoSaveAgentOutput', () => {
  it('auto-saves long final output when no save/write tool was used', () => {
    expect(shouldAutoSaveAgentOutput(longText, ['web_search'])).toBe(true);
    expect(shouldAutoSaveAgentOutput(`${longText}\n正文`, [])).toBe(true);
  });

  it('does not auto-save short outputs', () => {
    expect(shouldAutoSaveAgentOutput('short answer', ['web_search'])).toBe(false);
    expect(shouldAutoSaveAgentOutput('', ['web_search'])).toBe(false);
  });

  it('does not double-save when the loop already persisted output', () => {
    expect(shouldAutoSaveAgentOutput(longText, ['artifact_create'])).toBe(false);
    expect(shouldAutoSaveAgentOutput(longText, ['local_file_write'])).toBe(false);
    expect(shouldAutoSaveAgentOutput(longText, ['artifact_bundle_create', 'shell_exec'])).toBe(false);
  });
});
