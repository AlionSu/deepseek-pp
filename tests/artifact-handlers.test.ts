import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';

vi.mock('../core/artifact/store', () => ({
  saveArtifact: vi.fn(),
}));

import { saveArtifact } from '../core/artifact/store';
import { createArtifactRuntimeHandlers } from '../entrypoints/background/artifact-handlers';

beforeEach(() => {
  vi.clearAllMocks();
});

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  documentSessionId: 'document-1',
  tabId: 17,
};

async function dispatch(message: { type: string; payload?: unknown }) {
  const handlers = createArtifactRuntimeHandlers();
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Missing handler: ${message.type}`);
  return handler.handle(message, context);
}

describe('SAVE_AGENT_OUTPUT_ARTIFACT handler', () => {
  it('persists long agent output as a markdown artifact', async () => {
    vi.mocked(saveArtifact).mockResolvedValue({
      id: 'artifact-1',
      kind: 'file',
      filename: 'deepseek-agent-output-1.md',
      mimeType: 'text/markdown;charset=utf-8',
      content: 'long output',
      sizeBytes: 11,
      createdAt: 1,
    });

    const response = await dispatch({
      type: 'SAVE_AGENT_OUTPUT_ARTIFACT',
      payload: { loopId: 'loop-1', content: 'long output' },
    });

    expect(response).toEqual({ ok: true, artifactId: 'artifact-1' });
    expect(saveArtifact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'file',
      filename: expect.stringMatching(/^deepseek-agent-output-\d+\.md$/),
      mimeType: 'text/markdown;charset=utf-8',
      content: 'long output',
    }));
  });

  it('rejects empty content at the receiving boundary without touching the store', async () => {
    await expect(dispatch({
      type: 'SAVE_AGENT_OUTPUT_ARTIFACT',
      payload: { content: '   ' },
    })).rejects.toThrow('must be a non-empty string');
    expect(saveArtifact).not.toHaveBeenCalled();
  });

  it('fails visibly when the artifact store rejects the write', async () => {
    vi.mocked(saveArtifact).mockRejectedValue(new Error('db locked'));
    const response = await dispatch({
      type: 'SAVE_AGENT_OUTPUT_ARTIFACT',
      payload: { content: 'long output' },
    });
    expect(response).toEqual({ ok: false, error: 'db locked' });
  });
});
