import {
  defineBackgroundPayloadRuntimeCommandHandler,
} from './runtime-handler';
import type { RuntimeCommandHandler } from '../../core/messaging/runtime-command-registry';
import { saveArtifact } from '../../core/artifact/store';
import { AGENT_OUTPUT_AUTO_SAVE_MAX_BYTES } from '../../core/inline-agent/auto-save';

export function createArtifactRuntimeHandlers(): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    defineBackgroundPayloadRuntimeCommandHandler('SAVE_AGENT_OUTPUT_ARTIFACT', async (payload) => {
      const bytes = new TextEncoder().encode(payload.content).length;
      if (bytes > AGENT_OUTPUT_AUTO_SAVE_MAX_BYTES) {
        return {
          ok: false as const,
          error: `agent_output_too_large:${AGENT_OUTPUT_AUTO_SAVE_MAX_BYTES}`,
        };
      }
      try {
        const record = await saveArtifact({
          kind: 'file' as const,
          filename: `deepseek-agent-output-${Date.now()}.md`,
          mimeType: 'text/markdown;charset=utf-8',
          content: payload.content,
        });
        return { ok: true as const, artifactId: record.id };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : 'agent_output_save_failed',
        };
      }
    }),
  ]);
}
